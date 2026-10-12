# HEL-1487: After HEL-1311: heatmap/histogram axis-label thinning and bin-label precision; wrong heatmap editor hint; stale chart-type comments; e2e touch-target timing

## Description

These follow-ups came from HEL-1311 (matto00/helio#935, b3a7efc96), which added the heatmap and histogram chart types.

1. Heatmap and histogram axes hide every other label (ECharts' automatic interval), and histogram bin labels use mixed decimal precision. Show every category label when they fit, and give bin labels one consistent precision. Verify in both themes at 1440 and 375.
2. The heatmap editor hint says it "plots the rows as they are", but duplicate (x, y) cells are summed. Fix the copy.
3. Stale comments at `ChartPanel.tsx:7` and `chartOverlayOption.ts:24` list only bar/line/pie/scatter.
4. The e2e touch-target check was loosened from 43.5 to 43px because it samples during the sheet's open animation; the control really is 44px. Measure after the animation settles and restore the 43.5 threshold.
5. The e2e legend probe reads ECharts internals. Add a comment naming the ECharts version it depends on.

Re-derive line numbers from main.

## Acceptance Criteria

- AC1: Histogram bin labels use one consistent precision (within one chart, all labels use the same number of decimal places); axis-label thinning is unchanged from main (show-every-label split to HEL-1512 by owner ruling).
- AC2: The heatmap Output-editor aggregation hint states that rows sharing a column and row are summed (no "plots the rows as they are").
- AC3: The stale chart-type comments (`frontend/src/features/panels/ui/ChartPanel.tsx:7`; the chartOverlayOption.ts one, now the `applyChartOverlay` doc comment at `frontend/src/features/panels/ui/chartOverlayOption.ts:71-72` after HEL-1305) are accurate for the current chart-type set.
- AC4: `e2e/hel1311-heatmap-histogram-charts.spec.ts` measures the heatmap/histogram editor controls only after the sheet's open animation has settled, and asserts the 43.5px threshold (both sites, currently :495 and :504); the check is shown to fail under a genuinely undersized control.
- AC5: The e2e legend probe carries a comment naming the ECharts version (6.1.0 per `frontend/package-lock.json`) whose internals it reads.

## Driver context (owner-approved queue, priority Low)

- Re-derive every line reference from main (HEL-1306 #939 and HEL-1305 #959 moved chart code).
- ECharts cannot parse `color-mix()`; any colour change uses hex-resolvable tokens.
- Tests red first where behaviour changes; no new `eslint-disable`.
- Concurrent lane HEL-1464 edits the same e2e spec (Bin count accessible name) and `OutputEditorSheet.heatmapHistogram.test.tsx`; re-sync with origin/main before the PR.
