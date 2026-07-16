# Design — per-chart-type-config (HEL-248)

## Context

`appearance.chart.chartType` selects the rendered chart type (`ChartAppearanceEditor` → appearance PATCH), while data
binding/aggregation live in `ChartPanelConfig` (`BindingEditor` → `updatePanelBinding` typed-config PATCH). Rendering
is `ChartPanel.tsx`: `appearanceToEChartsOption` + `buildDataOption`/`buildAggregateDataOption`. The HEL-253/HEL-255
precedent (V53/V55, `TablePanelConfig.columnWidths`/`density`/`columnOrder`) defines the end-to-end pattern for
persisted typed config: TS type + `panel.schema.json` + Scala `decode`/`Patch` + `RequestValidation` allow-lists +
`PanelRowMapper` both arms + `PanelRepository` config-column write + nullable Flyway column, absent = old behavior.

## Goals / Non-Goals

**Goals:** type-appropriate options for all four chart types, persisted per type; live section swap in the edit pane;
zero migration for existing panels; every control maps to a real ECharts option.
**Non-Goals:** moving `chartType` out of appearance; changing fieldMapping slot semantics; normalized-stack server
computation (client transform, see D4).

## Decisions

### D1 — Storage: one nullable `chart_options` JSONB column, keyed per chart type

`ALTER TABLE panels ADD COLUMN chart_options JSONB` (V56). Value is the whole per-type-keyed object:
`{"line":{...},"bar":{...},"pie":{...},"scatter":{...}}`, each key optional. This follows the `aggregation`/
`column_order` JSONB-column precedent (one concern per column; the concern here is "chart display options").
*Alternative rejected:* one column per option (~10 columns, unbounded as types grow); folding into `field_mapping`
(display state is layered on the binding, not part of it — V55 comment).
Keying per type means switching bar→pie→bar restores the bar settings — nothing is destroyed on a type switch, which
is the acceptance criterion generalized.

### D2 — Wire/domain shape: typed `ChartOptions` on `ChartPanelConfig`

- TS (`panel.ts`): `LineChartOptions { smooth?, showPoints?, areaFill? }` (booleans);
  `BarChartOptions { orientation?: "vertical"|"horizontal", stacking?: "none"|"stacked"|"normalized",
  barGapPct?: number }`; `PieChartOptions { donutHolePct?: number, showPercentLabels?: boolean }`;
  `ScatterChartOptions { sizeField?: string, colorField?: string }`;
  `ChartTypeOptionsMap { line?, bar?, pie?, scatter? }`; `ChartPanelConfig.chartOptions?: ChartTypeOptionsMap`.
- Scala (`ChartPanel.scala`): mirrored case classes with `Option` fields; `ChartPanelConfig.chartOptions:
  Option[ChartOptions]`. `decode` tolerates missing/invalid keys (read-path tolerance per `PanelRowMapper` doc);
  `Patch` gains `chartOptions: Option[Option[ChartOptions]]` (absent / null-clears / replaces, like `aggregation`).
- Validation (PATCH/create): allow-list enums (`orientation`, `stacking`), numeric clamps `barGapPct ∈ [0,100]`,
  `donutHolePct ∈ [0,90]`; invalid enum → 400 (HEL-255 `density` precedent, via `RequestValidation`/domain decode).
- **spray-json pitfall:** `Option=None` is omitted on the wire — treat *absent* as "keep default", test decode with
  fields ABSENT, and update `PanelRowMapper` **both** arms (`chartConfig` read + `domainToRow` chart-arm write; a
  missed write arm silently drops options on dashboard duplicate/snapshot — the HEL-245/255 sibling-bug class).

### D3 — Editor: `ChartDisplayFields` + `useChartDisplayState` inside the binding save path

