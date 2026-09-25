import type { EChartsOption } from "echarts";

import type { ChartAppearance } from "../features/panels/types/panel";
export type ChartType = "bar" | "line" | "pie" | "scatter";

export interface AppearanceResult {
  option: EChartsOption;
  chartType: ChartType;
}

/** Theme tokens ECharts' canvas-rendered chrome (gridlines, tooltip, text)
 *  needs as plain strings — CSS custom properties don't reach into canvas,
 *  so this is the one place that bridges `theme.css` into ECharts option
 *  values. Kept to exactly the tokens callers need (design.md "central
 *  chart-theme integration pass"). */
export interface ChartThemeTokens {
  surfaceStrong: string;
  borderSubtle: string;
  text: string;
  fontSans: string;
  fontMono: string;
  /** HEL-566: `--app-shadow-soft`, applied to the tooltip's `extraCssText`. */
  shadowSoft: string;
  /** HEL-566: `--app-radius-md`, applied to the tooltip's `extraCssText`. */
  radiusMd: string;
  /** HEL-566: `--app-accent-strong` — DESIGN.md §3's documented `(hover)`
   *  accent token, used for hover-emphasis highlighting. Deliberately NOT
   *  plain `--app-accent` (see design.md Decision 5). */
  accentStrong: string;
}

/** Dark-theme literal fallbacks (`theme.css`'s `:root[data-theme="dark"]`
 *  values) for environments with no `document` (SSR, and Jest — every
 *  ChartPanel test mocks `echarts-for-react` down to a plain div, so the
 *  option this builds is asserted directly rather than rendered to a real
 *  canvas). Real browser sessions always resolve the live computed values
 *  instead. `accentStrong`'s fallback is a rounded approximation of
 *  `color-mix(in srgb, #f97316 78%, white)` — dark theme's default accent
 *  (`DefaultAccentColorByTheme.dark`, `theme.ts`) run through `--app-accent-
 *  strong`'s own recipe (`theme.css`) — since `color-mix` can't be evaluated
 *  outside a real browser; only ever used off this SSR/Jest path. */
const FALLBACK_CHART_THEME: ChartThemeTokens = {
  surfaceStrong: "#262320",
  borderSubtle: "rgba(242, 239, 233, 0.09)",
  text: "#f2efe9",
  fontSans: "Schibsted Grotesk, system-ui, sans-serif",
  fontMono: "JetBrains Mono, ui-monospace, monospace",
  shadowSoft: "0 4px 16px rgba(0, 0, 0, 0.35), 0 24px 64px -16px rgba(0, 0, 0, 0.55)",
  radiusMd: "9px",
  accentStrong: "#fa9249",
};

/** Reads the app's current theme tokens straight off the document root's
 *  computed style, so ECharts chrome tracks the live light/dark theme (and
 *  any accent-independent token change) without a second, hand-maintained
 *  copy of the palette. Call at render time — the caller is responsible for
 *  re-invoking (and thus re-reading) on theme change; see `ChartPanel`'s
 *  `useTheme` dependency. */
export function resolveChartTheme(): ChartThemeTokens {
  if (typeof document === "undefined") return FALLBACK_CHART_THEME;
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  return {
    surfaceStrong: read("--app-surface-strong", FALLBACK_CHART_THEME.surfaceStrong),
    borderSubtle: read("--app-border-subtle", FALLBACK_CHART_THEME.borderSubtle),
    text: read("--app-text", FALLBACK_CHART_THEME.text),
    fontSans: read("--font-sans", FALLBACK_CHART_THEME.fontSans),
    fontMono: read("--font-mono", FALLBACK_CHART_THEME.fontMono),
    shadowSoft: read("--app-shadow-soft", FALLBACK_CHART_THEME.shadowSoft),
    radiusMd: read("--app-radius-md", FALLBACK_CHART_THEME.radiusMd),
    accentStrong: read("--app-accent-strong", FALLBACK_CHART_THEME.accentStrong),
  };
}

