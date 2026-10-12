## Standing Constraints

- [C1] Red first: every new parity test is run against the pre-fix code and its failure output is recorded in `red-evidence.md` (change dir) before the fix lands.
- [C2] No run-time behaviour change to `FillNullStep` or `UnionStep`; the fixes live in analyze schema inference only.
- [C3] GUARD tests (negative cases) must be shown failable by a recorded mutation.
- [C4] sbt runs must show `[hel1468-guard]`; no inline FQNs; `nice -n 19` on heavy runs; shut down any sbt server started.

## 1. Red parity tests

- [x] 1.1 Add a pure unit spec (e.g. `backend/src/test/scala/com/helio/domain/engine/TimestampNumberParitySpec.scala`) using `PipelineAnalyzeService.analyzeNodes` for analyze and `InProcessPipelineEngine.executeTree` (as in `InProcessPipelineEngineTreeWalkSpec`; NOT `executeWithStepCounts`, whose context cannot resolve lanes) for the run: fillnull `mean` and `median` after a `cast` to `timestamp` over epoch-string rows with a null — assert the run writes a number AND analyze reports a `validationError` on the fillnull step naming the strategy and column.
- [x] 1.2 Same spec: `union` with a `lane`-kind secondary (parent `ts: timestamp`, secondary `ts: integer`; and the reverse `float` vs `timestamp`) — assert the run output mixes numbers under `ts` AND analyze reports a `validationError` on the union step naming `ts` and both types.
- [x] 1.3 Run the spec against the unmodified code; record the failing output in `red-evidence.md`, showing that the failing assertions are the analyze ones and the run-side assertions passed (no "Lane reference not found" or other run error).

## 2. Fixes

- [x] 2.1 `FillNullStep`: add the shared message function for D1.
- [x] 2.2 `StepSchemaInference`: add `inferFillNull` (D1) and dispatch `fillnull` to it; decode failure returns `(inputSchema, None)`.
- [x] 2.3 `MultiInputSchemaInference.inferUnion`: add the D2 collision check (symmetric, timestamp vs integer/float only), projection unchanged; update its scaladoc.

## 3. Guards and regressions

- [x] 3.1 GUARD tests: fillnull `forwardFill`/`mode`/`constant` on timestamp and `mean`/`median` on integer/float report no error; a listed column absent from the input schema reports no D1 error; union `string` vs `timestamp`, `integer` vs `float`, same-type collisions and an unresolved (source-kind) secondary report no error and keep the parent type (the source-kind case is the documented known gap, pinned so a later change to it is deliberate). Record one mutation per guard group showing it can go red.
- [x] 3.2 A save-path test (or an existing one cited) showing a fillnull `mean` step listing a timestamp column is still accepted by `PipelineStep.rawConfigProblem` (no write-time rejection).
- [x] 3.3 An analyze-response-level assertion that the D1/D2 error surfaces as `step-config-invalid` with `canRun: false` (reuse an existing analyze/cost-verdict spec's harness; DB-backed specs must use `VerifiedEmbeddedPostgres.start`).
- [x] 3.4 Re-run affected existing specs: `PipelineAnalyzeServiceSpec`, `AnalyzeSchemaWarningsSpec`, `PipelineAnalyzeRoutesSpec`, `FillNullStepSpec` (or equivalent), `UnionStep` specs, `CastRuntimeParitySpec`, `StepConfigValidation` specs.

## 4. Docs and handoff

- [x] 4.1 Update `docs/compute-expression-grammar.md` "Known limitation: a timestamp-typed column that carries a number" to the shipped behaviour, stating plainly that the step error flags but does not remove the disagreement (runs not blocked, projection still `timestamp`) and that a source-kind union is not checked.
- [x] 4.2 Full backend gate (`sbt testFull` under `nice -n 19`, respecting the machine-wide limit of two concurrent full runs) and the pre-commit hook; write `files-modified.md` (bulleted backticked repo-relative paths).
