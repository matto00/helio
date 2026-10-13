## Context

See proposal.md for the motivation. The specs are in `specs/`. The relevant code is all under
`backend/src/main/scala/com/helio/domain/engine/`:
- `ExpressionTypeInference.inferTypeOf`: `TextLike = Set("string","timestamp","boolean")` decides `+` typing.
- `ExpressionNumericContexts.textFieldsInNumericContext`: the HEL-1403 scan. `textRefs` only matches `FieldRef`.
- `AnalyzeSchemaWarnings`: `Flags(names, types: Boolean)` is per step, and `typeTrusted` excludes `compute`.
  `computeNumericWarnings` is gated on `in.types`.
- `ExpressionParser.StrictParser`: `parseUnary`, `parseNot`, `parseFactor` (parens and calls) and `parseArgs` recurse
  with no bound. `LegacyParser` is FROZEN (design decision 4 of an earlier change) and is reached only on the
  `$`-prefix error.
- `ExpressionInterpreter`: `length`/`lower`/`upper`/`substring` on a `VNum` raise a TypeError, which nulls the row.
  `+` with any `VStr`/`VBool` concatenates (line ~146).

## Goals / Non-Goals

**Goals:** close items 1, 2, 4a, 4b and 5 as the owner ruled; add a regression test for item 3.
**Non-Goals:** per-column trust for any op except `compute`; changing any warning into an error; touching
`TimestampParsing`, `ExpressionDateTimeFunctions` or cast/datebucket date handling (HEL-1502 owns them); frontend UI
changes beyond the `AnalyzeWarningCode` union. StepCard already renders any warning's message generically. Verify
this, and do not add per-code UI.

## Decisions

1. **Item 1.** Add `"string-body"` to `ExpressionTypeInference.TextLike`. This also changes the projected output type
   of `$sb + 1` from `float` to `string`. That is correct, because at run time it concatenates. Alternative: special-case
   it in the scan only. Rejected, because projected type and run time would still disagree.
2. **Item 2, per-column trust.** Extend `Flags` with `untrusted: Set[String]`. Its meaning: when `types` is true, every
   column is trusted except those in `untrusted`. A `compute` step is no longer per-step untrusted. Its output keeps
   `types = in.types` and gets `untrusted = in.untrusted + cfg.column`; an undecodable config falls back to
   `types = false`.
   Propagation through the other trusted ops:
   - `rename`: maps `untrusted` through the renames.
   - `select`: intersects `untrusted` with the selected fields.
   - `cast` (when `castTrusted`): removes the cast columns from `untrusted`, because a supported cast pins the value
     class.
   - `join`/`lookup` OUTPUT: carry the left input's `untrusted`. When the secondary's own `untrusted` is non-empty,
     the step's output becomes `types = false`. That is conservative, because right columns may be renamed
     `right_<name>`.
   - `Secondary` carries the secondary's full `Flags`, including `untrusted`. The join/lookup KEY checks judge each
     side separately:
     - the left key is trusted iff `in.types && !in.untrusted(leftKey)`;
     - the right key is trusted iff `sec.flags.types && !sec.flags.untrusted(rightKey)`.

     This replaces today's `in.types && s.flags.types`. It is a spec change to "Join key type mismatch warns": a
     MODIFIED delta with scenarios for the left key, the right key, the lane secondary and lookup.
   - Every other trusted op passes `untrusted` through unchanged.

   Every reader of `types` must also consult `untrusted`: `computeNumericWarnings`, the new warnings, and the
   join/lookup key checks. A key in `untrusted` never warns. Alternative: a full per-column type-trust map for every
   op. Rejected as scope beyond the owner ruling.
3. **substring start/end.** In `ExpressionNumericContexts.visit`, `Call("substring", args)` calls
   `args.drop(1).foreach(check(_, "substring"))`, mirroring `add_days`. The code stays `numeric-op-on-text-field`.
4. **Item 4a, `text-function-on-numeric-field`.** Add a second scan in `ExpressionNumericContexts`. For
   `length`/`lower`/`upper` (argument 0) and `substring` (argument 0), when `inferTypeOf(arg)` is numeric, collect
   `integer`/`float` field refs through value-propagating positions: `FieldRef`, `Neg`, `BinOp` of any op except a
   `+` that infers string, `coalesce` arguments, and `if` branches. Expose it through `ExpressionEvaluator` like
   `numericContextTextFields`. In `AnalyzeSchemaWarnings` it is gated on `in.types`, minus `untrusted`.
   For 4a (skeptic design-2 note), when a text-function argument also references any untrusted field (one in
   `untrusted`), emit no `text-function-on-numeric-field` warning for that argument. A mixed-trust argument cannot
   support the "every row" claim.
5. **Item 4b, `literal-type-mismatch`.** The same two context walks, but over literals, and only through positions
   that are always evaluated and always fail (skeptic design-1 item 4):
   - a `StrLit` reached from a numeric-context operand through `Neg`, `-`/`*`/`/` operands or `+` operands (a `+`
     with a string literal is always text);
   - a `NumLit` reached from a text-function argument through `Neg` or `-`/`*`/`/` operands only.

   Never through `coalesce`, `if` or comparisons, and for a `NumLit` never through `+`. In those positions the row
   may not be null, so "every row will compute null" would be false. It is emitted for every valid compute step
   regardless of trust, because the literal's type is known. Dedupe by (literal text, context). This is a warning, not
   the D6b `noBooleanExprs` error path (owner ruling 4). The code name was picked by the orchestrator, as the owner
   delegated; it is one code for both directions, so the UI and MCP enumerations stay small.
