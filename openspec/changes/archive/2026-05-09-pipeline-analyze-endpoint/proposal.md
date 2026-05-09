## Why

Pipeline op editors (Select, Rename, Cast, Filter, Compute, Aggregate, Limit, Sort) all need the list of
fields available at each step. Today the only path is running the pipeline and reading `runResult.rows[0]`
keys — a fragile contract that caused HEL-187 to spin four evaluator cycles. Schema inference is pure math:
source DataSource has a known field list, and each op transforms it deterministically.

## What Changes

- **New endpoint** `GET /api/pipelines/:id/analyze` returns the pipeline + its full ordered step list;
  each step carries `inputSchema` and `outputSchema` (array of `{ name, type }` objects).
- **Backend schema inference** for all 8 ops: select (filter fields), rename (replace names), cast (retype),
  filter/limit/sort (identity), compute (append outputs), aggregate (groupBy + agg aliases). Malformed
  or referencing-nonexistent-field configs emit a per-step `validationError` and treat the step as identity
  for downstream inference.
- **JSON Schema + OpenAPI** spec for the response added; `npm run check:schemas` must pass.
- **Frontend** wires `pipelinesService.analyze()` → Redux thunk → `SelectFieldsConfig` reads inferred
  schema instead of `runResult`. The "run the pipeline first" fallback prompt is **removed** — the checklist
  always has data from the analyze response (may be empty if source has no schema).

## Capabilities

### New Capabilities

- `pipeline-analyze-api`: `GET /api/pipelines/:id/analyze` — returns pipeline + steps with per-step schemas

### Modified Capabilities

- `pipeline-select-op`: the "no run result → show prompt" fallback is replaced by always using analyze response

## Non-goals

- Caching inference results (recompute on each call; cheap — no data I/O)
- Running actual data through the pipeline
- Modifying `GET /api/pipelines/:id` or `GET /api/pipelines/:id/steps`
- Implementing engine logic for HEL-188–194 ops (only inference rules, not execution)

## Impact

- New backend route in `PipelineRoutes.scala`, new case classes in `JsonProtocols.scala`
- New `SchemaInferenceService` (or inline in routes) for pipeline op schema math
- New JSON Schema file `schemas/pipeline-analyze-response.json`
- New OpenAPI spec fragment
- Frontend: new `pipelinesService.analyze()`, new Redux thunk in `pipelinesSlice`, updated `SelectFieldsConfig`
