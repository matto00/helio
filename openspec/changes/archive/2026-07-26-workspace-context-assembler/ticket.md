# HEL-371 — Backend workspace-context assembler + GET /api/workspace/context

## Context

Today the only "workspace context" snapshot an agent can read is `buildWorkspaceContext` in `helio-mcp/src/context.ts` — a **client-side fan-out** over existing REST endpoints (list sources/types/dashboards/pipelines + one analyze per pipeline). It is TypeScript-only and lives in the MCP process; there is no server-side equivalent.

The In-App NL Authoring endpoint (HEL-341) runs Claude server-side and needs the same grounding without shelling out to the MCP. This ticket builds the backend assembler + a read endpoint that returns structural parity with the MCP `WorkspaceContext` shape, so the in-app authoring path and any future backend agent path can ground on one source of truth. It is the foundation the richer-grounding tickets (sample rows, column stats, semantic hints) extend.

Touches: new `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala`, a new route (e.g. `api/routes/WorkspaceContextRoutes.scala`) wired in `api/ApiRoutes.scala` (see the `authenticatedUser` router block ~line 215), a new protocol in `api/protocols/` + formatters in `JsonProtocols.scala`, and a new `schemas/workspace-context.schema.json`.

## Scope

* Backend Scala: `WorkspaceContextService` that composes the EXISTING services/repos (`DataSourceService`/`DataSourceRepository`, `DataTypeRepository`, `PipelineService` incl. `analyze`, `DashboardService`) under the caller's RLS context — no direct DB access beyond the repos those services already use, mirroring the composition discipline of `DashboardProposalService`. Never inline fully-qualified names (import at top).
* Backend Scala: `GET /api/workspace/context` route returning the assembled snapshot; owner/RLS-scoped exactly like the other authenticated routers.
* Protocol + `JsonProtocols` formatters for the response; field-for-field structural parity with the MCP `WorkspaceContext` interface (`counts`, `dataSources`, `dataTypes` with `columns`/`computedColumns`/`pipelineOutput`, `pipelines` with `steps`+`outputColumns`, `dashboards` with `panelCount`).
* schemas: add `schemas/workspace-context.schema.json` (JSON Schema 2020-12) as the contract; note it in `openspec/` if an OpenAPI path list is maintained there.
* Tests: ScalaTest coverage that the endpoint returns only resources visible to the caller (RLS), classifies pipeline-output vs source-companion DataTypes correctly (sourceId null = pipeline output), and includes per-step output columns.

## Acceptance criteria

- [ ] `GET /api/workspace/context` returns `200` with a body validating against `schemas/workspace-context.schema.json`.
- [ ] The response is RLS-scoped: a user sees only their own (or shared-to-them) sources/types/pipelines/dashboards, verified by test.
- [ ] `dataTypes[].pipelineOutput === (sourceId == null)`; source-companion types are flagged non-bindable, matching the MCP classifier and the V41 rule.
- [ ] `pipelines[].steps[].outputColumns` is populated from the analyze path; an analyze failure for one pipeline degrades to an empty steps list + an error marker (mirror `context.ts` `stepsError`) rather than failing the whole request.
- [ ] Structural parity with `helio-mcp/src/context.ts` `WorkspaceContext` is documented in the schema description.
- [ ] New ScalaTest suite passes; `sbt test` green.
- [ ] Backward-compat: purely additive — a new endpoint + schema; no existing wire shape changes.

## Out of scope

* Sample rows, column statistics, semantic/relationship hints, token budgeting (separate HEL-345 tickets that extend this assembler).
* Any Claude call or NL parsing (HEL-341).
* Changing the MCP `get_workspace_context` implementation (it may later call this endpoint, but this ticket only adds the backend surface).

## Dependencies

* None hard. Consumed by HEL-341 (in-app authoring grounding) and extended by the other HEL-345 tickets.

## Epic context (from orchestrator brief)

This is ticket 1 of 5 in the HEL-345 "Richer Agent Grounding" epic, delivered sequentially. The remaining four (HEL-372 sample rows, HEL-373 column statistics, HEL-374 semantic/joinability hints, HEL-377 token-budget controls) all build on the assembler created here, so **the extension seams matter more than usual** — design the context payload so per-DataType enrichment can be added without reshaping it.

Prior art to read before planning:
- `helio-mcp/src/context.ts` — `buildWorkspaceContext`, the existing client-side fan-out this ticket ports server-side. It is the de-facto contract; match its shape unless there's a reason not to (and say so in design.md).
- `backend/src/main/scala/com/helio/api/WorkspaceRoutes.scala` — already exists but carries only the `teardown` route from HEL-366. Mount the new context route here.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala:354` — how `WorkspaceRoutes` is currently wired (note the `Option`-guarded service pattern).
- `backend/src/main/scala/com/helio/api/AuthDirectives.scala` — HEL-369 added `confineScopedToken` above the whole `pathPrefix("api")` branch split. A scoped PAT must not read the full workspace; check this explicitly in design.

## Design-gate attention (from orchestrator brief — resolve, do not defer)

- **RLS/ACL scoping.** The assembler fans out across sources, DataTypes, pipelines, and dashboards — every one of those reads must be owner-scoped. A cross-tenant existence leak was found in HEL-363 (403 where it should have been 404); do not repeat it.
- **N+1 cost.** The TS version issues one `analyze` per pipeline. A server-side version doing the same is a performance trap on a large workspace. Decide deliberately and document the choice.
