# HEL-1178: Chart panels with no stored appearance.chart skip all chart theming (tooltips, axes, hover emphasis) until appearance is edited

## Description

origin_kind: followup
origin_ticket: HEL-566

`ChartPanel.tsx` (~line 326 at filing time; now `frontend/src/features/panels/ui/buildChartOption.ts:80-83`)
builds the appearance half of the ECharts option only when `appearance?.chart != null`; otherwise it uses `{}`.
The backend stores `PanelAppearance.chart: Option[ChartAppearance] = None` by default
(`backend/.../domain/model/model.scala:218`), and the HEL-566 lane observed that a panel created through the
"Add panel" dialog has no `appearance.chart`. So a freshly created chart panel gets none of
`appearanceToEChartsOption`'s output: no themed tooltip (F-025, plus HEL-566's shadow/radius/mono values/axis
trigger), no themed gridlines or axis fonts (F-024/F-196) until the user edits its appearance. The HEL-566 lane
had to PATCH `appearance.chart` onto its test panel to verify its own work.

Found by the HEL-566 lane (PR #699). Premise validation (2026-10-04): null branch and backend default
CONFIRMED; location moved to buildChartOption.ts; the "no hover emphasis" part is stale — `applyHoverEmphasis`
already runs unconditionally.

Likely shape (implementer decides): fall back to `defaultChartAppearance` (`frontend/src/theme/appearance.ts`)
when `appearance.chart` is absent, matching what `PanelDetailModal` already does for editing. Alternatively,
populate the default at creation. The frontend fallback also covers existing rows and agent/MCP-created panels.

Driver scope notes: enumerate every chart type and create path producing a chart-less panel (UI create,
first-run, persona templates, apply-proposal/MCP, import, duplicate). Prefer a render-time default unless there
is a reason otherwise. Note the appearance-PATCH-is-replace gotcha. Out of scope (v0.9): HEL-1181 (pie needle
slices), HEL-1182 (metric fieldMapping order) — note any interaction, do not fix.

## Acceptance Criteria

- A chart panel with no stored `appearance.chart` renders the same themed tooltip, axes and hover emphasis as
  one with the default appearance set explicitly (in light and dark).
- A red-first test: a ChartPanel rendered with `appearance.chart` absent asserts the themed tooltip option is
  present.
- No behaviour change for panels that do have `appearance.chart`, including `tooltip.enabled: false` still
  hiding the tooltip.