/** Live read of the OS/browser reduced-motion preference. ECharts
 *  hover-emphasis motion (Decision 4) is JS option config, not CSS, so the
 *  existing `motionTokenGuard.css.test.ts` (which only scans `.css` files)
 *  never covers it — this has to be read explicitly, mirroring `Toast.tsx`'s
 *  own private `prefersReducedMotion` (same guard shape, same query; kept as
 *  its own copy here rather than a shared export — out of this ticket's
 *  scope, see `useIsNarrowerThan.ts`'s doc comment for the existing
 *  convention name). Guards `matchMedia` itself, not just `window` — jsdom
 *  (the test environment) doesn't implement it at all, so an unmocked test
 *  would otherwise throw rather than simply behaving as "no preference". */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Matches `MetricRenderer.formatMetricValue`'s convention (design.md
 *  Decision 1, HEL-297): 2 fraction digits max, no thousands grouping — so a
 *  dashboard's numeric presentation is consistent panel-to-panel instead of
 *  charts alone inheriting ECharts' own comma-grouped default (F-195). */
const chartNumberFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
  useGrouping: false,
});

/** ECharts `axisLabel`/`tooltip.valueFormatter` callback. Non-numeric inputs
 *  (category axis ticks, string tooltip fields) pass through unchanged. */
export function formatChartNumber(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? chartNumberFormat.format(n) : String(value);
}

/** HEL-572 — the chart type a panel actually renders is `appearance.chart.
 *  chartType`, defaulting `"line"` when unset (mirrors
 *  `appearanceToEChartsOption`'s own derivation, which is the only other
 *  place this was previously computed inline). Exported so `ChartPanel`'s
 *  click handler and `PanelCard`/`PanelFullscreenOverlay`'s inspect-view
 *  mounting (which never call `appearanceToEChartsOption` — that also
 *  builds a full ECharts option object, wasted work for a value this small)
 *  resolve the SAME chart type without a second, divergence-prone copy of
 *  this fallback. */
export function resolveChartType(chart: ChartAppearance | undefined): ChartType {
  return (chart?.chartType as ChartType | undefined) ?? "line";
}

function legendPositionProps(position: string): Record<string, unknown> {
  switch (position) {
    case "top":
      return { orient: "horizontal", top: 0, left: "center" };
    case "bottom":
      return { orient: "horizontal", bottom: 0, left: "center" };
    case "left":
      return { orient: "vertical", left: 0, top: "middle" };
    case "right":
      return { orient: "vertical", right: 0, top: "middle" };
    default:
      return { orient: "horizontal", top: 0, left: "center" };
  }
}

export function appearanceToEChartsOption(
  chart: ChartAppearance,
  themeTokens: ChartThemeTokens = resolveChartTheme(),
): AppearanceResult {
  const chartType: ChartType = resolveChartType(chart);
  // F-024: gridlines/axis-lines/ticks were never theme-aware (no color at
  // all → ECharts' own default, which is a bright white/black streak
  // depending on theme). Wire them to the same subtle border token the rest
  // of the app's chrome uses.
  const axisLineStyle = { lineStyle: { color: themeTokens.borderSubtle } };
  const option: EChartsOption = {
    legend: {
      show: chart.legend.show,
      ...legendPositionProps(chart.legend.position),
    },
    // F-025: tooltip previously had no backgroundColor/borderColor/textStyle
    // — a stark unstyled white box in dark theme. HEL-566: `extraCssText`
    // carries shadow/radius — the tooltip is a real DOM element positioned
    // over the canvas, so box-shadow/border-radius aren't reachable through
    // ECharts' typed tooltip props (design.md Decision 1). `textStyle`'s
    // `fontFamily` is `fontMono` (not `fontSans`, unlike the rest of the
    // chart's chrome) so the tooltip's numeric values render tabular, mono —
    // mirroring the axis-label convention already in place (Decision 2).
    tooltip: {
      show: chart.tooltip.enabled,
      backgroundColor: themeTokens.surfaceStrong,
      borderColor: themeTokens.borderSubtle,
      borderWidth: 1,
      textStyle: { color: themeTokens.text, fontFamily: themeTokens.fontMono },
      valueFormatter: formatChartNumber,
      extraCssText: `box-shadow: ${themeTokens.shadowSoft}; border-radius: ${themeTokens.radiusMd};`,
    },
    // F-196: canvas text never set fontFamily, so it rendered in the
    // browser default sans rather than the app's `--font-sans`.
    textStyle: { fontFamily: themeTokens.fontSans },
    xAxis: {
      type: "category",
      // F-095: an empty label omits `name` entirely (undefined) rather than
      // rendering a placeholder-looking `name: ""` axis title.
      name: chart.axisLabels.x.label || undefined,
      axisLabel: { show: chart.axisLabels.x.show, fontFamily: themeTokens.fontMono },
      axisLine: axisLineStyle,
      axisTick: axisLineStyle,
      splitLine: axisLineStyle,
    },
    yAxis: {
      type: "value",
      name: chart.axisLabels.y.label || undefined,
      axisLabel: {
        show: chart.axisLabels.y.show,
        fontFamily: themeTokens.fontMono,
        formatter: formatChartNumber,
      },
      axisLine: axisLineStyle,
      axisTick: axisLineStyle,
      splitLine: axisLineStyle,
    },
  };
  if (chart.seriesColors.length > 0) {
    option.color = chart.seriesColors;
  }
  return { option, chartType };
}

