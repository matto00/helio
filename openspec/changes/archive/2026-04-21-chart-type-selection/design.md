## Context

Chart panels in `ChartPanel.tsx` call `buildDataOption` which hard-codes `type: "bar"` on every
ECharts series. The `ChartAppearance` type (both Scala model and TS interface) has no `chartType`
field, and `appearanceToEChartsOption` does not propagate one. The panel detail modal's Appearance
tab has no chart type selector. The `panel-appearance.schema.json` chart object uses
`additionalProperties: false`, blocking unrecognised keys at the API boundary.

The specs `chart-type-selector` and `echarts-chart-panel` already describe the target behavior in
full. No new requirements are being introduced.

## Goals / Non-Goals

**Goals:**
- Add `chartType` to the JSON schema, backend model, and TypeScript model
- Extend `appearanceToEChartsOption` and `buildDataOption` to use the selected chart type
- Render pie and scatter as special cases (no axes for pie; coordinate-pair data for scatter)
- Add a segmented-control/radio chart type selector to the Appearance tab; live preview responds
  immediately
- Persist `chartType` in the PATCH payload so it survives page reload

**Non-Goals:**
- Per-series chart type mixing
- New chart types beyond bar/line/pie/scatter
- Axis label special-casing for pie/scatter

## Decisions

**Default chart type is `"line"`** — the `chart-type-selector` spec §Requirement "Default chart
type is line when none is stored" is authoritative. The ticket description says `"bar"` but specs
take precedence over ticket prose. All fallbacks (`DEFAULT_CHART_APPEARANCE`, `defaultOption`, the
Scala `Option` default) MUST use `"line"`.

**`chartType` is optional in the schema, model, and TS type** — existing panels have no `chartType`
stored; making it required would break backward compatibility with the persistence layer. The backend
reads it as `Option[String]`; the frontend reads it as `string | undefined`.

**Pie chart: suppress axes, reshape data** — ECharts pie series requires `data: [{name, value}]`
and no `xAxis`/`yAxis`. In `ChartPanel.tsx` the merge strategy must conditionally omit axes when
`chartType === "pie"`. `buildDataOption` must branch on chart type, passed down via a new
`chartType` param extracted from `appearance.chart?.chartType`.

**Scatter chart: use coordinate pairs** — ECharts scatter series needs `data: [[x, y], ...]`. This
is handled inside `buildDataOption` as a third branch alongside single-series and multi-series bar.

**No new component** — the chart type selector is a `<fieldset>` with four `<input type="radio">`
elements added directly inside the existing chart section of `PanelDetailModal`, consistent with
the pattern used for legend position. No new file.

**Schema change is backward-compatible** — `chartType` is not added to `required`; existing
payloads without it continue to validate. `additionalProperties: false` is maintained.

**Backend JSON format** — `ChartAppearance` is extended with `chartType: Option[String]`. The
`jsonFormat4` call becomes `jsonFormat5`. No migration needed; the appearance blob is stored as
JSON and the new field is optional.

## Risks / Trade-offs

[Pie/scatter axis merge] `ChartPanel` merges `defaultOption.xAxis` and `appearanceOption.xAxis`
unconditionally. For pie charts this would inject unwanted axis config. → Mitigation: add a
`chartType` guard before the merge so axes are omitted when type is `"pie"`.

[Scatter data reshaping] Auto-numeric-column detection in `buildDataOption` is not meaningful for
scatter (requires two numeric fields). → Mitigation: scatter branch only activates when both
`xAxis` and `yAxis` are mapped; falls back to line/bar for auto-detect path.

[Spec default vs ticket default] Spec says `"line"`, ticket says `"bar"`. Using `"line"` breaks
no existing behavior (bar is currently hard-coded anyway) and aligns with the spec contract.

## Planner Notes

Self-approved. No new external dependencies, no breaking API changes, no new architecture patterns.
Pie and scatter rendering requires care around axis suppression but is contained to `ChartPanel.tsx`
and `chartAppearance.ts`.
