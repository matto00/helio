## Why

Epic 4 of the write-back design auto-runs pipelines after a dataset write, but only when a run is cheap. Nothing
today says whether a pipeline is cheap. HEL-1093 (auto-run), HEL-1096 (run-to-update affordance) and HEL-1108 (AI
steps never auto-runnable) all need one authoritative verdict to key on.

## What Changes

- New pure domain estimator `PipelineCostEstimator` classifying a persisted pipeline's enabled steps and roots.
- `GET /api/pipelines/:id/analyze` (full mode) gains an always-present `costVerdict`:
  `{ autoRunnable, estimatedRows?, stepCount, reasons[] }`, where `reasons` is empty iff `autoRunnable`.
- Deny arms: AI step (`analyzewithai`, `generatetext`), remote fetch (`rest_api`, `sql`, any `sourceUrl`-backed
  file source), estimated rows above a threshold, enabled step count above a bound, write-back step.
- Deny by default: unknown op, unresolvable or unknown source kind, no row estimate available, no roots.
- JSON Schema, helio-mcp `types.ts` and frontend `PipelineAnalyzeResponse` type mirror the new field.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-analyze-api`: analyze response carries a deny-by-default cost verdict.

## Impact

Backend: `domain/engine`, `PipelineService.analyze`, `PipelineAnalyzeProtocol`, `DataSourceRepository` (dataset row
count). `schemas/pipelines/pipeline-analyze-response.schema.json`. `helio-mcp/src/types.ts`. Frontend type only.
No migration.

## Non-goals

- Implementing `analyzewithai`/`generatetext`/`convertformat` (HEL-1105..1107).
- Auto-run triggering (HEL-1093), UI affordance (HEL-1096), tier gating (HEL-1108).
- Verdict on `?concise=true` or on `POST` proposal analyze.
- Loosening thresholds; values are deliberately conservative.