New `editors/ChartDisplayFields.tsx` + `editors/useChartDisplayState.ts`, mirroring `TableDisplayFields`/
`useTableDisplayState` exactly (dirty tracking, `reset()`, `patch` riding `updatePanelBinding`). The section renders
for `panel.type === "chart"`, titled "Display", and swaps its controls on the **live** chart type: `PanelDetailModal`
passes `chartType={chartAppearance.chartType}` down to `BindingEditor` (modal already owns `chartAppearance` state),
so changing type in the Appearance section swaps the Display section before save. Controls use shared `Select` +
the existing checkbox/slider patterns from the Epic A config language (`BoundOrLiteralField` family lives here too;
scatter's `sizeField`/`colorField` use field `Select`s built from `fieldOptions(selectedType)` with a "— None —"
clear option, like `aggFieldOptions`). Editing options for the currently-selected type merges into the keyed map —
other types' entries pass through untouched.
*Alternative rejected:* putting the section in `ChartAppearanceEditor` — options persist in `config`, not
appearance; splitting UI-state ownership from its save path would tangle the two PATCHes.

### D4 — ECharts mapping (no fake controls)

- Line: `series.smooth`, `series.showSymbol`, `series.areaStyle: {}`.
- Bar: horizontal = swap axis roles (category axis becomes `yAxis`, value axis `xAxis`); stacked =
  `series.stack: "total"`; normalized = `series.stack` **plus** client-side percent transform of each category's
  values (ECharts has no native normalized stack) with y-axis `max: 100`, `axisLabel: '{value}%'`;
  group spacing = `series.barCategoryGap: "<n>%"`.
- Pie: donut = `series.radius: ["<hole>%", "70%"]`; percent labels = `series.label { show, formatter: "{b}: {d}%" }`.
- Scatter: `sizeField` adds a third data dimension + `series.symbolSize` scaling function (clamped px range);
  `colorField` groups rows into one series per distinct value (legend entries) — both are real ECharts constructs.
- Applied in `ChartPanel.tsx` for both `buildDataOption` and `buildAggregateDataOption` (bar/line aggregate path).
  `compact` (mobile) merging happens last and is unchanged.

### D5 — `BindingEditor.tsx` split

At 400 lines it sits on the CONTRIBUTING.md threshold; adding the chart section pushes past. Extract the
metric-only Value/Label/Unit block into `editors/MetricBindingFields.tsx` (presentational, state stays in hooks) so
`BindingEditor` stays under 400 while gaining the chart Display wiring. No behavior change in the extraction.

### D6 — Creation modal parity

`ChartTypeConfig` (`panel.ts`) and `ChartCreatorFields` add `"scatter"` so all four types are first-class at
creation. No per-type options at creation (edit-pane concern).

## Risks / Trade-offs

- [Normalized stacking is a client transform] → documented here + inline; values recompute per render; tests pin the
  percent math.
- [Two PATCH paths touched in one Save (appearance chartType + config chartOptions)] → both already ride the same
  Save flow (`accumulatePanelUpdate` then editor `save()`); acceptance test covers "switch type + save loses nothing".
- [JSONB blob less greppable than typed columns] → bounded, documented shape in schema `$defs`; same trade-off
  already accepted for `aggregation`.
- [Mobile control density] → extend the HEL-245/255 `@media (max-width: 768px)` block in `PanelDetailModal.css`
  (≥44px touch targets) and its CSS-lock test (`PanelDetailModal.css.test.ts`).

## Migration Plan

V56 nullable column; NULL = no options = exact current rendering. Rollback = drop column. No data migration.

## Planner Notes (self-approved)

- Ticket's "Line: series (multi), x-axis field" and "Scatter: x/y field" are already served by existing
  `fieldMapping` slots (`xAxis`/`yAxis`/`series`) — not duplicated into chartOptions.
- Scatter `sizeField`/`colorField` live in `chartOptions.scatter` (not `fieldMapping`) to keep the binding object
  stable across type switches; recorded as the deliberate exception to "fields live in fieldMapping".
- Option names are semantic (`donutHolePct`, `barGapPct`) rather than raw ECharts names, matching how
  `ChartAppearance` already abstracts (`legend.position` → orient/top/left).
