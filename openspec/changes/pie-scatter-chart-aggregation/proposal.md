## Why

HEL-292 shipped chart-panel viz-level aggregation (`{groupBy, agg, yField}`) but restricted it to bar/line
charts via a hardcoded guard in `ChartPanel.tsx`. A pie or scatter chart with a valid `aggregation` spec
gets it silently discarded at render time, with no signal anywhere (schema, MCP tool description, or UI)
that the combination is unsupported. Pie is the chart type where aggregation matters most — a pie of raw
un-grouped rows is almost never the intended output — so this silent gap ships broken panels.

## What Changes

- Extend chart aggregation to **pie**: a pie chart with an `aggregation` spec renders one slice per
  `groupBy` value, sized by `agg(yField)` — the same categories/values pipeline bar/line already use,
  reshaped to ECharts' `{name, value}` pie data shape.
- **Reject** the scatter + `aggregation` combination loudly: scatter plots raw `{x, y}` coordinate pairs
  (plus optional size/color dimensions) — a `groupBy` categorical aggregate has no coordinate semantic for
  it, so this is a genuine configuration mismatch, not a missing feature. Validate at every panel
  create/update path — single create, batch create, replace-contents, apply-proposal, single update, batch
  update, and dashboard-snapshot import — and return a 400 naming the conflict instead of silently
  discarding the spec at render. **BREAKING** for any caller currently relying on a scatter panel silently
  accepting (and ignoring) an `aggregation` spec on write — it now 400s instead.
- Hide the Aggregation editor section for a scatter-typed chart panel in the config UI, with an inline
  note explaining why, so a human editor gets the same signal an API caller now gets.
- Document the restriction in `schemas/panel.schema.json` and the MCP `create_panel` tool description
  (currently silent on `aggregation` entirely for chart panels).
- Existing pie panels that already carry a stray `aggregation` spec will start rendering aggregated
  instead of raw-per-row — treated as the fix, not a regression (the raw-row render was never the
  intended output for those panels).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `panel-viz-aggregation`: chart aggregation now applies to `bar`/`line`/`pie` (was `bar`/`line`); a
  chart panel's `aggregation` spec combined with `chartType: "scatter"` is rejected at create/update
  instead of silently ignored at render.
- `echarts-chart-panel`: the aggregate render path gains a pie-shaped data mapping; the pie/scatter
  aggregation-precedence scenario is replaced with pie-honors / scatter-rejected scenarios.

## Impact

- Frontend: `ChartPanel.tsx` (render guard + pie aggregate mapping), `BindingEditor.tsx` /
  `ChartAggregationFields.tsx` (hide for scatter), `aggregate.ts` tests, `ChartPanel.test.tsx`.
- Backend: `PanelService`/`PanelServiceHelpers` (cross-field create/update/batch validation),
  `ChartPanelConfig`/`ChartPanel.validateConfig` (currently a no-op `Right(())`),
  `ProposalPanelSupport.validatePanel` (apply-proposal and replace-contents both funnel through this
  shared pre-write check, not `PanelService.buildForCreate` — their `chartType` never reaches that call),
  `DashboardServiceValidation.validatePanelEntries` (dashboard-snapshot import — a fifth, structurally
  separate enforcement site discovered during the design gate; see design.md's Non-Goals for the scope
  boundary — this ticket adds only the scatter+aggregation check there, not general import validation).
- Contracts: `schemas/panel.schema.json`, `helio-mcp/src/tools/write.ts` (`create_panel` description).
- No change to `panel-capability-introspection` / `PanelBindingSpec` — verified it documents
  `fieldMapping` slots only, not chart-type-specific aggregation semantics; nothing to keep in sync.
- Spinoff filed under HEL-344: "dashboard import bypasses panel appearance and cross-field validation" —
  tracks bringing `POST /api/dashboards/import` up to parity with every other write path (it currently
  enforces no cross-field rule at all, not even the pre-existing `chartType` enum check).
