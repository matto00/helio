## 1. Frontend — theme tokens

- [x] 1.1 Extend `ChartThemeTokens`/`resolveChartTheme()` in `chartAppearance.ts` with `shadowSoft`
      (`--app-shadow-soft`), `radiusMd` (`--app-radius-md`), and `accentStrong` (`--app-accent-strong`
      — DESIGN.md's documented `(hover)` token, not plain `--app-accent`); verify via a unit test
      asserting all three are read with the same live/fallback pattern as the existing five tokens.
- [x] 1.2 Add a `prefersReducedMotion()` helper alongside `resolveChartTheme()` (guarded for
      `typeof window === "undefined"`, matching the existing SSR/Jest guard shape); verify with a
      unit test mocking `window.matchMedia`.

## 2. Frontend — tooltip

- [x] 2.1 Apply `shadowSoft`/`radiusMd` to `tooltip.extraCssText` and switch `tooltip.textStyle` to
      `fontMono` in `appearanceToEChartsOption`; verify with a unit test asserting the built option's
      `tooltip.extraCssText` and `tooltip.textStyle.fontFamily`.
- [x] 2.2 Add per-`chartType` `trigger`/`axisPointer` — axis+shadow for bar, axis+line for line,
      ONLY when the chart has more than one series (item-trigger otherwise, matching the ticket AC
      and spec Requirement 2 exactly); item-trigger unchanged for pie/scatter regardless of series
      count. Verify with unit tests covering: multi-series bar, multi-series line, single-series bar,
      single-series line, pie, scatter — asserting `tooltip.trigger`/`tooltip.axisPointer.type` for
      each.

## 3. Frontend — hover emphasis

- [x] 3.1 Add subtle `series[].emphasis` (`--app-accent-strong`-colored highlight — DESIGN.md's
      documented `(hover)` token, matching the ~20-site site-wide `:hover` convention, not plain
      `--app-accent` — `focus: "series"`) to the built option, gated so `prefersReducedMotion()` sets
      `animation: false` on the emphasis-relevant series instead of omitting emphasis; verify with a
      unit test for both the animated and reduced-motion cases.
- [x] 3.2 Add `accentColor` (from `useTheme()`) to `ChartPanel.tsx`'s option-building `useMemo`
      dependency array; verify with a component test asserting the memoized option changes when
      `accentColor` changes alone (no `theme` change).

## 4. Tests — integration/visual

- [x] 4.1 Run `npm test -- --testPathPatterns='chartAppearance|chartTypeOptions|ChartPanel'` and
      confirm the new/updated unit and component tests pass, red-before-green (show the new
      assertions failing against pre-change code first).
- [x] 4.2 Live-verify in both light and dark theme, plus an accent change, in-grid AND inside
      `PanelFullscreenOverlay` (HEL-584's fullscreen modal reuses `ChartPanel` unmodified) — no
      remount glitches, tooltip/hover read correctly in both surfaces.
- [x] 4.3 Run `npm run lint` and `npm run typecheck`; zero new warnings.

## Standing Constraints

(none promoted this run — no skeptic/design-gate verdict or Planning ESCALATION resolution has
settled a new standing methodology constraint yet)
