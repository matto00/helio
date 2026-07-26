## Why

The only "workspace context" snapshot an agent can read today is `buildWorkspaceContext` in
`helio-mcp/src/context.ts` — a client-side fan-out over existing REST endpoints, TypeScript-only,
living in the MCP process. The in-app NL authoring path (HEL-341) runs Claude server-side and needs
the same grounding without shelling out to the MCP. This is also the foundation the remaining
HEL-345 grounding tickets (sample rows, column stats, semantic hints, token budgeting) extend, so
the payload shape needs stable per-DataType/per-pipeline extension seams from day one.

## What Changes

- New `WorkspaceContextService` composing the caller's existing owner-scoped services/repos
  (`DataSourceService`, `DataTypeRepository`, `PipelineService`, `DashboardService`) — no direct
  DB access.
- New `GET /api/workspace/context` route mounted on `WorkspaceRoutes` alongside the existing
  HEL-366 teardown route, authenticated the same way as every other router in the
  `authenticatedUser` block.
- Explicit scoped-PAT denial: a `TokenScope`-confined caller gets `403`, not a workspace-wide read
  — `confineScopedToken` currently only allows scoped tokens onto `hooks`, so this is enforced by
  routing, verified by a dedicated test.
- New response protocol + `JsonProtocols` formatters, field-for-field structural parity with the
  MCP `WorkspaceContext` (`counts`, `dataSources`, `dataTypes` w/ `columns`/`computedColumns`/
  `pipelineOutput`, `pipelines` w/ `steps`+`outputColumns`, `dashboards` w/ `panelCount`).
- New `schemas/workspace-context.schema.json` (JSON Schema 2020-12) as the wire contract.
- Per-pipeline `analyze` failures degrade to `steps: []` + a `stepsError` marker, not a whole-request
  failure (mirrors `context.ts`).

## Capabilities

### New Capabilities

- `workspace-context-assembly`: server-side assembler + `GET /api/workspace/context` producing an
  owner-scoped snapshot of sources, DataTypes, pipelines (with per-step output columns), and
  dashboards, structurally parallel to the MCP `WorkspaceContext`, extensible by later HEL-345
  tickets without reshaping.

### Modified Capabilities

(none — purely additive; `workspace-tag-teardown` is untouched)

## Impact

- Affected code: `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala` (new),
  `backend/src/main/scala/com/helio/api/WorkspaceRoutes.scala` (new route added), `ApiRoutes.scala`
  (wiring only, no new `Option`-guard needed — reuses existing services), `JsonProtocols.scala`
  (new formatters), `schemas/workspace-context.schema.json` (new).
- No existing wire shape changes; no migrations.
- Consumed by HEL-341 (in-app authoring) and extended by HEL-372/373/374/377.

## Non-goals

- Sample rows, column statistics, semantic/relationship hints, token budgeting (later HEL-345
  tickets).
- Any Claude call or NL parsing (HEL-341).
- Changing the MCP `get_workspace_context` implementation.
