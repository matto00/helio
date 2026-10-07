## Context

- Metric picker (HEL-1275): `MetricKindFields` in `outputEditor/OutputKindFields.tsx` renders a `Select`
  (`ariaLabel="Compare"`, `METRIC_COMPARE_OPTIONS` + `compareOptions()` appending a stored `custom:` value);
  state `metricCompare` in `OutputEditorSheet.tsx`; `buildOutputConfig.ts` writes `compare: compareOrNull(...)` on the
  metric branch and metric aggregate-tail branch only. The chart branch omits `compare`, so PATCH's shallow merge keeps
  an API-set value; `OutputEditorSheet.compare.test.tsx` currently asserts that omission and the picker's absence.
- Overlay (HEL-1277): `selectChartOverlay` (`features/panels/history/chartOverlay.ts`) requires
  `fieldMapping.xAxis`/`yAxis`, a `rows`-mode, non-downsampled baseline series with matching x/y, no filter, complete
  rows. `applyChartOverlay` (`features/panels/ui/chartOverlayOption.ts`) additionally requires line/bar, not
  `bar.orientation: "horizontal"`, not `bar.stacking: "normalized"`, exactly one primary series.
- Server (`OutputSummaryReducer.series`): `aggregation` set (non-scatter) → `grouped` series (never overlays);
  else needs `fieldMapping.xAxis`/`yAxis` → `rows` series. A `fieldMapping.series` split → multi-series primary.
- Chart KIND on a dashboard comes from the panel's `appearance.chart.chartType` (`buildChartOption.ts` →
  `appearanceToEChartsOption`), not the Output's `config.chartType` — verified on main 9415a44ec.
- Aggregate-tail chart Outputs are created with `fieldMapping: {category, value}` (no xAxis/yAxis), so they never
  overlay today; the note must say so honestly rather than imply it would work.
- Dashboard freshness: `ChartOutputPanel` passes `configCompare(config)` as `useOutputHistory`'s `expectedCompare`,
  which refetches a cached history resolved for a different compare (the HEL-1275 r2 fix); reused unchanged.
- Server validates `config.compare` on every write (HEL-1273); reused, no new validation.

## Goals / Non-Goals

**Goals:** Compare picker on every chart Output; fixed help text; Output-level note; RTL + one e2e; both themes.
**Non-Goals:** HEL-1351 coverage, HEL-1285 semantics, metric picker changes, panel chart type, backend.

## Decisions

