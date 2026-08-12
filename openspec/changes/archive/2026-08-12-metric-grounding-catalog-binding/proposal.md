## Why

An agent can already CREATE defined metrics (HEL-493/HEL-541) and the backend can already bind a
panel to a `metricId` (HEL-500). But the agent's grounding snapshot (`get_workspace_context`) never
surfaces the metric catalog, and the `propose_dashboard`/`apply_proposal` wire never accepts a
`metricId`. Without this, an agent composing a dashboard cannot discover or reuse a defined metric —
it can only re-derive a raw `dataTypeId`/`fieldMapping` binding, defeating the point of a semantic
layer.

## What Changes

- `helio-mcp/src/context.ts`: add a `metrics` array to `WorkspaceContext`, sourced from the existing
  `api.listMetrics()` (already wired for HEL-541's `list_metrics` tool — no new HTTP method needed).
  Update `get_workspace_context`'s tool description (`read.ts`).
- `helio-mcp/src/tools/proposal.ts` + `types.ts`: add optional `metricId` to the proposal `panelSchema`
  / `ProposalPanel`. `propose_dashboard`'s read-only check warns (non-blocking, reflected in
  `applyReady`) when a panel's `metricId` is missing/not-owned/deprecated, or set on a panel type that
  doesn't support it (`metric`/`chart`/`table` only, matching HEL-500's actual scope).
- `ProposalPanel` (backend protocol) gains `metricId: Option[String]`. `ProposalPanelSupport`
  (`preValidateBindings`/`buildCreateRequest`/`buildDataConfig`) validates and threads it through,
  reusing the HEL-500 `MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig` `metricId` slot —
  `dataTypeId` remains required for these panel kinds exactly as today; `metricId` is additive.
  `preValidateBindings` REJECTS (400, nothing created) a missing/non-owned/deprecated/
  type-unsupported `metricId`, run before any dashboard or panel is created.
  `DashboardContentsService` (shares `ProposalPanelSupport`) gets the same check for free.
- `schemas/dashboard-proposal.schema.json`: add `metricId` to `ProposalPanel`.

## Capabilities

### Modified Capabilities

- `mcp-metric-tools`: `get_workspace_context` advertises the metric catalog (mirrors the existing
  `pipelineShapes`-catalog requirement in `mcp-pipeline-shape-tools`).
- `mcp-panel-composition-tools`: proposal panels accept `metricId`, validated and threaded through the
  existing HEL-500 metric-binding config path.

## Impact

- `helio-mcp/src/context.ts`, `context.test.ts`, `tools/read.ts`, `tools/proposal.ts`, `types.ts`.
- `backend/.../api/protocols/DashboardProposalProtocol.scala`, `services/ProposalPanelSupport.scala`,
  `services/DashboardProposalService.scala`, `services/DashboardContentsService.scala`,
  `api/ApiRoutes.scala` (thread `metricRepo` into both services, mirroring `PanelService`'s existing
  nullable-for-fixtures convention).
- `schemas/dashboard-proposal.schema.json`.
- Out of scope: the backend `GET /api/workspace/context` endpoint (`workspace-context-assembly`) —
  the ticket scopes grounding to `helio-mcp/src/context.ts` only; `CollectionPanelConfig`/
  `TimelinePanelConfig` `metricId` support (418-C never added it there); metric authoring UI (418-F)
  and governance (418-G).
