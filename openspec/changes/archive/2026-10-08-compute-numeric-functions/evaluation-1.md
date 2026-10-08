## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `24d2bc13cebd6fe0ce766007e3d86c5f1098bd66` (23b2b390a implementation + 24d2bc13c spec fix).
Diff base (live-resolved via `resolve-review-base.sh`): `8efa42298fdf19779174beba6a35ead4c2d7126b`.

### Phase 1: Spec Review — FAIL

- AC1 (correct values incl. negatives and null, tested): PASS. `ExpressionEvaluatorSpec` covers floor/ceil/abs/round/mod on
  positive, negative, zero, null (every function and argument position), and numeric-string input. Round covers ties,
  digits, negative digits via `0 - n`, fractional and huge digits, 2.675, and non-finite. Mod covers all four sign
  quadrants, fractional input, and division by zero.
- AC2 (inferred types match applied types): PASS. A parity test checks `inferType == "float"` and that `evaluate` returns
  `JsNumber` for every function. `PipelineAnalyzeServiceSpec` checks analyze reports `float` with no `validationError`.
- AC3 (unknown-function message lists the new functions): PASS. The listing message is asserted at the evaluator,
  analyze (`validationError`), and write-path (`validateRawConfig`) levels.
- Tasks 1.1–3.5 are all marked done and match the diff. There is no scope creep and no API, schema, DB or frontend change.
- CONSTRAINTS C1–C4: all honoured.
  - C1: no test claims to guard `-0.0`. The `n(0)` assertions compare BigDecimal-backed `JsNumber`s, where `-0 == 0`,
    so they make no such claim.
  - C2: no `0 <= mod < b` assertion; only exact cases are tested.
  - C3: the drift guard runs in both directions. I mutation-checked it myself (see Phase 2).
  - C4: `BigDecimal.RoundingMode.HALF_UP` (Scala) is used at `ExpressionEvaluator.scala` in `roundTo`.
- **Issue (spec divergence):** the ADDED requirement in
  `specs/compute-expression-language/spec.md` ("Numeric functions have defined rounding, sign, and null semantics") says
  "No numeric function result SHALL be negative zero". `mod` breaks this. The `mod` branch of `applyFn` returns
  `r = a % b` unnormalised, so `mod(-6, 3)` gives `-6.0 % 3.0 = -0.0` (the `r != 0` guard is false for `-0.0`, so
  `r + b` is skipped). Only `numericUnary` (floor/ceil/abs, line 690) applies `+ 0.0`.
  - No output channel can observe this today: `JsNumber` is BigDecimal-backed, `numStr(-0.0)` gives `"0"`, and `/`
    treats `-0.0 == 0` as division by zero.
  - Even so, the code contradicts a normative SHALL in the spec delta this change ships.

### Phase 2: Code Review — FAIL

Gates (my own fresh run, in `WORKTREE_PATH`, backend-only diff):
- `cd backend && nice -n 19 sbt testFull`: **6205 succeeded, 0 failed, 4 canceled, 443 suites, 0 aborted, EXIT=0**.
  I confirmed in the log that the new HEL-1315 tests actually executed (7 matching test names), so this is not a cached
  no-op.
- `node scripts/check-scala-quality.mjs`: clean (soft warnings only).
- `node scripts/check-openspec-hygiene.mjs`: clean.
- `prettier --check` on the changed docs/openspec markdown: clean.

Mutation check (red-first evidence for the guards, run by me in a throwaway detached worktree at the reviewed SHA, removed
afterward). There were three simultaneous mutations:
- (a) replace `"mod"` with `"sqrt"` in `SupportedFunctions`;
- (b) drop `"round"` from the `inferTypeOf` float case.

Result: 5 failures, each naming the expected cause.
- `dispatcher -> list` failed with "mod ... did not contain element mod".
- `list -> dispatcher` failed with "sqrt false was not equal to true".
- The listing test failed with "did not include substring mod".
- The exact-message test failed.
- The parity test failed with "round($x) Right("string") was not equal to Right("float")".

So the bidirectional drift guard (C3) and the AC2 parity guard are each failable by mutation.

Code findings:
- **Issue (misplaced doc comment), `backend/src/main/scala/com/helio/domain/engine/ExpressionEvaluator.scala:209-213`:**
  the new `SupportedFunctions` declaration and its scaladoc were inserted *between* `checkArity`'s existing
  `/** Arity/known-name check ... */` comment and `checkArity` itself.
  - Effect: two doc comments are stacked on `SupportedFunctions`. The first (lines 209-211) now describes the wrong
    declaration, and `checkArity` (line 217) has lost its doc.
  - This directly hurts readability, and the diff introduced it.
- Correctness otherwise checks out:
  - `isWhole` rejects NaN/±Inf digits.
  - Digits are clamped before `.toInt`.
  - Non-finite `x` bypasses `BigDecimal`.
  - `mod` by `-0.0` is caught by `b == 0`.
  - Null propagation comes from the existing `applyFn` guard.
- Type safety, security and error handling are fine. Per-row errors stay `Left` and become `null` in `ComputeStep`, and
  no new boundaries are introduced.
- Tests are meaningful and mutation-verified. There is no dead code and no over-engineering.

### Phase 3: UI Review — N/A

None of the Phase 3 triggers match. The diff touches no `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`, and no
`openspec/specs/**` (only the change-dir spec delta). The step card renders `validationError` verbatim, unchanged, and
the analyze-level `validationError` text is asserted in `PipelineAnalyzeServiceSpec`. I did not start dev servers, did
not use the shared browser, and left no dev-DB residue.

### Overall: FAIL

### Change Requests
1. **`backend/src/main/scala/com/helio/domain/engine/ExpressionEvaluator.scala:209-216`:** move the
   `/** Arity/known-name check for function calls — ... */` scaladoc (current lines 209-211) down so it sits
   immediately above `private def checkArity` (current line 217). `SupportedFunctions` should then carry only its own
   doc comment (current lines 212-213).
2. **Make the code and the spec delta agree on negative zero for `mod`.** Pick one:
   - (a) In the `mod` branch of `applyFn` (`ExpressionEvaluator.scala`, `case (VNum(a), VNum(b)) =>`), normalise the
     result the same way `numericUnary` does, e.g. `Right(VNum((if (r != 0 && (r < 0) != (b < 0)) r + b else r) + 0.0))`.
     Per C1, do NOT add a test claiming to guard it, because it is unobservable.
   - (b) Narrow the spec sentence "No numeric function result SHALL be negative zero" in
     `openspec/changes/compute-numeric-functions/specs/compute-expression-language/spec.md` so it no longer over-claims
     (e.g. drop it, since negative zero cannot be observed through JSON or string output).

   (a) is preferred: it is one token and keeps D3's intent uniform across all five functions.

### Non-blocking Suggestions
- `ExpressionEvaluator.scala` is now 720 lines (671 before), well past CONTRIBUTING's ~400-line "propose a split"
  threshold. Mention a split proposal (e.g. extracting the function dispatcher `applyFn`/`checkArity`/
  `SupportedFunctions` into a sibling `ExpressionFunctions` module) in the PR description, as CONTRIBUTING asks. Do not
  do the split in this ticket.
- `inferTypeOf`'s `case _ => "string"` default means a future numeric function added to `checkArity`/`applyFn` but
  forgotten here would silently infer `string`. The parity test only enumerates the current six. Consider deriving the
  parity test's expression list from `SupportedFunctions` minus the string functions, so a new function cannot skip the
  parity check.
