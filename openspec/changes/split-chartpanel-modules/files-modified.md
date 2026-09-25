# Files Modified — HEL-1180

Pure structural refactor: `ChartPanel.tsx` (590 lines) and `ChartPanel.test.tsx`
(1110 lines) split into single-concern modules/hooks and matching test files,
per design.md D1-D6. No behavior change.

## Source (new)

- `frontend/src/features/panels/ui/chartDataOptions.ts` — new pure module:
  `buildDataOption`/`buildDataOptionCore`/`buildAggregateDataOption`/
  `withPointerCursor`, moved verbatim from `ChartPanel.tsx` (design.md D1).
- `frontend/src/features/panels/ui/buildChartOption.ts` — new pure module: the
  appearance+data+compact option-assembly logic (the former inline `useMemo`
  body), `defaultOption`, `COMPACT_AXIS_LABEL_FONT_SIZE`,
  `COMPACT_GRID_INSET_PX`. Takes `themeTokens` as a plain parameter instead of
  `theme`/`accentColor`/`themeSyncTick` (design.md D2 — those three would be
  unused trailing parameters on a plain function and fail
  `@typescript-eslint/no-unused-vars` under the zero-warnings lint policy).
- `frontend/src/features/panels/ui/useChartOption.ts` — new hook: owns
  `useTheme()`, the `themeSyncTick` `useState`+rAF `useEffect` (HEL-566
  theme-sync, dependency array `[theme, accentColor]` copied verbatim), and
  the `useMemo` wrapping `buildChartOption(...)` (dependency array copied
  verbatim, still 11 entries: `appearance, rawRows, headers, fieldMapping,
  chartAggregate, chartOptions, effectiveCompact, measuredPieLegendOverlap,
  theme, accentColor, themeSyncTick`) — design.md D3, a direct mechanical
  move preserving hook order and every dependency array exactly.
- `frontend/src/features/panels/ui/useChartClickHandler.ts` — new hook: owns
  `EChartsClickEventParams`, the HEL-572 `handleChartClick` `useCallback`
  (dependency array copied verbatim), and the `chartOnEvents` `useMemo` —
  design.md D4, same mechanical-move rationale as D3.
- `frontend/src/features/panels/ui/chartPanelTestHelpers.tsx` — new shared
  test helper module: `renderChart`, `getOption`, `baseAppearance`,
  `baseChartConfig` (all four of the original file's module-level symbols
  declared outside any `describe` block — design.md D6, skeptic-confirmed to
  be used from all five destination test files). Every consuming test file
  keeps its own `jest.mock("echarts-for-react/esm/core", ...)` /
  `jest.mock("./echartsCore", ...)` calls — Jest's `babel-plugin-jest-hoist`
  only hoists `jest.mock()` within the file it's written in, so these can't
  live in the shared helper.

## Source (modified)

- `frontend/src/features/panels/ui/ChartPanel.tsx` — trimmed to:
  `ChartPanelProps`, `wrapperRef`/`useMeasuredChartHeight`/`effectiveCompact`/
  `measuredPieLegendOverlap` (layout concerns), calls to `useChartOption`/
  `useChartClickHandler` in the exact position the original inline hooks
  occupied, and the `<ReactECharts>` render (design.md D5). No longer
  imports `resolveChartTheme`/`appearanceToEChartsOption` directly — reached
  only through the new hooks/modules now. Public export (name, props shape,
  default usage) is byte-for-byte unchanged — confirmed via
  `grep -rn "ChartPanel" frontend/src --include=*.tsx -l`: every consumer
  (`PanelContent.tsx`, `editors/ChartDisplayFields.tsx`,
  `renderers/ChartRenderer.tsx`, and test files) needed zero import-site
  edits, and `npm run typecheck`/`npm run lint` both pass clean.

## Tests (new — split by concern, design.md D6)

- `frontend/src/features/panels/ui/ChartPanel.appearance.test.tsx` —
  appearance + `chartOptions` (HEL-248). 13 tests.
- `frontend/src/features/panels/ui/ChartPanel.aggregate.test.tsx` —
  `chartAggregate` (HEL-292), pie `chartAggregate` (HEL-624). 8 tests.
- `frontend/src/features/panels/ui/ChartPanel.compact.test.tsx` — compact
  (HEL-301), compact grid sizing (F-028), measured compact
  (F-094/F-026). 13 tests.
- `frontend/src/features/panels/ui/ChartPanel.theme.test.tsx` — tooltip/hover
  emphasis (HEL-566), including the nested "theme/accent toggle without
  remount" (HEL-566 skeptic-final-1) block. 6 tests.

## Tests (modified — reduced to its own concern)

