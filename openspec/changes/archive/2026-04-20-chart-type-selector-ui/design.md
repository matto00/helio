## Context

ECharts is integrated as of HEL-65. `ChartPanel.tsx` renders a hardcoded line chart via `ReactECharts`
with a fixed `defaultOption`. The panel appearance system (`PanelAppearance`, `PATCH /api/panels/:id`)
stores `background`, `color`, and `transparency` as JSONB — the schema is open-ended so adding
`chartType` requires no migration. `PanelDetailModal.tsx` owns the Appearance tab form and dispatches
`updatePanelAppearance` with a `PanelAppearance` payload.

## Goals / Non-Goals

**Goals:**
- Add `chartType` to `PanelAppearance` (TypeScript + JSON Schema)
- Render a selector in the Appearance tab, visible only when `panel.type === "chart"`
- Live-preview: `ChartPanel` reads `chartType` from `panel.appearance` and switches ECharts option
- Persist on Save (same `updatePanelAppearance` thunk, same endpoint)
- Four supported types: `line`, `bar`, `pie`, `scatter`

**Non-Goals:**
- Area / stacked bar chart types
- Real data series; preview uses placeholder data for all types
- Backend schema validation change (appearance JSONB is already open)

## Decisions

### 1. `chartType` lives in `PanelAppearance`, not a separate field

The backend stores appearance as JSONB and accepts any keys under `appearance`. Adding `chartType`
there avoids a new DB column, a new API endpoint, or a migration. The existing `PATCH /api/panels/:id`
pathway with `updatePanelAppearance` handles persistence unchanged.

Considered: new top-level `chartType` DB column — rejected because it requires a Flyway migration
and Slick model change for a preference that is purely presentational.

### 2. Live preview updates the local state; Save persists

`PanelDetailModal` already manages local appearance state (`background`, `color`, `transparency`)
and only dispatches on Save. `chartType` follows the same pattern: local state drives `ChartPanel`
preview immediately (ChartPanel receives `chartType` as a prop or reads from local draft state),
and the final value is included in the `updatePanelAppearance` payload on submit.

Considered: optimistic dispatch on every selection — rejected because it creates unsaved changes
spread across the store and complicates the discard-warning logic.

### 3. `ChartPanel` receives `appearance` as a prop

Currently `ChartPanel` takes no props. It will accept `appearance: PanelAppearance` so it can render
the correct ECharts option. `PanelContent.tsx` already has the panel in scope and passes appearance
through. This keeps chart logic inside `ChartPanel` and avoids Redux reads inside a leaf component.

### 4. ECharts option switching via a `getChartOption` helper

A pure function `getChartOption(chartType, data?)` returns the correct `EChartsOption` for each
type. Pie charts need a `series[0].type: "pie"` option; bar/line/scatter share the category/value
axis structure. Centralising this makes it straightforward to add chart types later.

## Risks / Trade-offs

- **Pie chart xAxis/yAxis incompatibility** → `getChartOption` must omit `xAxis`/`yAxis` for pie;
  ECharts logs a warning if they are present. Mitigation: conditional axis inclusion in the helper.
- **`isDirty` check in modal** → adding `chartType` to the dirty check requires tracking initial
  value carefully so the discard warning is not spuriously shown. Mitigation: initialise
  `chartType` state from `panel.appearance.chartType ?? "line"` at modal open.

## Planner Notes

- No backend code changes required — JSONB appearance field is already flexible.
- No Flyway migration needed.
- JSON Schema (`schemas/panel.json`) should gain `chartType` as an optional enum to document the
  contract, but it is not enforced server-side (Scala reads JSONB as-is).
- Self-approved: change is wholly additive, no breaking API changes, no new external dependencies.
