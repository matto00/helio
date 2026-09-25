import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";

import type { ChartTypeOptionsMap, PanelAppearance } from "../types/panel";
import { resolveChartTheme } from "../../../utils/chartAppearance";
import type { GroupedAggregate } from "../../../utils/aggregate";
import { useTheme } from "../../../theme/ThemeProvider";
import { buildChartOption } from "./buildChartOption";

export interface UseChartOptionParams {
  appearance?: PanelAppearance;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  fieldMapping?: Record<string, string> | null;
  chartAggregate?: GroupedAggregate | null;
  chartOptions?: ChartTypeOptionsMap | null;
  effectiveCompact: boolean;
  measuredPieLegendOverlap: boolean;
}

/** Owns the HEL-566 theme-sync state (`useTheme()` + the `themeSyncTick` rAF
 *  `useEffect`) and the memoized ECharts option (design.md D3 — a direct,
 *  mechanical move of `ChartPanel`'s own former hook sequence, called from
 *  the exact position those hooks used to occupy so React's hook-order
 *  invariant is unaffected). */
export function useChartOption({
  appearance,
  rawRows,
  headers,
  fieldMapping,
  chartAggregate,
  chartOptions,
  effectiveCompact,
  measuredPieLegendOverlap,
}: UseChartOptionParams): EChartsOption {
  // `theme`/`accentColor` are read only to force the memo below to recompute
  // when the user flips light/dark or changes accent — `resolveChartTheme()`
  // re-reads the live computed CSS custom properties itself and isn't
  // derived from either value directly.
  const { theme, accentColor } = useTheme();

  // HEL-566 skeptic-final-1 CR1 — a `theme`/`accentColor` change alone is
  // NOT enough to guarantee the memo below reads the CORRECT tokens: on the
  // very render this state change triggers, `document.documentElement`'s
  // `data-theme` attribute (and the accent custom properties
  // `applyAccentTokens` writes) have NOT been updated yet — that DOM
  // mutation happens in `ThemeProvider`'s own `useEffect`, which (like every
  // passive effect) runs strictly AFTER the render phase of the triggering
  // commit, so `resolveChartTheme()`'s live `getComputedStyle` read captures
  // the PREVIOUS theme/accent's values. A same-commit child effect in THIS
  // component doesn't help either — passive effects fire child-before-parent
  // within one commit, so a plain `useEffect([theme, accentColor])` here
  // still runs before `ThemeProvider`'s own effect. Root-cause confirmed via
  // a minimal probe (mounting `ThemeProvider` + a consumer that records
  // `document.documentElement`'s attribute at render time, a same-commit
  // child-effect time, and a `requestAnimationFrame`-deferred time across a
  // toggle): the render-time and child-effect-time reads both observed the
  // STALE attribute; only the rAF-deferred read (which fires after the
  // browser paints — i.e. after every effect of the commit, ancestor AND
  // descendant, has already run) observed the corrected one. `themeSyncTick`
  // forces exactly one corrective recompute once that's guaranteed true.
  const [themeSyncTick, setThemeSyncTick] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setThemeSyncTick((n) => n + 1));
    return () => cancelAnimationFrame(raf);
  }, [theme, accentColor]);

  // F-231 — this used to rebuild the full ECharts option object on every
  // render. Memoized on the actual inputs that can change its shape.
  const option = useMemo<EChartsOption>(() => {
    // Deliberate cache-buster (see the comment above the `useTheme()` call):
    // `resolveChartTheme()` re-reads the live computed CSS custom properties
    // itself rather than deriving from either value, so they're referenced
    // here only to justify their presence in the dependency array below.
    // HEL-566: `accentStrong` (the hover-emphasis color) is derived from
    // `--app-accent` via CSS `color-mix`, so an accent-only change — no
    // theme toggle — still needs to force this memo to re-resolve it
    // (design.md Decision 5). `themeSyncTick` is the corrective re-resolve
    // once the DOM is guaranteed to reflect the new theme/accent — see the
    // comment above its `useEffect` above.
    void theme;
    void accentColor;
    void themeSyncTick;

    const themeTokens = resolveChartTheme();

    return buildChartOption({
      appearance,
      rawRows,
      headers,
      fieldMapping,
      chartAggregate,
      chartOptions,
      effectiveCompact,
      measuredPieLegendOverlap,
      themeTokens,
    });
  }, [
    appearance,
    rawRows,
    headers,
    fieldMapping,
    chartAggregate,
    chartOptions,
    effectiveCompact,
    measuredPieLegendOverlap,
    theme,
    accentColor,
    themeSyncTick,
  ]);

  return option;
}
