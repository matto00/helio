## Why

`get_workspace_context` still sends one `GET /api/pipelines/:id/analyze` per pipeline, so one call costs
8 + 1 + P + Op + D requests and crosses the default 120/60s API rate limit from roughly 100 pipelines (HEL-1625,
follow-up to HEL-1619).

## What Changes

- New additive backend read `GET /api/pipelines/context-analyze`: for every pipeline `GET /api/pipelines` returns
  for the caller (owner-scoped, same item set and order as `/api/pipelines/context-details`), the `steps` and
  `warnings` exactly as `GET /api/pipelines/:id/analyze` returns them for that caller, in one response, with a
  statement count that does not grow with P.
- helio-mcp `get_workspace_context` reads it once and uses it instead of per-pipeline analyze. A pipeline absent
  from the batch (or a 404 / failing / malformed batch) falls back to per-pipeline analyze, so the payload stays
  byte-identical to the HEL-1619 golden on every path.
- Request bound becomes 8 + 2 + Op + D + A (A = pipelines absent from the batch), constant in P.
- Committed JSON schema for the new response, validated by the backend route spec and by the MCP fake (seam guard).
- README "Context serializer" budget text updated; no MCP deploy in this change.

## Capabilities

### New Capabilities
- `pipeline-context-analyze-read`: the batched, owner-scoped analyze steps/warnings read.

### Modified Capabilities
- `mcp-workspace-context-request-budget`: the request bound drops the per-pipeline analyze term and gains a
  fallback rule for the new read.

## Non-goals

- No change to `GET /api/pipelines/:id/analyze` (status, body or headers) or to its grantee shaping.
- No cost verdict, schema drift, `sourceSchemas` or `callerRole` in the batch: the MCP does not read them.
- No widening of `get_workspace_context` to shared pipelines.
- No MCP deploy, no migration, no frontend change.

## Impact

- Backend: `PipelineAnalyzeReads` (shared projection), `PipelineService`, `DataSourceRepository` (batched by-id
  reads), a new route class mounted before `PipelineRoutes` in `ApiRoutes`, a new protocol.
- `schemas/pipelines/pipeline-context-analyze-response.schema.json`.
- helio-mcp: `helioApi.ts`, `types.ts`, `context.ts`, the budget fixture/tests, the live probe, README.