/** Reads `option.series` as an array regardless of whether ECharts' own
 *  single-object-or-array shape is in play — mirrors `chartTypeOptions.ts`'s
 *  private `seriesArray` helper (kept as its own small copy here rather than
 *  a cross-module import: both files read the same built-option shape at a
 *  different point in `ChartPanel`'s assembly pipeline, and the two-line
 *  duplication is cheaper than the coupling). */
function toSeriesArray(option: EChartsOption): Array<Record<string, unknown>> {
  const series = option.series;
  if (Array.isArray(series)) return series as Array<Record<string, unknown>>;
  if (series) return [series as Record<string, unknown>];
  return [];
}

/** Design D3 — axis-trigger tooltip for shared-x, multi-series bar/line
 *  charts only. Runs as a post-merge pass over the FINAL series array (called
 *  from `ChartPanel.tsx` after `dataOption`'s real series are known — see
 *  Decision 3's placement rationale), unlike the rest of the tooltip config,
 *  which `appearanceToEChartsOption` sets before series count is known. Pie
 *  has no axis; scatter's x/y are both continuous value axes with no natural
 *  category comparison; a single-series bar/line keeps the existing
 *  item-trigger tooltip unchanged. */
export function applyAxisTriggerTooltip(
  option: EChartsOption,
  chartType: ChartType,
): EChartsOption {
  if (chartType !== "bar" && chartType !== "line") return option;
  if (toSeriesArray(option).length <= 1) return option;
  return {
    ...option,
    tooltip: {
      ...(option.tooltip as object),
      trigger: "axis",
      axisPointer: { type: chartType === "bar" ? "shadow" : "line" },
    },
  };
}

/** Design D4 — subtle, `--app-accent-strong`-colored hover emphasis on every
 *  series (series/point highlight), gated on a live `prefers-reduced-motion`
 *  read: when reduced motion is requested, the emphasis state change is
 *  instant (`animation: false` on the series) rather than omitted outright —
 *  the requirement is "no animated transition," not "no emphasis." Runs as
 *  its own post-merge pass (see `applyAxisTriggerTooltip` above) for the same
 *  reason: it needs the final, real series array. */
export function applyHoverEmphasis(
  option: EChartsOption,
  themeTokens: ChartThemeTokens = resolveChartTheme(),
  reducedMotion: boolean = prefersReducedMotion(),
): EChartsOption {
  const series = toSeriesArray(option);
  if (series.length === 0) return option;
  const emphasis = {
    focus: "series",
    itemStyle: { borderColor: themeTokens.accentStrong, borderWidth: 2 },
    lineStyle: { color: themeTokens.accentStrong, width: 3 },
  };
  return {
    ...option,
    series: series.map((s) => ({
      ...s,
      emphasis: { ...((s.emphasis as object | undefined) ?? {}), ...emphasis },
      ...(reducedMotion ? { animation: false } : {}),
    })),
  } as EChartsOption;
}
