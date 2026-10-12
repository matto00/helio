## Standing Constraints

## 1. Frontend

- [x] 1.1 Add `histogramBinLabels` (design D2) and use it in `buildHistogramDataOption`; verify the unit tests from 3.1 pass
- [x] 1.2 In `buildChartOption`, add `interval: 0, hideOverlap: true` to heatmap x/y and histogram x `axisLabel` at the merge point (D1); verify 3.2 passes and existing HEL-1305/1306 tests stay green
- [x] 1.3 Change the heatmap hint copy in `OutputKindFields.tsx` (D3); verify 3.3 passes
- [x] 1.4 Correct the comments in `ChartPanel.tsx:7` and `chartOverlayOption.ts:71-72` (D4); verify by grep that neither enumerates only bar/line/pie/scatter
- [x] 1.5 Grep `frontend/src/features/panels/ui` for other closed chart-type lists in comments; list them in the report

## 2. E2E

- [x] 2.1 Wait for the dialog's own `ui-modal-in` animation (filtered, never subtree; not `settleTransitions.ts`) before both touch-target measurements and restore 43.5 (D5); verify the spec passes at 375 and 1440 in light and dark
- [x] 2.2 Record two red runs (D5): settle-wait red proven only with the entrance animation stretched to 3s (real timing measured 43.56-43.98 and stayed green, so the wait is not red under real timing); undersized real controls (40px) red at both the heatmap and bin-count sites; reverted, green recorded
- [x] 2.3 Add the ECharts 6.1.0 internals comment above the legend probe (D6); verify the version against `frontend/package-lock.json`
- [x] 2.4 Add an e2e assertion at 1440 that every heatmap column/row label and every histogram bin label is rendered, and at 375 that rendered bin labels do not overlap; rendered red before the fix only via the 10-bin histogram at 1440 (5 of 10 shown); the heatmap, 5-bin and 375 no-overlap checks were green before the fix; the overlap detector was mutation-checked by the evaluator (interval 0 without hideOverlap gave 38 overlapping pairs)

## 3. Tests

- [x] 3.1 Unit tests (red first) for `histogramBinLabels`: the three spec scenarios (2.5 width -> 1 place, 2 width -> 0, 0-0.01/3 distinct, -0.1..0.5/6 no "-0", 0..0.000001/4 distinct, 1700000000..1700000002/8 -> 2 places distinct, 1234567890.12..1234567890.15/3 distinct, 0..1e-12/4 distinct) plus single bin 1700000000.5 -> "1700000000.5" and width from the full span
- [x] 3.2 Unit test (red first) that `buildChartOption` for heatmap (x and y) and histogram (x) carries `interval: 0` and `hideOverlap: true`, in normal and compact mode, that the histogram y (value) axis gets neither, and that line/bar axisLabels are unchanged
- [x] 3.3 Update `OutputEditorSheet.heatmapHistogram.test.tsx` to the new hint copy first (red), then green after 1.3
- [x] 3.4 Rendered verification: screenshots of a heatmap and a 12-bin histogram in light and dark at 1440 and 375, plus a time-axis line chart and a reference-line chart showing no regression; store under the run evidence dir
- [x] 3.5 Run the frontend gates (lint, typecheck, jest, format:check) and the hel1311, hel1305-related and hel1306 e2e specs with the local caps; record transcripts

## 4. Final-gate fix

- [x] 4.1 Heatmap row labels stacked at 375 on a machine with no CJK font (ECharts sizes label collision boxes from the glyph 国, ~0.6em without one, so `hideOverlap` hid nothing): the show-all axis labels now carry an explicit font-size-based `lineHeight` (`categoryLabelLineHeight`: 15 at the 12px default, 12 at compact 10px) in normal and compact mode. Proof: unit tests for both modes; e2e heatmap with 6 rows at 375 (h: 3) using real canvas text metrics is red on 17bb3e99d (6 of 6 rows shown, overlapping) and green after (3 of 6, no overlap); hel1311, hel1487, hel1305, hel1306 e2e all green (27 passed)
