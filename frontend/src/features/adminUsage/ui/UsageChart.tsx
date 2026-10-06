import { useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
// The same selectively-registered ECharts instance + `/core` wrapper the dashboard `ChartPanel`
// uses (F-022) — no new chart library.
import ReactECharts from "echarts-for-react/esm/core";

import echarts from "../../panels/ui/echartsCore";
import { defaultChartAppearance, resolveChartTextColor } from "../../../theme/appearance";
import { useTheme } from "../../../theme/ThemeProvider";
import { appearanceToEChartsOption, resolveChartTheme } from "../../../utils/chartAppearance";

export interface UsageSeries {
  name: string;
  /** `null` renders as a gap (never 0). */
  values: Array<number | null>;
}

interface UsageChartProps {
  categories: string[];
  series: UsageSeries[];
  kind: "bar" | "line";
  /** Format the value axis/tooltip, e.g. seconds -> "5m 20s". */
  valueFormatter?: (value: number) => string;
  /** Text alternative for the canvas (the data table next to it carries the full values). */
  ariaLabel: string;
}

/** A themed bar/line chart for the usage page. Chrome (axes, tooltip, fonts, gridlines) comes from
 *  the dashboard chart's own `appearanceToEChartsOption` + `resolveChartTheme`, so it tracks the
 *  live light/dark theme exactly like a panel chart does. */
export function UsageChart({
  categories,
  series,
  kind,
  valueFormatter,
  ariaLabel,
}: UsageChartProps) {
  const { theme, accentColor } = useTheme();
  // Same corrective post-paint recompute `useChartOption` documents: the theme tokens are only
  // correct after ThemeProvider's own effect has written them to the document.
  const [themeSyncTick, setThemeSyncTick] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setThemeSyncTick((n) => n + 1));
    return () => cancelAnimationFrame(raf);
  }, [theme, accentColor]);

  const option = useMemo<EChartsOption>(() => {
    void themeSyncTick;
    const tokens = resolveChartTheme();
    // HEL-1342 — the usage page has no panel appearance, so an undefined appearance resolves to the
    // live `--app-text` token exactly as an inherited panel colour does. `appearanceToEChartsOption`
    // sets colour only on the tooltip, so every other text slot is wired here (fontFamily kept).
    const textColor = resolveChartTextColor(theme, undefined, tokens.text);
    const { option: base } = appearanceToEChartsOption(
      {
        ...defaultChartAppearance,
        chartType: kind,
        legend: { show: series.length > 1, position: "top" },
        axisLabels: { x: { show: true, label: "" }, y: { show: true, label: "" } },
      },
      tokens,
    );
    const baseTextStyle = (base.textStyle as object | undefined) ?? {};
    const textStyle = { ...baseTextStyle, color: textColor };
    const tooltip = {
      ...(base.tooltip as object),
      trigger: "axis" as const,
      ...(valueFormatter
        ? { valueFormatter: (v: unknown) => (typeof v === "number" ? valueFormatter(v) : "—") }
        : {}),
    };
    return {
      ...base,
      backgroundColor: "transparent",
      tooltip,
      textStyle,
      legend: {
        ...(base.legend as object),
        textStyle: {
          ...baseTextStyle,
          ...((base.legend as { textStyle?: object } | undefined)?.textStyle ?? {}),
          color: textColor,
        },
      },
      grid: { left: 8, right: 16, top: series.length > 1 ? 32 : 16, bottom: 8, containLabel: true },
      xAxis: {
        ...(base.xAxis as object),
        type: "category",
        data: categories,
        nameTextStyle: textStyle,
        axisLabel: {
          ...((base.xAxis as { axisLabel?: object }).axisLabel ?? {}),
          color: textColor,
        },
      },
      yAxis: {
        ...(base.yAxis as object),
        type: "value",
        minInterval: valueFormatter ? undefined : 1,
        nameTextStyle: textStyle,
        axisLabel: {
          ...((base.yAxis as { axisLabel?: object }).axisLabel ?? {}),
          color: textColor,
          ...(valueFormatter ? { formatter: (v: number) => valueFormatter(v) } : {}),
        },
      },
      series: series.map((s) => ({
        type: kind,
        name: s.name,
        data: s.values,
        // A null leaves a gap in the line; never connect across missing days.
        connectNulls: false,
        ...(kind === "line" ? { showSymbol: categories.length <= 31, smooth: false } : {}),
      })),
    } as EChartsOption;
  }, [categories, series, kind, valueFormatter, themeSyncTick, theme]);

  return (
    <div className="usage-chart" role="img" aria-label={ariaLabel}>
      <ReactECharts
        echarts={echarts}
        option={option}
        notMerge={true}
        autoResize={true}
        style={{ height: "100%", width: "100%" }}
      />
    </div>
  );
}