6. **Item 5, depth limits.**
   (a) Add `MaxNestingDepth = 100` and a `depth` counter to `StrictParser`. It is incremented on entry to
   `parseUnary`'s `-` branch, `parseNot`'s `not` branch, `parseFactor`'s `LParen` group and a function call's argument
   list, and decremented on exit. Exceeding the limit returns a `Left` parse error naming the limit, before recursing.

   (b) Legacy fallback (skeptic design-1 item 1). `x + ((((…1))))` fails the strict parse on the bare `x`, then
   recurses in the FROZEN `LegacyParser`. Keep its grammar untouched. In `ExpressionParser.parseLegacy`, run an
   iterative token pre-check (the maximum running `LParen` depth) and return the same nesting error before
   constructing `LegacyParser`.

   (c) Flat chains (skeptic design-1 item 2). `1+1+…` parses iteratively into a left-deep tree. Every recursive
   consumer then overflows on it: `validate`, `inferTypeOf`, the scans and the interpreter. Add `MaxTreeDepth = 200`,
   computed ITERATIVELY (an explicit stack, no recursion) on the parsed `Expr` inside both `parse` and
   `parseLegacy`. Depth is the number of nodes on the longest root-to-leaf path, and a lone literal is depth 1.
   Exceeding the limit is a parse error naming it, so every downstream recursion is bounded by 200 levels.

   **Stack budget (skeptic design-2, measured):** no `-Xss` is set anywhere in the repo, so production threads run
   on the JDK default of 1 MB. Recorded production assumption: 1 MB.
   - At 500, the worst shape (100 nested `abs(` around a 399-operator chain) overflowed `evaluate` at 512 KB.
   - A depth-201 flat chain overflowed `evaluate` at 256 KB.

   200 is chosen so the worst in-limit shapes fit in 512 KB, half the production default (2x margin).

   **Headroom test:** on a `Thread` created with a 512 KB stack, run `validate`, `inferType`, all three scans and
   `evaluate` over:
   - a depth-200 flat `+` chain;
   - a depth-200 `-`/`*` chain;
   - 100 nested `abs(` around a 99-operator chain (depth 200);
   - 100 nested `(` around a 199-operator chain;
   - 100 nested `concat(`, and 100 nested `if(` (optional; these measure the remaining margins).

   None may overflow. If any does, lower `MaxTreeDepth` until all pass, record the measured value, and update the
   spec figures. Do not raise the stack size to make it pass. `RequestValidation.MaxExpressionLength` (500) is unused
   today; leave it.

   Red first: on main, each of these throws `StackOverflowError`, and each red is captured in the transcript before
   the fix:
   - the 10000-deep unary chain;
   - 10000-deep brackets (strict);
   - the legacy `x + ((…))` case;
   - the 10000-term flat chain.

   Alternative considered: an input-length cap. Rejected, because it still allows deep nesting within the cap and
   reports the wrong cause.
7. **Contracts.** Add both codes to the enum in `schemas/pipelines/pipeline-analyze-response.schema.json`, to
   `AnalyzeWarningCode` in `frontend/src/features/pipelines/types/pipelineStep.ts`, and to `helio-mcp/src/types.ts`.
   Update the code lists in the helio-mcp tool descriptions (`read.ts`, `pipelineProposal.ts`, `computeExpression.ts`)
   and the `PipelineAnalyzeProtocol.scala` doc comment. Update `docs/compute-expression-grammar.md` (about lines
   262-265) for per-column trust, the substring start/end context, the two new codes, `string-body` in `+`, and both
   depth limits. Run the schema-drift check.

## Risks / Trade-offs

- [Per-column trust surfaces new warnings on existing pipelines] → This is intended (owner ruling 2). The warnings
  never block.
- [Propagating `untrusted` incorrectly through rename/select causes false positives] → Add explicit tests for
  compute -> rename -> compute and compute -> select -> compute.
- [A stored expression deeper than 100 now fails to parse] → Before this change such an expression overflowed at
  roughly a few thousand levels, so it never worked reliably. A depth over 100 is not a realistic hand-written
  expression.
- [HEL-1502 collision] → No edits to date parsing. Run `git diff` and confirm `TimestampParsing.scala` and
  `ExpressionDateTimeFunctions.scala` are untouched.

## Planner Notes

- Self-approved: the limit values (100 nesting; 200 tree depth, from the design-2 stack measurement); the code names `text-function-on-numeric-field` and `literal-type-mismatch`;
  per-column trust scoped to `compute`; deleting the HEL-1301 residue dev user by exact (id, email), read from the DB
  first, through `e2e/support/userCleanupCore.cjs` `buildUserDeleteSql`.
- Owner rulings (2026-10-12, recorded `escalation.answered` HEL-1455-1791871083471-abb081): 1 warn, 2 per-column,
  4a warn, 4b warning (not an error).
- Item 3: HEL-1436 (df5c941e6) made every `CastStep.SupportedTargets` value produce its projected class. Only a
  regression test is owed.
