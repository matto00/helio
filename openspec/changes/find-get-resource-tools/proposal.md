## Why

HEL-659's top-level assistant needs to fetch only what's relevant to a given conversational turn,
not `WorkspaceContextService`'s full eager workspace dump (723 lines, every source/DataType/
pipeline/dashboard with full detail, on every call). It needs two narrower primitives: a keyword
search returning compact summaries, and a targeted single-resource detail fetch — the `find`/
`get_resource` tool pair the design spec (`docs/superpowers/specs/2026-08-14-top-level-assistant-
design.md`) calls for.

## What Changes

- Add `WorkspaceSearchService` (`com.helio.services`) with two methods:
  - `find(user, query, resourceTypes?)`: keyword/substring match over name (and description, where
    one exists) across data sources, DataTypes, pipelines, dashboards, and metrics. Returns compact
    summaries (id, type, name, one-line description) for matches — no embeddings/vector search.
  - `getResource(user, id, resourceType)`: full per-resource detail for one specific resource,
    reusing `WorkspaceContextService`'s existing per-entry assembly logic (widened to
    `private[services]`, mirroring the existing `buildPipeline` precedent) rather than duplicating
    it — same level of detail `WorkspaceContextService` already includes for that type today.
  - Metrics are a new fifth resource type not currently modeled by `WorkspaceContextService` at
    all; `getResource` builds metric detail directly from the existing `MetricDefinition` domain
    object (already a complete definition — no new assembly logic needed).
- Add `WorkspaceAssistantTools`: `ClaudeTool` schema definitions for `find`/`get_resource` (HEL-660's
  `ClaudeTool(name, description, inputSchema)` shape), so HEL-662 can wire them straight into
  `ClaudeClient.sendWithTools`'s `tools` list.
- Add thin `findById` wrappers to `DashboardService`/`DataSourceService` (mirroring
  `DataTypeService.findById`'s existing shape over the repository's own `findByIdOwned`) — needed
  because `getResource` must fetch a single owned resource, and today only `DataTypeService`/
  `MetricService`/`PipelineService` (via `findSummaryById`) expose that at the service layer, even
  though every repository already has `findByIdOwned`.
- No route/API surface yet — HEL-662 (`AssistantService`) is the tool-use loop that will actually
  call these; this ticket is the backing methods + tool schemas only.

## Capabilities

### New Capabilities

- `workspace-resource-search`: keyword search (`find`) and single-resource detail fetch
  (`get_resource`) over the workspace, exposed as Claude tool schemas.

### Modified Capabilities

(none — `workspace-context-assembly` is untouched; it continues backing the unchanged
`GET /api/workspace/context` MCP-facing endpoint per HEL-631)

## Impact

- `backend/src/main/scala/com/helio/services/`: new `WorkspaceSearchService.scala`; `DashboardService`,
  `DataSourceService` gain a `findById` method each; `WorkspaceContextService`'s `toDataSourceEntry`,
  `toDataTypeEntry`, `toDashboardEntry` widen from `private` to `private[services]`.
- `backend/src/main/scala/com/helio/services/` (new file `WorkspaceAssistantTools.scala`,
  co-located with `WorkspaceSearchService` — see design.md D7): `ClaudeTool` schema definitions for
  `find`/`get_resource`.
- New wire/domain types for compact summaries and per-type resource detail (reusing existing
  `WorkspaceContext*` types from `WorkspaceContextProtocol.scala` where they already exist).
- No schema/migration changes; no frontend changes; no route wiring (HEL-662).

## Non-goals

- No embeddings/semantic search — keyword/substring matching only, per the design spec's Non-goals.
- No route/API endpoint — these are backing methods for the future tool-use loop (HEL-662).
- No changes to `WorkspaceContextService.assemble`'s existing behavior, response shape, or tests.
