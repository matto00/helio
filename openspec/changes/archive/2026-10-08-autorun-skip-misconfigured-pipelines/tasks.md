## Standing Constraints

## 1. Red

- [x] 1.1 Add a failing `AutoRunTriggerServiceSpec` case: a dataset-rooted pipeline whose only enabled step is a cheap op with a missing required config (e.g. `compute` with empty `column`) expects `Denied` with a `step-config-invalid` reason and no debounce row. Run it via `sbt "testOnly ..."` and record the RED output (currently `Allowed` + debounce upserted) in the commit/handoff.

## 2. Shared validator and constant

- [x] 2.1 Expose analyze's existing `validateStepConfig` through a public `PipelineAnalyzeService` entry point without changing its behaviour; `analyzeNodes`/`analyze` keep calling the same function. Verify the existing analyze specs still pass.
- [x] 2.2 Move the `step-config-invalid` code to one public constant next to the validator and make `PipelineService.toCostVerdictResponse` use it; update the doc comment naming it in `PipelineAnalyzeProtocol.scala` (~L237). Verify by grep that the literal appears once in main code.

## 3. Auto-run gate

- [x] 3.1 In `AutoRunTriggerService.evaluateAndSchedule`, compute config reasons for enabled steps (in step order) via the shared validator; auto-run only when cost-autoRunnable AND no config reasons; pass combined reasons (cost first) to `handleDenied`. Verify 1.1 turns green.
- [x] 3.2 `handleDenied`: `canRun` is false whenever a config reason is present (ACL result ANDed); visibility filtering unchanged. Verify with owner and editor-grant cases.

## 4. Coverage

- [x] 4.1 HEL-1280 guard test (use a cheap op whose inference reports "Unknown field" — compute, pivot or unpivot — and confirm it is in `PipelineCostEstimator.CheapOps`): prove in-test that `PipelineAnalyzeService.analyzeNodes` reports a schema-derived `validationError` for a step referencing a column absent from the stored inferred schema, and that auto-run is still `Allowed` with a debounce row. Record a mutation run (gate temporarily on full analyze) showing it goes red, then revert.
- [x] 4.2 Disabled misconfigured step -> still `Allowed`. Cost + config combined -> both reasons, cost first, `canRun=false`.
- [x] 4.3 Add `step-config-invalid` to `AllReasonCodes` in `RowWriteResponseDenyReasonCoverageSpec` (if it exists) and verify it passes. Extend `DataSourceServiceDeniedPipelinesSpec` with an append write whose response carries a `step-config-invalid` denial and `canRun: false`. Do NOT touch `DatasetWriteAutoRunEndToEndSpec` or `PipelineRunGuardRepository` (HEL-1374 lane).

## 5. Contract and docs

- [x] 5.1 Add `step-config-invalid` to `schemas/sources/denied-pipeline-response.schema.json`'s `CostReason.code` enum and update the `canRun` description; fix the now-inaccurate "analyze-only" comment in `frontend/src/features/pipelines/services/denyReasonCopy.ts` if applicable. Run any schema/contract tests and `npm test -- --testPathPatterns=denyReason` if frontend touched.

## 6. Gates

- [x] 6.1 `sbt testFull` green (never bare `sbt test`), plus pre-commit hooks without bypass. Write `files-modified.md`.