**D1 — Owner ruling `show-with-inline-note`: never hide.** The selector renders for `kind === "chart"` in create and
edit mode for every chart type and config. Rejected: hiding by Output config (strands an API-set value; Output
`chartType` does not decide the panel's kind).

**D2 — One shared `compare` state.** Rename `metricCompare` → `compare` (initialised from `config.compare ?? "none"`)
and use it for both metric and chart branches, so switching kind in the editor neither drops nor duplicates a value.
`BuildOutputConfigParams.metricCompare` is renamed `compare`; callers and tests updated in the same change.

**D3 — Chart options exclude "Previous".** `CHART_COMPARE_OPTIONS` = None, 1 day, 7 days, 30 days (values `none`,
`1d`, `7d`, `30d`). `compareOptions(value, base)` is generalised: a stored value not in `base` (`previous_run` or
`custom:...`) is appended as its own option — `previous_run` reuses the existing metric "Previous" label verbatim
(display of a stored value, not new copy), `custom:` keeps `Custom (<dur>)`. Rationale: the driver forbids adding
"previous run" copy while HEL-1285 is open. Metric options are unchanged.

**D4 — Chart branch writes `compare`.** `buildOutputConfig` chart branch adds `compare: compareOrNull(params.compare)`
(explicit `null` for None, like metric). Because the editor initialises from the stored value, an untouched stored
value round-trips unchanged — preserving the existing "editor doesn't drop compare" requirement. The chart aggregate
tail's `outputConfig` also carries `compare` (spec parity with the metric tail). The existing test asserting chart
save omits `compare` is replaced by tests of the new behaviour (intended spec change, not a fixture patch).

**D5 — Pure predicate, co-located with the overlay rules.** Add
`chartCompareBlocker(config: Record<string, unknown>): ChartCompareBlocker | null` to
`features/panels/history/chartOverlay.ts`, returning the first of (a conservative superset of the runtime rules, per skeptic-design-1 note 3) `"aggregated" | "series" | "unmapped" |
"horizontal" | "normalized"` in that order, from exactly: `config.aggregation` non-null object; `fieldMapping.series`
non-empty string; `fieldMapping.xAxis` or `yAxis` not a non-empty string; `chartOptions.bar.orientation ===
"horizontal"`; `chartOptions.bar.stacking === "normalized"`. Never reads `config.chartType`. The editor calls it on
the config it would save (`buildConfig()` result for the chart branch) so the note tracks unsaved edits. Bar-option
blockers apply whatever the Output chartType is, because the panel may render bar; the note text says "on bar panels".
`selectChartOverlay`/`applyChartOverlay` behaviour is NOT changed (D5 only adds an export; no refactor of them).

**D6 — Copy (no "previous"; DESIGN.md hint styles).** Help text, `output-editor-sheet__field-hint`, linked by
`aria-describedby` to the select: "Adds a “vs” line or bars to dashboard charts. It doesn't show for pie or scatter
panels, multi-series charts, horizontal or 100% stacked bars, aggregated Outputs, Outputs with more than 200 rows, or
while a filter is applied." Note (only when compare ≠ None and a blocker exists), `output-editor-sheet__type-hint`,
also in `aria-describedby`, not `role="alert"`:
aggregated → "This Output aggregates its rows, so dashboards won't show the comparison."; series → "This Output splits
into several series, so dashboards won't show the comparison."; unmapped → "This Output has no x and y fields mapped,
so dashboards won't show the comparison."; horizontal → "Horizontal bars don't show the comparison on bar panels.";
normalized → "100% stacked bars don't show the comparison on bar panels." Executor may tighten wording but must keep
every listed case, no "previous", and existing tokens/classes only (no new colours).

**D7 — Placement.** The chart Compare section sits after `ChartDisplayFields` inside `ChartKindFields`, structured
like the metric section (`output-editor-sheet__data-section` + `__data-label` "Compare"). A small shared
`CompareField` component (select + optional help + optional note) may be extracted and used by both kinds, provided
the metric picker's rendered DOM and options stay identical (existing metric tests must pass unmodified).

**D8 — Tests.** RTL (`OutputEditorSheet.compare.test.tsx` + a `chartOverlay` unit test): chart picker present for
line/bar/pie/scatter; 7d saves `"7d"`; None saves `null`; stored `previous_run` and `custom:P3D` shown and kept;
no "Previous" option for a chart without a stored `previous_run`; each blocker shows its note and none shows for a
clean raw-rows config or for `chartType: "pie"` alone; note hidden when None; help text linked via
`aria-describedby`; chart tail carries `compare`. Each new assertion must be shown red against the pre-change code
(or a targeted mutation) before green. E2E `e2e/hel1350-chart-compare-picker.spec.ts`, both themes: UI login via
`loginThenIsolate`; create source/pipeline/raw-rows line chart Output (xAxis/yAxis) via API; two real runs;
`backdateHistory` the older point ≥7 days; place on a dashboard; open the Output editor, choose "7 days", save
(assert the PATCH body carries `compare: "7d"`); navigate client-side to the dashboard (assert no full reload) and
assert the chart legend contains "vs 7d"; screenshot editor + panel per theme into the spec's shot dir in the
worktree. Record created user/row ids in the test log. Local runs: `nice -n 19`, ≤2 workers.

## Risks / Trade-offs

- Renaming `metricCompare` touches existing tests; mitigated by keeping metric DOM/options identical.
- Help text lists conditions the editor cannot check (panel kind, filter, row count); this is the owner's ruling.
- The 200-row figure mirrors `usePanelSortFilter`'s `pageSize: 200`; if it changes, copy drifts (accepted, noted).

## Planner Notes

- Self-approved: D2 shared state, D3 excluding "Previous" for charts, D5 predicate location, "unmapped" blocker
  (an Output-level fact the owner's list didn't name, needed so aggregate-tail charts aren't silently misleading).
- Premise evidence: `.concertino/runs/HEL-1350/evidence/premise-validation.md` (main checkout).

- Design-gate skeptic round 1 CONFIRM (skeptic-design-1.md) — executor guidance from its notes:
  - E2E overlay check: the legend is canvas — assert "vs 7d" via the axis-trigger tooltip on hover (hel1277 spec
    :309-321), keep the h:5 auto-layout (non-compact). Never a DOM getByText on the legend.
  - E2E order: run 1 → `backdateHistory(..., expectedRows 1)` → run 2 (hel1275 :166-182 precedent).
  - Scatter edge: when the editor's chartType is scatter, `aggregated` must not contradict the "Aggregation isn't
    available for scatter" hint — suppress the `aggregated` note for scatter (server never groups scatter); bar
    blockers still never read chartType.
  - `unmapped` copy must not imply an editor control exists (no x/y mapping UI in the editor); e.g. "This Output
    doesn't name x and y fields, so dashboards won't show the comparison."
  - Keep `OutputEditorSheet.tsx` (682 lines) additions minimal; put picker/notes in `OutputKindFields.tsx` or a
    `CompareField`.
