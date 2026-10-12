## Standing Constraints

- [C1] Red first: the new e2e spec and unit tests are shown failing on main (2e02b7951) before the fix, transcripts in run evidence.
- [C2] No new `eslint-disable`; no `--no-verify`/`HUSKY=0`; colours stay hex-resolvable tokens (ECharts cannot parse `color-mix()`).
- [C3] Evaluator and final skeptic run e2e hel1311, hel1305, hel1306 and hel1512 specs themselves, light+dark, 1440+375.
- [C4] Every e2e/probe uses its own throwaway @example.test user, verified via /api/auth/me; never matt@helio.dev.
- [C5] The margin factor is one global font-relative value; a per-chart tweak or factor that loses 7/7@375 or 10/10@1440 is escalated, not shipped.

### Frontend

- [x] 1.1 Add `categoryLabelLineHeight`, `categoryLabelShowAll`, `categoryXLabelMargin(fontSize)` (0.6 x font), `categoryXLabelShowAll`, `showsEveryCategoryLabel` to `heatmapHistogramOptions.ts`; verify unit tests in 3.1
- [x] 1.2 Wire them into `buildChartOption.ts` normal path (heatmap x/y, histogram x) via `fontSizeOf`; verify unit tests in 3.1
- [x] 1.3 Compact path recomputes lineHeight and x textMargin for `COMPACT_AXIS_LABEL_FONT_SIZE`; verify unit test in 3.1
- [x] 1.4 Confirm time-axis (`hideOverlap` only) and non-heatmap/histogram axes are unchanged; verify `buildChartOption.timeAxis*.test.ts` and the unchanged-path snapshot

### Tests

- [x] 3.1 Unit tests (normal + compact, heatmap x/y, histogram x, line chart untouched) red on main by assertion failure (not import error), green after
- [x] 3.2 Update only heatmap/histogram entries of `chartUnchangedPath.main.snapshot.json`; record the diff in evidence
- [x] 3.0 Confirm `e2e/support/auth.ts` `currentUserId` calls /api/auth/me (C4)
- [x] 3.3 Land `e2e/hel1512-category-axis-labels.spec.ts` from the handoff with Decision 5's assertions (incl. new heat8X read, 7/7 at 375+1440, font-based floors, 0.05 px epsilon max); red on main, green after
- [x] 3.4 Record hist20@1440 and hist20@375 shown count + min gap at the shipped margin in evidence (Decision 6)
- [x] 3.5 Run e2e hel1512 x5 plus hel1311, hel1305, hel1306 green; light+dark, 1440+375; transcripts in run evidence
