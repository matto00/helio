## Context

See proposal.md (Why). The single assembly point for every dashboard chart's ECharts option is
`buildChartOption()` (`frontend/src/features/panels/ui/buildChartOption.ts`), reached via `useChartOption` from
`ChartPanel` — which is mounted by the grid card, fullscreen overlay, mobile stack and the output-editor preview.
Lines 80-83 call `appearanceToEChartsOption(appearance.chart, themeTokens)` only when `appearance?.chart != null`
and otherwise use `{ option: {}, chartType: "line" }`.

Create paths that store a chart-less appearance (all verified in code at 69237b54):
- Add-panel dialog: no frontend create path references `defaultChartAppearance`; backend
  `PanelServiceHelpers.normalizeAppearancePayload` passes `chart` through verbatim (absent -> None) and
  `resolveCreateAppearance` falls back to `PanelAppearance.Default` (model.scala:397, no chart).
- First-run (`POST /api/first-run/dashboard`), persona templates (`POST /api/first-run/template`): build panels
  through the same `PanelAppearance.Default`; no backend site ever constructs `Some(ChartAppearance...)` except
  the PATCH merge (model.scala:467).
- Apply-proposal / MCP: the `echarts-chart-panel` spec explicitly requires `appearance.chart` to stay unset when
  a proposal carries no chart fields.
- Import (`DashboardSnapshotRepository` ~line 168) and duplicate copy `chart` as-is, so a chart-less source
  yields a chart-less copy.
- Appearance PATCH with `chart: null` clears it to None (`PanelAppearance.applyPatch`).
Chart types: an absent `chart` always resolves to `line` (`resolveChartType`), so bar/pie/scatter panels always
store a `chart` (chartType lives inside it) and are unaffected by this branch; the live check must still cover
all four types to prove "no behaviour change" for stored appearances.

What a chart-less panel lacks today (produced only by `appearanceToEChartsOption`): the themed tooltip (and on
a single-series chart, any tooltip at all — `defaultOption` has no `tooltip` key), themed axis line/tick/
splitLine colour (F-024), `fontFamily` sans on canvas text and mono on axis labels (F-196), the y-axis number
formatter, legend positioning props, and the explicit series palette. Hover emphasis (`applyHoverEmphasis`) and
the axis-trigger pass already run unconditionally — the ticket's "no hover emphasis" claim is stale.

## Goals / Non-Goals

**Goals:** chart-less panel option === explicitly-defaulted panel option, in both themes; zero change for panels
that store `chart`.
**Non-Goals:** any backend, schema or migration change (V115 not taken); PanelGrid/layout/PanelCard edits;
HEL-1181/HEL-1182.

## Decisions

### D1 — Render-time default in `buildChartOption`, not a write-time default
Replace the null branch with `appearanceToEChartsOption(appearance?.chart ?? defaultChartAppearance, themeTokens)`
(`defaultChartAppearance` from `frontend/src/theme/appearance.ts`, the object `PanelDetailModal` already composes
its edit-pane base from, so "edited with defaults" and "absent" converge on the same input by construction).
Alternatives rejected:
- Write-time default (backend `resolveCreateAppearance` / first-run / templates / proposal): fixes only new rows,
  needs a backfill migration for existing ones, contradicts the `echarts-chart-panel` apply-proposal scenario
  ("`appearance.chart` is unset"), and misses `chart: null` PATCHes. It would also touch ≥5 backend sites.
- Fallback inside `appearanceToEChartsOption` (accepting `undefined`): it is also used by `UsageChart`, which
  always passes a chart; widening its signature is gratuitous. One-line fix at the one caller is smaller.
Rendering never writes: no dispatch, no PATCH — the stored row stays chart-less.

### D2 — The fallback is whole-object, not per-field
`appearance.chart` is either absent or a full `ChartAppearance` (the backend case class has no optional
sub-fields, and the PATCH merge fills from `ChartAppearance.Default`). So `?? defaultChartAppearance` is
sufficient; no per-field merge is introduced. The appearance-PATCH-is-replace gotcha (MISTAKES.md) does not bite
here because nothing is written; it is noted for the evaluator in case anyone proposes a write-time variant.

### D3 — Frontend/backend default parity is asserted, not assumed
`ChartAppearance.Default` (backend) and `defaultChartAppearance` (frontend) must stay equal for "absent" and
"edited with defaults" to look identical. The executor checks them field by field (seriesColors, legend
show/position, tooltip enabled, axis label show/label, chartType) and records the comparison in the evaluation
evidence; if they differ, stop and report rather than editing the backend.

### D4 — Tests
Red-first: a `ChartPanel` (and/or `buildChartOption`) test with `appearance` lacking `chart` asserting
`option.tooltip` carries the themed backgroundColor/extraCssText/mono font — must fail on unmodified main. Plus an
equality test: option built with `chart` absent deep-equals the option built with `chart: defaultChartAppearance`
(same theme tokens), for light and dark tokens. Plus a guard that `tooltip.enabled: false` still yields
`tooltip.show === false`. Existing tests that render `<ChartPanel />` with no appearance
(`ChartPanel.test.tsx` lines 24-86, `ChartPanel.click.test.tsx`, `ChartPanel.compact.test.tsx`) assert data
fields only (`xAxis.data`, `series[0].data`); they are expected to stay green — any that break must be read as a
symptom, not edited to pass (MISTAKES/fixture-change rule).

## Risks / Trade-offs

- [Chart-less multi-series bar/line legends now get explicit top-centre placement] → that is the default
  appearance's placement and what the editor shows; matches an edited-with-defaults panel by design.
- [`option.color` becomes explicit] → the 8-colour default equals ECharts' own palette's first 8 (ECharts adds a 9th,
  `#ea7ccc`), so colours do not shift below 9 series; identical to an edited-with-defaults panel either way.
- [Panel `appearance.color` text override interacts with the newly-present base textStyle] → identical code path
  to panels storing `chart` today; covered by the equality test.
- HEL-1181 (pie needle slices): no interaction — a chart-less panel is always a line chart. HEL-1182 (metric
  fieldMapping order): no interaction — data option assembly is untouched.

## Migration Plan

None. Frontend-only; rollback is a revert.

## Planner Notes

- Self-approved: render-time over write-time (D1) — consistent with the driver's stated preference and the
  existing apply-proposal spec. No escalation needed: no new dependency, no API change.
- Live verification (evaluator/skeptic): in the worktree's own dev server, create a chart panel via Add-panel,
  confirm via the API that `appearance.chart` is absent, then compare its tooltip/axes against a sibling panel
  PATCHed with `chart: defaultChartAppearance`, in light and dark, before (main) and after; also each of bar/
  line/pie/scatter with a stored chart for no-change. Delete created dashboards by exact id afterwards.
