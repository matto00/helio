## Why

Smart pipeline shapes (registry, catalog, and `POST /api/pipeline-shapes/:id/expand`) shipped on `main`
via HEL-391/393/394/396/398/402, plus an in-app editor UX. Agents driving `helio-mcp` still have no way
to reach them — `create_pipeline` + `add_pipeline_step` only, hand-assembling raw step lists. An agent
asked to "make a top-N of revenue by region" has to reinvent a shape the backend already validates and
guarantees an output contract for.

## What Changes

- Add `list_pipeline_shapes` (read tool): thin pass-through of `GET /api/pipeline-shapes`, mirroring
  the existing `list_connectors` pattern.
- Add `create_pipeline_from_shape` (write tool): validates params against the shape's own `expand`
  first (`POST /api/pipeline-shapes/:id/expand`), then creates the pipeline and adds the returned steps
  in order — composing existing endpoints client-side, no new backend endpoint or duplicated
  expand/validation logic.
- Extend `buildWorkspaceContext` with a `pipelineShapes` catalog snapshot (one extra fan-out call) so a
  planning agent sees the shape vocabulary alongside data sources/types/pipelines/dashboards in a
  single `get_workspace_context` call, rather than guessing shape ids.
- Tool descriptions document every registered shape id (`passthrough`/`single-row`/`top-n`/
  `time-series`/`pivot-matrix`) and its params, mirroring `add_pipeline_step`'s per-op documentation
  convention.
- `propose_dashboard`/`apply_proposal` are left unchanged — see design.md for why shape references do
  not thread through the no-writes proposal path.

## Capabilities

### New Capabilities

- `mcp-pipeline-shape-tools`: MCP tool surface for discovering and instantiating smart pipeline shapes
  (catalog read tool, shape-to-pipeline instantiation tool, workspace-context catalog exposure).

### Modified Capabilities

(none — no backend/API contract changes; `pipeline-shape-registry`'s existing endpoints are consumed
as-is)

## Impact

- `helio-mcp/src/helioApi.ts`, `helio-mcp/src/tools/write.ts`, `helio-mcp/src/tools/read.ts`,
  `helio-mcp/src/context.ts`, `helio-mcp/src/types.ts` — new tool registrations, API wrappers, types.
- No backend code changes; no schema changes; no Flyway migration.

## Non-goals

- No new backend endpoint (HEL-402's `expand` endpoint is reused, not duplicated).
- No conversational shape refinement (HEL-343).
- No `propose_dashboard` shape-reference threading (see design.md Decision 4).
