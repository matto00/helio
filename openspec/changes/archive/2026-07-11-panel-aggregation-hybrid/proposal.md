## Why

Metric panels render `rows[0]` and charts plot one mark per row, so any "count of X" / "avg Y by Z"
view needs a dedicated `aggregate` pipeline. Prod validation needed 4 pipelines for one 7-panel
dashboard — untenable for agent-built dashboards. HEL-291 locked the hybrid decision: pipelines keep
owning transform/typing; panels gain BI-style viz-level aggregation for the common case.

## What Changes

- Metric panel config gains an optional aggregation spec `{ value: <field>, agg: count|sum|avg|min|max }`.
  When present, the metric's `value` slot renders the aggregate over ALL rows bound to the panel's
  DataType, not `rows[0]`.
- Chart panel config gains an optional aggregation spec `{ groupBy: <field>, agg: <fn>, yField: <field> }`.
  When present, `ChartPanel` groups rows by `groupBy` and plots one aggregate mark per group instead of
  one mark per row.
- Aggregation is computed client-side over the full row set already returned by
  `GET /api/types/:id/rows` (the frontend already fetches all rows and paginates in-memory; no new
  backend query path is needed). A shared frontend `aggregate` utility reimplements the pipeline
  `aggregate` step's semantics (sum/avg/min/max/count, null-tolerant) so behavior matches.
- Wire the aggregation spec through: `MetricPanelConfig`/`ChartPanelConfig` (frontend + backend domain
  + codec + patch), `schemas/panel.schema.json`, the `propose_dashboard`/`apply_proposal` MCP tool
  schemas + `dashboard-proposal.schema.json`, and the `BindingEditor` panel-editing UI.
- Backwards compatible: omitted aggregation spec renders exactly as today (`rows[0]` for metric,
  one-mark-per-row for chart).

## Non-goals

- No backend-side aggregation query path (Spark/SQL push-down) — deferred; this is a frontend
  rendering-layer feature only.
- No changes to dedicated aggregate-pipeline behavior (`AggregateStep`) — it remains valid for heavy
  or shared/reused compute.
- No metric `unit`/`label`-literal fixes or chart sub-type/axis/color config depth — those are HEL-291's
  sibling workstream ("Proposal & panel config depth"), out of scope here.
- No agent-creatable CSV/REST/SQL sources — separate HEL-291 workstream.

## Capabilities

### New Capabilities

- `panel-viz-aggregation`: metric/chart panel-level aggregation spec (config shape, rendering
  semantics, propose/apply-proposal + MCP wire contract).

### Modified Capabilities

- `panel-datatype-binding`: `BindingEditor` UI gains aggregation controls alongside field mapping for
  metric/chart panels; `updatePanelBinding` payload carries the aggregation spec.
- `echarts-chart-panel`: chart rendering supports a grouped/aggregated data option in addition to the
  existing per-row plotting path.

## Impact

- Frontend: `frontend/src/features/panels/types/panel.ts`, `usePanelData.ts`, `ChartPanel.tsx`,
  `BindingEditor.tsx`, `panelSlots.ts`, `panelThunks.ts`/`panelService.ts`, new `utils/aggregate.ts`.
- Backend: `domain/panels/MetricPanel.scala`, `domain/panels/ChartPanel.scala` (config + patch +
  tolerant decode), `PanelConfigCodec.scala`.
- Contracts: `schemas/panel.schema.json`, `schemas/dashboard-proposal.schema.json`.
- MCP: `helio-mcp/src/tools/proposal.ts` (`panelSchema`), `helio-mcp/src/types.ts` (`ProposalPanel`).
