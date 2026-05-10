## Why

Helio's v1 pipeline engine needs a Cast Type operation so users can override inferred field types
(e.g. string → number, string → date) before downstream steps or chart bindings consume the data.
This is the third of eight planned v1 pipeline operations (after Select and Rename).

## What Changes

- Add `"cast"` to the backend op enum and `allowedOps` list
- Implement `applyCast` in `InProcessPipelineEngine` with runtime cast validation and error surfacing
- Add `inferCast` output-schema logic in `PipelineAnalyzeService` (may already exist from HEL-233)
- Add `CastFieldsConfig` React component: table of source field + target-type dropdown rows
- Add `"cast"` entry to `OP_TYPES` in the frontend pipeline editor
- Seed initial empty cast config on step creation; hydrate from persisted config on reload
- Surface per-field cast errors in the pipeline preview panel

## Capabilities

### New Capabilities
- `pipeline-cast-op`: Backend `applyCast` + frontend `CastFieldsConfig` for the Cast Type pipeline step

### Modified Capabilities
- `pipeline-analyze-api`: `inferCast` already produces outputSchema; verify config shape alignment
  with `applyCast` (same lesson as HEL-188)
- `pipeline-edit-flow`: registers the new "cast" op type in `OP_TYPES` and routes to `CastFieldsConfig`
- `pipeline-run-execution`: surfaces per-field cast errors returned by `applyCast`

## Impact

- Backend: `InProcessPipelineEngine.scala`, `PipelineAnalyzeService.scala`, op enum/allowedOps,
  backend tests
- Frontend: `OP_TYPES` registry, new `CastFieldsConfig.tsx` component, pipeline editor routing,
  existing pipeline slice (no new API endpoints needed)
- No schema migrations; no new REST endpoints; no breaking API changes

## Non-goals

- Chained/nested casts in a single step
- User-defined custom type coercion rules
- Cast validation at analyze time (errors are runtime-only; outputSchema uses declared type)
