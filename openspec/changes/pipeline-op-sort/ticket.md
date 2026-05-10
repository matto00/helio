# HEL-194 — Pipeline operation: Sort

## Title
Pipeline operation: Sort

## Description
Step type: order output rows by one or more fields, each ascending or descending.
UI: ordered list of field + direction pairs. Multiple sort keys supported.

## Acceptance Criteria
- Backend: `sort` op executes multi-column stable sort in `InProcessPipelineEngine`
- Backend: `sort` is recognized in `PipelineStepRoutes.allowedOps`
- Backend: Flyway migration extends `pipeline_steps.op` CHECK constraint to include `sort`
- Backend: `PipelineAnalyzeService` already handles `sort` as pass-through (output schema = input schema) — no change needed there
- Frontend: `SortConfig.tsx` component — ordered list of {field, direction} pairs
- Frontend: `PipelineDetailPage` wires `SortConfig` into StepCard and `handleAddStep` initial config
- Frontend: Uses `analyzeColumns` (from the analyze endpoint's inputSchema) for field discovery — no "run pipeline first" requirement
- Config shape: `{"sortBy": [{"field": "fieldName", "direction": "asc"|"desc"}]}`
- Sort is stable; nulls sort last for both asc and desc

## Context
Part of HEL-141 epic (Data Pipeline ops). Prior ops: rename, filter, join, compute, groupby, cast, select, limit, filter-rows.

`PipelineAnalyzeService.inferOutputSchema` already handles `"sort"` at line 64 as a pass-through identity (output schema = input schema, no validation error). No change needed there.

`InProcessPipelineEngine.applyStep` does NOT have a sort case — it would fail with "Unknown step op: sort". Must add `applySort`.

`PipelineStepRoutes.allowedOps` does NOT include `"sort"`. Must add it.

Flyway migration V26 added `limit` to the CHECK constraint. Next migration is V27.

Frontend pattern from LimitConfig/FilterConfig/CastFieldsConfig — use `analyzeColumns` from the analyze endpoint for field discovery in SortConfig.
