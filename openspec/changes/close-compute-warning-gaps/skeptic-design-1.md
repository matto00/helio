## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: `8e18ed5459814fdc43143f8411c04494ba36a8c2` (branch `bug/compute-numeric-warning-gaps/HEL-1455`; the change dir is the only untracked content, and there are no code edits yet).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/compute-numeric-warning-gaps/HEL-1455`.
- **Owner rulings:** main-checkout `.concertino/runs/HEL-1455/events.jsonl` line 5 is `escalation.answered` `HEL-1455-1791871083471-abb081`, with `sub_answers ["warn","per-column","warn","warning"]` and `answer_source: human`. Line 4 holds the matching questions. In 4b the owner overrode the orchestrator's "analyze-error" recommendation with "warning". The design implements all four faithfully:
  - D1: `string-body` goes into `TextLike`.
  - D2: per-column `untrusted`.
  - D3/D4: substring start/end, plus `text-function-on-numeric-field`.
  - D5: `literal-type-mismatch` as a warning, never a validationError.
  - C1 records the 4b ruling.
- **Item 1 premise:** `ExpressionTypeInference.scala:11` is `TextLike = Set("string","timestamp","boolean")`, so the boolean half is already fixed and `string-body` is missing. `ExpressionNumericContexts` `TextTypes` already includes `string-body` and `boolean`.
- **Run-time premise for 4a/4b:** `ExpressionInterpreter` has no numeric coercion. `*` on `VStr` falls through to a TypeError (lines 138-149). `length`/`lower`/`upper` on a non-`VStr` value is a TypeError (lines 194-209). `substring` with non-numeric start/end is a TypeError (line 191). Every one of these nulls the row in `ComputeStep.apply`.
- **Item 3 premise:** `CastStep.SupportedTargets` includes `float`, and `castRuntimeTargets` derives from it (`AnalyzeSchemaWarnings.scala:68`).
- **Compute pass-through (D2 soundness):** at run time `ComputeStep.apply` does `row + (column -> value)`, and in projection `ColumnSchemaInference.inferCompute` does `inputSchema :+ SchemaField(column, t)`. Other columns pass through unchanged, so per-column trust is sound in principle.
  - When `column` overwrites an existing name, the projection holds two fields with that name: `find` returns the old one and `toMap` returns the new one. Name-keyed `untrusted` covers this.
- **Readers of `types`:** these are `AnalyzeSchemaWarnings.scala` lines 115 (`outFlags`), 124/127 (`typesPreserved` via `sec.flags.types`), 152 (compute gate), 172 (join key) and 207 (lookup key). There are no others.
- **HEL-1502 isolation:** the HEL-1502 branch touches `TimestampParsing.scala`, `CastStep.scala` (not `SupportedTargets`; its diff has no hit on it), `ColumnClassifier.scala`, tests and fixtures. The plan edits none of these. The design names `TimestampParsing`/`ExpressionDateTimeFunctions` as untouched, and C2 records it.
- **Spec delta hygiene:** both MODIFIED requirement headers exist verbatim in the base specs. Every base scenario is preserved, and the diff of scenario lists shows only additions.
- **StrictParser recursion paths:** I read `ExpressionParser.scala:75-219`. Every recursive cycle passes through one of the four counted points: `parseUnary`'s `-`, `parseNot`'s `not`, `parseFactor`'s `LParen`, or a call's `parseArgs`. `parseOr`/`parseAnd`/`parseSum`/`parseTerm` loop iteratively. **Within StrictParser** the D6 counter does bound recursion. Two paths outside it do not (see CR1 and CR2).
- **Live probes:** I compiled the worktree tree (`sbt Compile/compile`, exit 0) and called `ExpressionEvaluator` reflectively from a scratch Java probe. Each probe ran twice (n=10000 and n=100000), and the n=10000 legacy case was re-run a third time. Results were identical:
  - `-`x n + `1`: `parseProblem` and `compile` both throw StackOverflowError. This is the red that D6 targets.
  - `(`x n `1` `)`x n: StackOverflowError (D6 target).
  - `x + ` + `(`x n `1` `)`x n: **StackOverflowError in both `parseProblem` (the save path) and `compile` (the run path).** The stack frames are only `ExpressionParser$LegacyParser.parseExpr/parseTerm/parseFactor`.
  - `1` + `+1`x n: parses (`parseProblem` returns `None`), but **`validate`, `inferType` and `evaluate` all throw StackOverflowError.**
- **Expression length:** no length cap applies to compute expressions. `RequestValidation.MaxExpressionLength = 500` is defined and referenced nowhere.

### Verdict: REFUTE

### Change Requests

