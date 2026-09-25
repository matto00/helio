## 1. Source split — pure modules

- [x] 1.1 Create `frontend/src/features/panels/ui/chartDataOptions.ts` containing
      `buildDataOption`/`buildDataOptionCore`/`buildAggregateDataOption`/
      `withPointerCursor`, moved verbatim (no React import); verify `npm run
      typecheck` passes with these exports imported from `ChartPanel.tsx`.
- [x] 1.2 Create `frontend/src/features/panels/ui/buildChartOption.ts` containing
      the appearance+data+compact merge logic (current `useMemo` body minus the
      `void theme/accentColor/themeSyncTick` cache-buster lines), `defaultOption`,
      `COMPACT_AXIS_LABEL_FONT_SIZE`, `COMPACT_GRID_INSET_PX`, importing from
      `chartDataOptions.ts`; verify `npm run typecheck` passes.

## 2. Source split — hooks

- [x] 2.1 Create `frontend/src/features/panels/ui/useChartOption.ts`: hook owning
      `useTheme()`, the `themeSyncTick` `useState`+rAF `useEffect` (dependency
      array `[theme, accentColor]`, copied verbatim), and the `useMemo` calling
      `buildChartOption(...)` (dependency array copied verbatim from the current
      file). The `void theme; void accentColor; void themeSyncTick;`
      cache-buster lines and the `resolveChartTheme()` call both stay INSIDE
      this hook's `useMemo` callback (called before `buildChartOption(...)`) —
      `buildChartOption` itself takes only `themeTokens` plus the real data/
      appearance/compact inputs, never `theme`/`accentColor`/`themeSyncTick`
      directly (design.md D2, revised per design-gate skeptic round 1: passing
      those three as unused trailing parameters to a plain function fails
      `@typescript-eslint/no-unused-vars` under the zero-warnings lint policy).
      Verify `npm run typecheck` AND `npm run lint` both pass.
- [x] 2.2 Create `frontend/src/features/panels/ui/useChartClickHandler.ts`: hook
      owning `EChartsClickEventParams`, `handleChartClick` (`useCallback`, deps
      copied verbatim), and the `chartOnEvents` `useMemo`; verify `npm run
      typecheck` passes.

## 3. Component

- [x] 3.1 Trim `ChartPanel.tsx` to: `ChartPanelProps`, `wrapperRef`/
      `useMeasuredChartHeight`/`effectiveCompact`/`measuredPieLegendOverlap`, calls
      to `useChartOption`/`useChartClickHandler` in the exact position the
      original inline hooks occupied, and the `<ReactECharts>` render; verify the
      file no longer imports `resolveChartTheme`/`appearanceToEChartsOption`
      directly (now only reached via the new hooks/modules) and `npm run
      typecheck` + `npm run lint` both pass with zero new warnings.
- [x] 3.2 Confirm `ChartPanel`'s public export (name, props shape, default usage)
      is byte-for-byte unchanged — `grep -rn "ChartPanel" frontend/src --include=*.tsx
      -l` and confirm no import-site edits are needed outside this directory.

## 4. Tests — split by concern

- [x] 4.1 Record the exact `it(`/`test(` count in the current
      `ChartPanel.test.tsx` (`grep -c` or `npm test -- --testPathPatterns=ChartPanel
      --listTests`/`--verbose` count) before making any test-file changes.
- [x] 4.2 Create `frontend/src/features/panels/ui/chartPanelTestHelpers.tsx`
      exporting all four of `ChartPanel.test.tsx`'s module-level symbols declared
      outside any `describe` block: `renderChart`, `getOption`, `baseAppearance`,
      `baseChartConfig` (current file lines ~23-212; `baseAppearance`/
      `baseChartConfig` confirmed by design-gate skeptic round 1 to be used from
      all five destination test files below — do not omit them). Each new test
      file below still declares its OWN
      `jest.mock("echarts-for-react/esm/core", ...)` and
      `jest.mock("./echartsCore", ...)` at its own top level (Jest only hoists
      `jest.mock` within the file it's called in — do not move these into the
      shared helper, see design.md D6).
- [x] 4.3 Split `ChartPanel.test.tsx` into: `ChartPanel.test.tsx` (no-data, mapped
      xAxis/yAxis, auto-detect numeric columns, pie chart, scatter chart, pie
      w/unmapped fieldMapping F-027 regression), `ChartPanel.appearance.test.tsx`
      (appearance, chartOptions HEL-248), `ChartPanel.aggregate.test.tsx`
      (chartAggregate HEL-292, pie chartAggregate HEL-624),
      `ChartPanel.compact.test.tsx` (compact HEL-301, compact grid sizing F-028,
      measured compact F-094/F-026), `ChartPanel.theme.test.tsx` (tooltip/hover
      HEL-566, theme/accent toggle without remount HEL-566 skeptic-final-1) —
      every `describe`/`it` moved verbatim, only import paths changed.
      `ChartPanel.click.test.tsx` (HEL-572) is untouched.
- [x] 4.4 Verify the summed `it(`/`test(` count across all six files (five split
      files + untouched click file) equals or exceeds task 4.1's baseline; list
      any assertion whose text/expectation changed, with reason (expect none).
- [x] 4.5 Run `npm test -- --testPathPatterns=ChartPanel` and confirm all suites
      pass.

## 5. Verification

- [x] 5.1 Run `npm run lint`, `npm run typecheck`, `npm test` from `frontend/`
      (or repo root per CLAUDE.md) and confirm zero errors, zero new warnings.
- [x] 5.2 Red-first mutation proof: pick 2-3 representative moved tests (at least
      one from `ChartPanel.theme.test.tsx`'s theme/accent-toggle-without-remount
      block and one from `ChartPanel.click.test.tsx`), mutate the code they cover
      in its NEW location (e.g. drop `themeSyncTick` from the `useMemo` deps in
      `useChartOption.ts`, or remove `stopPropagation` in
      `useChartClickHandler.ts`), show the test fails, then revert the mutation
      and show it passes again.
- [x] 5.3 Live-verify via Playwright, WITHOUT navigating away between checks (in
      the same mounted chart): light/dark theme toggle re-resolves tooltip
      styling (a) in-grid and (b) inside `PanelFullscreenOverlay`; click-to-Inspect
      (HEL-572) still opens the inspect flow; hover tooltips (HEL-566) still
      render with correct styling. Screenshots go under
      `.concertino/runs/HEL-1180/evidence/`, never the main checkout root.
- [x] 5.4 Update `files-modified.md` listing every touched/new file (source +
      tests) for the squash-commit declaration.
