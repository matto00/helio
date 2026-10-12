## Standing Constraints

## 1. Frontend

- [x] 1.1 Add `histogramBinLabels` (design D2) and use it in `buildHistogramDataOption`; verify the unit tests from 3.1 pass
- [x] 1.2 (Reverted by 5.1, owner ruling: axis-label thinning stays as on main; split to HEL-1512)
- [x] 1.3 Change the heatmap hint copy in `OutputKindFields.tsx` (D3); verify 3.3 passes
- [x] 1.4 Correct the comments in `ChartPanel.tsx:7` and `chartOverlayOption.ts:71-72` (D4); verify by grep that neither enumerates only bar/line/pie/scatter
- [x] 1.5 Grep `frontend/src/features/panels/ui` for other closed chart-type lists in comments; list them in the report

## 2. E2E

- [x] 2.1 Wait for the dialog's own `ui-modal-in` animation (filtered, never subtree; not `settleTransitions.ts`) before both touch-target measurements and restore 43.5 (D5); verify the spec passes at 375 and 1440 in light and dark
- [x] 2.2 Record two red runs (D5): settle-wait red proven only with the entrance animation stretched to 3s (real timing measured 43.56-43.98 and stayed green, so the wait is not red under real timing); undersized real controls (40px) red at both the heatmap and bin-count sites; reverted, green recorded
- [x] 2.3 Add the ECharts 6.1.0 internals comment above the legend probe (D6); verify the version against `frontend/package-lock.json`
- [x] 2.4 (Dropped by 5.1: the show-all label e2e is out of scope and handed to HEL-1512)

## 3. Tests

- [x] 3.1 Unit tests (red first) for `histogramBinLabels`: the three spec scenarios (2.5 width -> 1 place, 2 width -> 0, 0-0.01/3 distinct, -0.1..0.5/6 no "-0", 0..0.000001/4 distinct, 1700000000..1700000002/8 -> 2 places distinct, 1234567890.12..1234567890.15/3 distinct, 0..1e-12/4 distinct) plus single bin 1700000000.5 -> "1700000000.5" and width from the full span
- [x] 3.2 (Dropped by 5.1: the axisLabel option tests went with the reverted `buildChartOption` change)
- [x] 3.3 Update `OutputEditorSheet.heatmapHistogram.test.tsx` to the new hint copy first (red), then green after 1.3
- [x] 3.4 Rendered verification: screenshots of a heatmap and a 12-bin histogram in light and dark at 1440 and 375, plus a time-axis line chart and a reference-line chart showing no regression; store under the run evidence dir
- [x] 3.5 Run the frontend gates (lint, typecheck, jest, format:check) and the hel1311, hel1305-related and hel1306 e2e specs with the local caps; record transcripts

## 4. Final-gate fix

- [x] 4.1 (Reverted by 5.1) A show-all `lineHeight` was added so `hideOverlap` worked without a CJK font; removed with the rest of the show-all change
- [x] 4.2 (Reverted by 5.1) A show-all x-axis `textMargin` was tried to keep packed bin labels apart. It re-thinned labels that fit; the 10-bin histogram losing its last label at 1440 was a threshold edge (gap threshold vs. free pitch), not a dark-theme effect. Removed with the rest of the show-all change

## 5. Owner ruling

- [x] 5.1 Revert all show-all axis-label changes (`interval`, `hideOverlap`, `textMargin`, `lineHeight`, their helpers, tests and the hel1487 e2e) so heatmap/histogram axis labels behave exactly as on main; `buildChartOption.ts` diff vs origin/main is empty and the frozen snapshot differs only by the histogram bin labels; the removed e2e is handed to HEL-1512; the "every label that fits" requirement is removed from the delta and canonical specs. Kept: bin-label precision, hint copy, comment fixes, hel1311 settle wait + 43.5, ECharts 6.1.0 legend-probe comment
