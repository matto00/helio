## Standing Constraints

- [C1] A mutation check counts only if the fixture makes the mutated branch the sole reason the assertion holds (e.g. the field produced by an upstream compute must itself be text-typed, `x = $s`, so dropping the trust gate actually turns the test red); state per mutation why the fixture is discriminating.

## 1. Unary minus — red first

- [x] 1.1 Add failing tests to `backend/src/test/scala/com/helio/domain/engine/ExpressionEvaluatorSpec.scala` for: `-5`, `-$x` (number, null, string → null row), `mod(-7, 3)` = 2, `2 - -3` = 5, `2--3` = 5, `--$x` = `$x`, `-$a * $b` = `(-$a) * $b`, `-floor($x)`, `round($x, -2)` = 1200, `-(1 + 2)`, `inferType("-$n")` = `float`, `validate("$a * -")` is a Left, `validate("+5")` still a Left, a legacy bare `-price` evaluates exactly as before on the RUN path (`evaluate` → null row / same error); do NOT assert the old strict-validation message — strict validation now reports the `$`-prefix message for it (D3), and a parity table `-e` ≡ `0 - e`. Record the red run (test names + failure lines) in the executor report before implementing.
- [x] 1.2 Add a failing test that runs a compute step with `mod(-7, 3)`, `-$x` and `2 - -3` through a REAL pipeline run (the real run path — `PipelineRunService`/run route against the test DB, persisted `node_snapshots` rows asserted), not only `ComputeStep.apply`. Record red.

## 2. Unary minus — implementation

- [x] 2.1 Add `Neg(e: Expr)` to the AST and the `unary` level to `StrictParser` only (design D1); leave `LegacyParser` untouched. Verify 1.1 parse cases pass.
- [x] 2.2 Cover `Neg` in `ExpressionTypeInference.inferTypeOf` and `ExpressionInterpreter.evalExpr` (design D2), and in every other AST pattern match in `domain/engine` (grep `case BinOp(`/`case Call(` — list each site in the report). Verify 1.1 and 1.2 green, and the whole existing `ExpressionEvaluatorSpec`, `ComputeStepSpec`, `ComputeCoalesceCsvSpec` stay green with no scalac non-exhaustive-match warning.
- [x] 2.3 Update `docs/compute-expression-grammar.md`: Literals (negative numbers), a Unary minus section with the binding rules and examples from design D1, the `0 - x` workaround examples rewritten (`floor(-2.5)`, `round(-2.5)`, `round(1234, -2)`, `mod(-7, 3)`, `mod(7, -3)`), type inference list entry for unary `-`, remove the "No unary minus" Known limitation, extend the Spark note with the `--` comment difference (D4). Also update the class-level grammar comment in `ExpressionEvaluator.scala`. Verify by a grep over `docs/`, `openspec/specs/`, `backend/src/main` and `helio-mcp/src` that nothing still claims there is no unary minus or uses a `0 - x` workaround in an example (the main-spec scenario at `openspec/specs/compute-expression-language/spec.md` is updated by this change's MODIFIED delta at archive time; report any other hit).

## 3. Analyze warning — red first

- [x] 3.1 Add failing tests (unit, `AnalyzeSchemaWarnings`-level, following the existing `AnalyzeSchemaWarningsSpec` pattern) for: `floor($price)` over a string root → one `numeric-op-on-text-field` warning naming price/string/floor/cast; `$s - 1` → one warning; `floor($s) + $s * 2` → ONE warning for `s` naming both contexts; boolean field `-$b` → warning; `floor($s + 1)` → warning; `floor($s + length($t))` → warning on `s` ONLY (field collection follows only through `+`, `coalesce`, unary `-` and parentheses, never into another function's arguments); `$first + " " + $last` → none; `length($s)` → none; after a `cast` to `double` → none; after a `compute` that produced the field as TEXT (`x = $s`, then `floor($x)`) → none (untrusted); CSV → compute (unrelated column) → `floor($price)` → none (per-step trust granularity pinned, design D5); disabled step → none; a step with `validationError` → none. Record red.
- [x] 3.2 Add a failing integration test at the analyze endpoint level (extend `backend/src/test/scala/com/helio/services/pipelines/PipelineAnalyzeSchemaWarningsSpec.scala`): a real CSV-source pipeline with compute `floor($price)` → full analyze `warnings` has the entry, `costVerdict.canRun` is `true`, the step's `validationError` absent; concise analyze carries it on the node; proposal analyze carries it; the response validates against `schemas/pipelines/pipeline-analyze-response.schema.json` (and the proposal schema). Plus a run of that pipeline is not rejected and the computed column is null for the non-null rows (spec scenario "Warned compute still runs"). Record red.

## 4. Analyze warning — implementation

- [x] 4.1 Implement the expression-layer helper (design D5) behind the `ExpressionEvaluator` facade and the `compute` branch in `AnalyzeSchemaWarnings.compute` gated on `step.enabled`, no `validationError`, and trusted input types. Verify 3.1 and 3.2 green and the existing HEL-1235 suites (`AnalyzeSchemaWarningsSpec`, `PipelineAnalyzeSchemaWarningsSpec`) stay green unchanged.
- [x] 4.1a Update the header comment of `AnalyzeSchemaWarnings.scala` (the "three silent-wrong-result shapes" list and the "ops that already report an unknown field ... compute ..." paragraph) to describe the new compute warning. Verify by reading the diff.
- [x] 4.2 Prove non-blocking: grep shows `AnalyzeSchemaWarnings` output still feeds only the `warnings` response fields (no `stepConfigProblem`/`costVerdict`/RunConfigGate reader); cite the three `PipelineService` call sites in the report.
- [x] 4.3 Mutation check: temporarily drop the trust gate (`types`) and show the "after a compute" test goes red; temporarily drop `boolean` from the text set and show the boolean test goes red; revert both. Record in the report.

## 5. Contract sync

- [x] 5.1 Add `numeric-op-on-text-field` to the `code` enum in `schemas/pipelines/pipeline-analyze-response.schema.json` and `schemas/pipelines/pipeline-analyze-proposal-response.schema.json`, the `PipelineAnalyzeProtocol.scala` doc comment, `frontend/src/features/pipelines/types/pipelineStep.ts` `AnalyzeWarningCode`, `helio-mcp/src/types.ts` `AnalyzeWarning.code`, and the warning descriptions in `helio-mcp/src/tools/read.ts` and `helio-mcp/src/tools/pipelineProposal.ts`. Verify: frontend `npm run typecheck` + `npm run lint`, helio-mcp's own build/test/lint, and any schema-drift check pass; update any helio-mcp test that pins the description text.

## 6. Gates

- [x] 6.1 Run the backend suite (`sbt -J-Xmx3g testFull`, `nice -n 19`), frontend lint/typecheck/tests touched, helio-mcp tests, and the pre-commit hook without bypass; commit with `HEL-1403` prefix.
