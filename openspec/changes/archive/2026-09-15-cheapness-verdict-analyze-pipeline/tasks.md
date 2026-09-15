## Standing Constraints

- [C1] Deny by default: `autoRunnable` is derived only as `reasons.isEmpty`; no code path may construct an allow with reasons or an allow for an unclassified op/source.
- [C2] Evidence must be failable: mutation M1 and M2 (design.md D8) must each be run and their RED test output captured in the evaluation evidence, then reverted.
- [C3] Do not implement or register `analyzewithai`, `generatetext` or `convertformat`; classify them by op name only.
- [C4] CheapOps is a hand-maintained literal; a test fails when a registered op is in neither CheapOps nor a named deny set.

### Backend

## 1. Estimator

- [x] 1.1 Add `domain/engine/PipelineCostEstimator.scala` with `CostInput`, `RootCost`, `CostReason`, `CostVerdict` (private ctor) per design D1-D5
- [x] 1.2 Define `CheapOps`, `AiOps`, `WriteBackOps`, `MaxAutoRunRows = 10000`, `MaxAutoRunSteps = 20`

## 2. Service and wire

- [x] 2.1 Add `DataSourceRepository.countDatasetRows` (D7)
- [x] 2.2 Build `CostInput` in `PipelineService.analyze` from enabled steps, resolved roots, `summary.lastRunRowCount`
- [x] 2.3 Add `CostVerdictResponse`/`CostReasonResponse` + formats; `PipelineAnalyzeResponse.costVerdict` (jsonFormat6)
- [x] 2.4 Update `schemas/pipelines/pipeline-analyze-response.schema.json` (required, code enum, additionalProperties false)
- [x] 2.5 Confirm concise and proposal analyze responses are unchanged

### Frontend

## 3. Types

- [x] 3.1 Add `costVerdict` to `frontend/src/features/pipelines/types/pipelineStep.ts` `PipelineAnalyzeResponse`
- [x] 3.2 Add `costVerdict` to `helio-mcp/src/types.ts` analyze response type

### Tests

## 4. Probe and coverage

- [x] 4.1 Estimator spec: AI-deny (asserts `ai-step`) and allow cases (D8), one test per deny code
- [x] 4.2 Spec asserting every `PipelineStep.Registry` op partitions into exactly one of `CheapOps`/`AiOps`/`WriteBackOps` (skeptic-final-1.md CR2, replaces the tautological `CheapOps == registered ops - upsertsource` form), plus a regression denying a registered-shaped op present in none of the three sets
- [x] 4.3 Run mutation M1, M2 and M3 (new: remove an op from the literal `CheapOps`), capture RED output, revert (C2, C4)
- [x] 4.4 Route/service spec: persisted allow pipeline, `rest_api` deny, AI-op row inserted past validation (or record why not possible)
- [x] 4.5 Schema check (`npm run check:schemas`), backend tests, frontend typecheck, helio-mcp build