1. **D6 claims the frozen `LegacyParser` is unreachable for deep input. That claim is false, and AC5 stays open through it.**
   - Cause: StrictParser returns the `$`-prefix error at the first bare identifier, before it reaches any depth. `parseProblem` (`ExpressionEvaluator.scala:120-124`) and `compile` (`:230-241`) then re-parse the WHOLE string with `LegacyParser`, whose `LParen` recursion (`ExpressionParser.scala:264-268`) is unbounded.
   - Probe: `x + ((((…1))))` with 10000 parens throws StackOverflowError from LegacyParser frames on the save path and the run path.
   - Required revision: bound nesting before `LegacyParser` runs, without changing its grammar. One way is a token-level max-paren-depth pre-check in `ExpressionParser.parseLegacy` (outside the frozen class), returning the same depth error. Correct the D6 sentence that says LegacyParser "is never reached for such input".
   - Add a spec scenario and a red-first test for a bare identifier followed by deep brackets, via `parseProblem` and `compile`. Extend task 3.1 to capture this red too.
2. **Flat operator chains overflow every AST walker. The spec's "no exception for any input length" and "no exception escapes" do not hold for them.**
   - Cause: `parseSum`/`parseTerm`/`parseAnd`/`parseOr` build a left-deep `BinOp`/`And`/`Or` tree iteratively. The parse succeeds, but `checkRefs` (`validate`), `inferTypeOf`, `ExpressionNumericContexts.visit` and `evalExpr` recurse on it.
   - Probe: `1+1+…` with 10000 terms (about 20 KB) parses, then `validate`, `inferType` and `evaluate` throw StackOverflowError.
   - D6 rejects a length cap because long flat expressions are "legitimate", but they do not work today either.
   - Required revision: pick one of the two options below and state it in design.md.
     - (a) Preferred: bound total AST depth in this change, counting binary-operator chain length, or cap operator/token count. Return a parse error, with a red-first test for a 10000-term flat chain.
     - (b) Explicitly descope flat chains: narrow the spec text from "for any input length" to the nesting forms actually bounded, and file a Follow-up (relatedTo HEL-1455) for the AST-walker exposure.
3. **The per-column trust rules for join/lookup key checks are under-specified on the secondary side, and the join requirement is not modified even though its behavior changes.**
   - After this change a lane secondary that went through a `compute` has `types = true` with `untrusted = {col}`. Before, it had `types = false`.
   - The key checks at `AnalyzeSchemaWarnings.scala:172/207` read `s.flags.types`. Unless the RIGHT key is also tested against `s.flags.untrusted`, a compute-written right key that used to be silent starts warning (a false positive). D2's "A key in `untrusted` never warns" and the spec's single sentence do not say which side. Task 3.2 has a single "compute-written key not warning" case, which an implementer can satisfy with a left-only check.
   - Required revision: state in D2 that the left key is tested against `in.untrusted` and the right/lookup key against `sec.flags.untrusted`.
   - MODIFY `Requirement: Join key type mismatch warns` in the spec delta: it now warns after a compute on a different column, which it never did before. Add scenarios for:
     - (i) compute on another column, then join: the key mismatch still warns;
     - (ii) compute-written left key: silent;
     - (iii) a lane secondary whose compute wrote the right key: silent;
     - (iv) the lookup twin of (ii) and (iii).
   - Add the matching tests to task 3.2.
4. **`literal-type-mismatch` is "not trust-gated", but D5 collects literals through `coalesce` arguments and `if` branches. There, the "every row will compute null" message can be false.**
   - Example: `length(coalesce($x, 0))` with `x` projected `float` after a `fillnull`, so types are untrusted. If `x` is a string at run time, non-null rows succeed, yet the warning claims every row nulls. The same applies to `floor(coalesce($s, "0"))` when `s`'s projection is untrusted.
   - Required revision: either collect trust-free literals only through always-evaluated positions (`BinOp`/`Neg` operands and direct function arguments), and through `coalesce`/`if` branches only when every sibling field ref is trusted; or reword the message for the branch case. Update the spec requirement and add a scenario either way.
5. **The user-facing grammar doc is missing from the update list.** `docs/compute-expression-grammar.md:262-265` documents `numeric-op-on-text-field` as "only when the input schema's types are trusted". This change makes that wording stale: trust is now per column, `+` with `string-body` now concatenates in inference, there are two new warning codes, and there is a new nesting limit. Add a task (and a line in D7) to update it.

### Non-blocking notes

- D6's counter "decremented on exit" must hold on every return path. Since a `Left` short-circuits to failure, a missed decrement on a `Left` is harmless, but on a `Right` it would mis-count. Prefer a `try/finally`, or a helper that wraps the recursive call.
- Item 7 (HEL-1301 residue user) is not in the spec, which is fine because it is housekeeping. Task 3.6 already prescribes read-first, exact (id, email) deletion and before/after counts.
- `RequestValidation.MaxExpressionLength = 500` is dead code. If CR2(a) chooses a length or token cap, decide whether to wire this constant or delete it. Do not leave two competing limits.
- The base spec says warnings are sorted "by step position, then step id, then code, then field name", but `AnalyzeSchemaWarnings.scala:155` sorts by message. This is pre-existing and not in scope, but the new codes inherit it.
- StepCard renders warnings generically (`StepCardWarnings.tsx:31` renders `w.message`), as D7 claims.