- `frontend/src/features/panels/ui/ChartPanel.test.tsx` — reduced to: no-data,
  mapped xAxis/yAxis, auto-detect numeric columns, pie chart, scatter chart,
  pie w/unmapped fieldMapping (F-027 regression). 14 tests. Every
  `describe`/`it` in every split file above was moved verbatim from the
  original file — only import paths changed (now importing
  `renderChart`/`getOption`/`baseAppearance`/`baseChartConfig` from
  `chartPanelTestHelpers.tsx` instead of declaring them locally).

## Tests (untouched)

- `frontend/src/features/panels/ui/ChartPanel.click.test.tsx` (HEL-572) — not
  touched by this split; used as the established precedent for a
  concern-scoped test file with its own `jest.mock`/`renderChart` (design.md
  D6). 10 tests.

## Test count (tasks.md 4.1/4.4)

Baseline (original `ChartPanel.test.tsx`, before any split): **54** `it(`/
`test(` calls (`grep -oE '\b(it|test)\(' ChartPanel.test.tsx | wc -l`).

Post-split, summed across the five split files: 14 + 13 + 8 + 13 + 6 = **54**
— exactly matches baseline, no assertion dropped or added. Adding the
untouched `ChartPanel.click.test.tsx` (10) brings the six-file total to
**64**, confirmed by running all six files together
(`npx jest --config jest.config.cjs <six files>`): `Tests: 64 passed, 64
total`.

No assertion's text/expectation changed — every `describe`/`it` body was
moved verbatim; only import paths and file location changed.

## Verification evidence (tasks.md 5.1-5.3)

- `npm run lint` / `npm run typecheck` / `npm run format:check` / `npm test`
  (root, full suite: 350 suites, 3816 tests) / `npm --prefix frontend run
  build` — all clean, zero new warnings.
- Red-first mutation proof (tasks.md 5.2), 3 representative moved tests, each
  reverted and confirmed byte-identical afterward (`diff` against a
  pre-mutation backup):
  1. Dropped `themeSyncTick` from `useChartOption.ts`'s `useMemo` deps →
     both `ChartPanel.theme.test.tsx` "theme/accent toggle without remount"
     tests failed (stale `DARK_SURFACE`/`ACCENT_STRONG(#f97316)` instead of
     the post-toggle value) → reverted → 6/6 pass again.
  2. Removed the `stopPropagation` call in `useChartClickHandler.ts` → 3
     `ChartPanel.click.test.tsx` stopPropagation tests failed (0 calls
     instead of 1) → reverted → 10/10 pass again.
  3. Neutered `hideLegendForMeasuredSize` in `buildChartOption.ts` → 4
     `ChartPanel.compact.test.tsx` legend-hide tests failed (`show: true`
     instead of `show: false`) → reverted → 13/13 pass again.
- Live Playwright verification (tasks.md 5.3), real backend + real browser,
  DEV_PORT=6612 BACKEND_PORT=9519 (via
  `scripts/concertino/start-servers.sh`), screenshots under
  `.concertino/runs/HEL-1180/evidence/` (gitignored, not committed):
  - In-grid theme toggle (via the command-palette theme action — no
    navigation, so the chart never remounts): `document.documentElement`'s
    `data-theme` flipped dark→light, `--app-bg` read back as `#f4f2ed`
    (light) after toggle vs. `#121110` (dark) before — confirmed by reading
    actual pixel RGB values from the two screenshots
    (`(18,17,16)` dark → `(244,242,237)` light at the same coordinate). The
    chart `<canvas>` DOM node identity was captured before/after and
    asserted equal — never remounted.
  - Same check repeated inside `PanelFullscreenOverlay` (opened via the
    panel's Fullscreen button) — canvas identity again asserted unchanged
    across a second toggle, screenshots confirm the fullscreen overlay
    itself also re-themed (pixel `(255,255,255)` white → `(38,35,32)` dark).
  - Click-to-Inspect (HEL-572): clicking a bar inside the fullscreen chart
    opened the "Inspect" dialog nested on top, showing "Showing rows for
    quarter: Q2 / revenue" with the correct row (Q2, 200) — screenshotted.
  - Hover tooltips rendered correctly in both themes (visible in the
    in-grid screenshots, tooltip box present with theme-appropriate
    background).
  - Additionally re-ran the pre-existing `e2e/hel572-chart-click-drilldown.spec.ts`
    (all 3 tests) live against the split code — all pass, confirming the
    HEL-572 click/Inspect/keyboard flows are unaffected end-to-end.
  - The ad-hoc verification spec used to drive this (not part of the shipped
    change — ticket is a pure refactor, no new tests) was deleted after the
    run; only the screenshot evidence and this summary remain.
