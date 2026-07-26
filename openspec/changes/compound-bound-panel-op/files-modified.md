# Files modified — compound-bound-panel-op (HEL-364)

## Backend

- `backend/src/main/scala/com/helio/api/protocols/BoundPanelProtocol.scala` — new wire types
  (`BoundPanelRequest`/`BoundPanelResponse` + nested `BoundSourceSpec`/`BoundPipelineSpec`/
  `BoundPanelSpec`) and their spray-json formatters.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixes `BoundPanelProtocol` into the
  aggregator.
- `backend/src/main/scala/com/helio/api/package.scala` — re-exports `BoundPanelRequest`/
  `BoundPanelResponse` into `com.helio.api` (existing convention every route-referenced protocol
  type follows).
- `backend/src/main/scala/com/helio/domain/panels/PanelBindingSpec.scala` — extracted
  `PanelBindingSpec.evaluate`/`BindabilityResult`/`MissingColumnsReason` (task 1.2), the shared pure
  bindability-check function.
- `backend/src/main/scala/com/helio/services/PanelCapabilityService.scala` — `capabilityFor` now
  delegates to `PanelBindingSpec.evaluate` instead of an inline duplicate (behavior-preserving).
- `backend/src/main/scala/com/helio/services/BoundPanelService.scala` — new service: the
  validate-before-first-write gate, the create-or-reuse-source -> pipeline+steps -> run -> panel
  execution chain, and design.md D5's compensating cleanup.
- `backend/src/main/scala/com/helio/api/routes/BoundPanelRoutes.scala` — new thin route,
  `POST /api/panels/bound`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — constructs `boundPanelService` (after
  `dataSourceService`/`pipelineService`/`pipelineRunService`/`panelService`) and mounts
  `BoundPanelRoutes` ahead of `PanelRoutes` in the authenticated tree.
- `backend/src/test/scala/com/helio/api/routes/BoundPanelRoutesSpec.scala` — new ScalaTest suite (10
  cases): happy path, reuse-existing-source, unsatisfiable-binding rejection, non-bindable-type
  rejection, steps-stage failure + cleanup (inline source and reused source variants), run-stage
  failure + cleanup, cross-tenant 404, zero-row success, and a V41-can't-be-bypassed regression.

## Schemas

- `schemas/bound-panel-request.schema.json` — new, matches `BoundPanelRequest` field set.
- `schemas/bound-panel-response.schema.json` — new, matches `BoundPanelResponse` field set.

## helio-mcp

- `helio-mcp/src/types.ts` — new `BoundPanelResponse` TS mirror.
- `helio-mcp/src/helioApi.ts` — new `createBoundPanel` (single `POST /api/panels/bound` call, no
  client-side composition).
- `helio-mcp/src/tools/write.ts` — new `create_bound_panel` tool registration.
- `helio-mcp/package.json` — new `verify-bound-panel` npm script.
- `helio-mcp/scripts/verify-bound-panel.ts` — new live e2e harness (mirrors `compose.ts`'s
  real-MCP-client style), covering the happy path and a steps-stage failure + cleanup assertion. Run
  live against a real backend during this session (see the executor's final report for the
  transcript).

## OpenSpec

- `openspec/changes/compound-bound-panel-op/tasks.md` — all 20 tasks checked off, with inline notes
  on judgment calls (constructor deps beyond tasks.md's literal list, the "openspec/ path" being this
  project's capability spec-delta format rather than a swagger file, the zero-row-test's `limit`→
  `filter` root-cause fix, and the V41 criterion's by-construction proof).
- `openspec/changes/compound-bound-panel-op/proposal.md`, `design.md`,
  `specs/bound-panel-composition/spec.md`, `specs/mcp-panel-composition-tools/spec.md`,
  `ticket.md`, `skeptic-design-1.md`, `.openspec.yaml`, `workflow-state.md` — pre-existing planning
  artifacts, unmodified by the executor except `tasks.md`'s checkboxes (workflow-state.md was updated
  by the orchestrator prior to this spawn, not by the executor).
