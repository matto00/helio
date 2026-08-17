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
}

/** Dark-theme literal fallbacks (`theme.css`'s `:root[data-theme="dark"]`
 *  values) for environments with no `document` (SSR, and Jest — every
 *  ChartPanel test mocks `echarts-for-react` down to a plain div, so the
 *  option this builds is asserted directly rather than rendered to a real
 *  canvas). Real browser sessions always resolve the live computed values
 *  instead. */
const FALLBACK_CHART_THEME: ChartThemeTokens = {
  surfaceStrong: "#262320",
  borderSubtle: "rgba(242, 239, 233, 0.09)",
  text: "#f2efe9",
  fontSans: "Schibsted Grotesk, system-ui, sans-serif",
  fontMono: "JetBrains Mono, ui-monospace, monospace",
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
  };
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
  const chartType: ChartType = (chart.chartType as ChartType) ?? "line";
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
    // — a stark unstyled white box in dark theme.
    tooltip: {
      show: chart.tooltip.enabled,
      backgroundColor: themeTokens.surfaceStrong,
      borderColor: themeTokens.borderSubtle,
      borderWidth: 1,
      textStyle: { color: themeTokens.text, fontFamily: themeTokens.fontSans },
      valueFormatter: formatChartNumber,
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
