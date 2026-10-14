# Audit: every `setViewportSize` site in `e2e/` (HEL-1418 task 1.1)

Source of truth: `grep -rn setViewportSize e2e` on this tree = **78** lines in 31 files (two are comment lines, hel1023:368
and hel1275:56, the other 76 are calls). The table has exactly one row per grep line.

Rule (design D2): migrate iff the spec resizes AFTER the page loaded AND then reads desktop-grid geometry/width (or
relies on RGL having re-laid-out). Pre-load, phone-stack-only, and non-grid measurements are left with a reason.

Result: **3 sites migrate** — hel1023 `openAt`, hel1392-request-burst `crossTo`, hel1275 `resizeAndSettle` (the
latter was missing from the design's list; skeptic-design-2 note 1). hel1392-remount-staleness `setViewport` and
hel588's breakpoint sweep were examined and left (reasons below).

| Site | Class | Reason |
| --- | --- | --- |
| `e2e/hel588-cross-filter-panels.spec.ts:344` | leave | live resize sweep, but asserts only the filter indicator's box (outside the grid) at each width; never reads RGL item geometry |
| `e2e/hel588-cross-filter-panels.spec.ts:356` | leave | restore to 1440 before a theme toggle; no grid geometry read |
| `e2e/hel1275-metric-delta-sparkline.spec.ts:56` | n/a | comment line (grep hit, not a call) |
| `e2e/hel1275-metric-delta-sparkline.spec.ts:63` | MIGRATE | live resize 1440/1100/1440 after load (`resizeAndSettle`), then asserts sparkline-vs-card geometry; old gate is the CSS box of the card changing (an item box, not the processed width) |
| `e2e/hel1275-metric-delta-sparkline.spec.ts:88` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel813-mobile-touch-target-floor.spec.ts:88` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved; viewport set per width before/with the page's goto |
| `e2e/hel813-mobile-touch-target-floor.spec.ts:134` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved; viewport set per width before/with the page's goto |
| `e2e/hel813-mobile-touch-target-floor.spec.ts:163` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved; viewport set per width before/with the page's goto |
| `e2e/hel813-mobile-touch-target-floor.spec.ts:179` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved; viewport set per width before/with the page's goto |
| `e2e/hel813-mobile-touch-target-floor.spec.ts:234` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved; viewport set per width before/with the page's goto |
| `e2e/hel813-mobile-touch-target-floor.spec.ts:269` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved; viewport set per width before/with the page's goto |
| `e2e/hel813-mobile-touch-target-floor.spec.ts:299` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved; viewport set per width before/with the page's goto |
| `e2e/hel1230-drag-then-create-persists.spec.ts:70` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1305-chart-time-axis.spec.ts:140` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) (desktop size or width param at test start, before the app loads) |
| `e2e/hel1305-chart-time-axis.spec.ts:297` | leave | phone-only live resize (mobile stack replaces the grid; no RGL geometry read) (375px after opening the dashboard from `/`; waits for `.mobile-panel-stack`) |
| `e2e/hel1305-chart-time-axis.spec.ts:422` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) (desktop size or width param at test start, before the app loads) |
| `e2e/hel1305-chart-time-axis.spec.ts:518` | leave | phone-only live resize (mobile stack replaces the grid; no RGL geometry read) (375px after opening the dashboard from `/`; waits for `.mobile-panel-stack`) |
| `e2e/hel1277-output-history-scrubber.spec.ts:61` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1277-output-history-scrubber.spec.ts:173` | leave | live resize inside the Output history dialog; measures the scrubber range (dialog CSS), not RGL geometry |
| `e2e/hel1277-output-history-scrubber.spec.ts:176` | leave | restore to 1440 inside the dialog; no grid geometry read |
| `e2e/hel1277-output-history-scrubber.spec.ts:201` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1307-conditional-formatting.spec.ts:237` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1307-conditional-formatting.spec.ts:344` | leave | phone-only live resize (mobile stack replaces the grid; no RGL geometry read) (375px; screenshots the stack) |
| `e2e/hel912-lanes-rejoin.spec.ts:161` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved (pipeline lanes) |
| `e2e/hel912-lanes-rejoin.spec.ts:167` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved |
| `e2e/hel912-lanes-rejoin.spec.ts:173` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved |
| `e2e/hel912-lanes-rejoin.spec.ts:179` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved |
| `e2e/hel909-output-picker-panel-sheet.spec.ts:166` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel968-multi-root-editor-flow.spec.ts:180` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1304-output-charttype-render.spec.ts:94` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1306-chart-reference-lines.spec.ts:146` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) (desktop size or width param at test start, before the app loads) |
| `e2e/hel1306-chart-reference-lines.spec.ts:261` | leave | phone-only live resize (mobile stack replaces the grid; no RGL geometry read) (375px after opening the dashboard from `/`; waits for `.mobile-panel-stack`) |
| `e2e/hel1306-chart-reference-lines.spec.ts:409` | leave | phone-only live resize (mobile stack replaces the grid; no RGL geometry read) (375px after opening the dashboard from `/`; waits for `.mobile-panel-stack`) |
| `e2e/hel1512-category-axis-labels.spec.ts:141` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) (desktop size or width param at test start, before the app loads) |
| `e2e/hel1512-category-axis-labels.spec.ts:280` | leave | phone-only live resize (mobile stack replaces the grid; no RGL geometry read) (375px after opening the dashboard from `/`; waits for `.mobile-panel-stack`) |
| `e2e/hel1444-footnoted-chart-canvas.spec.ts:366` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) (`openDashboard` helper) |
| `e2e/hel1444-footnoted-chart-canvas.spec.ts:586` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1444-footnoted-chart-canvas.spec.ts:645` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1444-footnoted-chart-canvas.spec.ts:688` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1510-output-editor-table-overflow.spec.ts:40` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved; pre-load |
| `e2e/hel1351-aggregated-chart-overlay.spec.ts:90` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1351-aggregated-chart-overlay.spec.ts:276` | leave | phone-only live resize (mobile stack replaces the grid; no RGL geometry read) (waits for `.react-grid-item` count 0 and the stack canvases) |
| `e2e/hel1390-chart-tail-aggregate-live.spec.ts:25` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1350-chart-compare-picker.spec.ts:39` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1023-breakpoint-layout-derivation.spec.ts:368` | n/a | comment line (grep hit, not a call) |
| `e2e/hel1023-breakpoint-layout-derivation.spec.ts:371` | MIGRATE | live resize after load, then reads RGL item geometry (`openAt`; gate moves into the shared helper via `settledRects`) |
| `e2e/hel813-mobile-touch-target-floor.regression.spec.ts:180` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved; viewport set per width before/with the page's goto |
| `e2e/hel813-mobile-touch-target-floor.regression.spec.ts:250` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved; viewport set per width before/with the page's goto |
| `e2e/hel773-top-anchored-mobile-nav-sheet.spec.ts:40` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved (mobile nav sheet) |
| `e2e/hel773-top-anchored-mobile-nav-sheet.spec.ts:118` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved (mobile nav sheet) |
| `e2e/hel773-top-anchored-mobile-nav-sheet.spec.ts:451` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved (mobile nav sheet) |
| `e2e/hel1260-orphan-owner-repair.spec.ts:29` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1260-orphan-owner-repair.spec.ts:113` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1392-remount-staleness.spec.ts:63` | leave | live crossing (`setViewport`), but every assertion is a request count / series type / cell text, gated on `.react-grid-item` count; no geometry or width is read |
| `e2e/hel1392-remount-staleness.spec.ts:150` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1398-chart-narrow-footnotes.spec.ts:252` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1398-chart-narrow-footnotes.spec.ts:300` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1398-chart-narrow-footnotes.spec.ts:394` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1398-chart-narrow-footnotes.spec.ts:411` | leave | phone-only live resize (mobile stack replaces the grid; no RGL geometry read) (desktop -> 1000px-container phone stack; waits for `.mobile-panel-stack`) |
| `e2e/hel1398-chart-narrow-footnotes.spec.ts:427` | leave | phone-only live resize (mobile stack replaces the grid; no RGL geometry read) (320px) |
| `e2e/hel1398-chart-narrow-footnotes.spec.ts:474` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1457-stale-tab-layout-save.spec.ts:24` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1457-stale-tab-layout-save.spec.ts:96` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1311-heatmap-histogram-charts.spec.ts:139` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) (desktop size or width param at test start, before the app loads) |
| `e2e/hel1311-heatmap-histogram-charts.spec.ts:244` | leave | phone-only live resize (mobile stack replaces the grid; no RGL geometry read) (375px after opening the dashboard from `/`; waits for `.mobile-panel-stack`) |
| `e2e/hel1311-heatmap-histogram-charts.spec.ts:438` | leave | phone-only live resize (mobile stack replaces the grid; no RGL geometry read) (375px after opening the dashboard from `/`; waits for `.mobile-panel-stack`) |
| `e2e/hel1065-pin-toggle-css-fixes.spec.ts:221` | leave | live resize to 400px but measures the DataGrid pin button (media-query CSS), not RGL geometry |
| `e2e/hel1065-pin-toggle-css-fixes.spec.ts:279` | leave | live resize to 1280 but measures the DataGrid header row, not RGL geometry |
| `e2e/hel1392-remount-request-burst.spec.ts:63` | MIGRATE | live desktop<->phone crossing; old gate `/^\d+px$/` accepts any (stale) processed width (`crossTo`) |
| `e2e/hel1392-remount-request-burst.spec.ts:86` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1508-chart-time-axis-followups.spec.ts:122` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) (desktop size or width param at test start, before the app loads) |
| `e2e/hel1508-chart-time-axis-followups.spec.ts:235` | leave | phone-only live resize (mobile stack replaces the grid; no RGL geometry read) (375px after opening the dashboard from `/`; waits for `.mobile-panel-stack`) |
| `e2e/hel1028-layout-undo-redo-visual-revert.spec.ts:160` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1028-layout-undo-redo-visual-revert.spec.ts:220` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1028-layout-undo-redo-visual-revert.spec.ts:253` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1028-layout-undo-redo-visual-revert.spec.ts:283` | leave | pre-load (viewport set before the first `goto`/app load of the page under test; no live resize) |
| `e2e/hel1331-history-payloads-toggle.spec.ts:78` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved; pre-load |
| `e2e/hel1331-history-payloads-toggle.spec.ts:140` | leave | non-grid page (pipeline editor / settings / sources / nav sheet / data grid), no `.panel-grid` involved; pre-load |
