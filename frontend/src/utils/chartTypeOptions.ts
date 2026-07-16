// HEL-248 — apply persisted per-chart-type display options to a built ECharts
// option. Kept out of `ChartPanel.tsx` (which stays within the file-size
// budget and owns data assembly) and unit-tested directly. Every branch maps
// to a real ECharts construct (design.md D4):
//   - line:    series.smooth / series.showSymbol / series.areaStyle
//   - bar:     series.stack (+ client percent transform for normalized) /
//              series.barCategoryGap / category↔value axis swap for horizontal
//   - pie:     series.radius (donut) / series.label percent formatter
// Scatter's size/color options change *data assembly*, so they live in
// `ChartPanel.tsx`'s scatter branch, not here.

import type { EChartsOption } from "echarts";

import type {
  BarChartOptions,
  ChartTypeOptionsMap,
  LineChartOptions,
  PieChartOptions,
} from "../features/panels/types/panel";
import type { ChartType } from "./chartAppearance";

/** Symbol-size px range for scatter bubble sizing (`sizeField`). */
export const SCATTER_SYMBOL_MIN_PX = 6;
export const SCATTER_SYMBOL_MAX_PX = 40;
const PIE_OUTER_RADIUS = "70%";

type MutableSeries = Record<string, unknown> & { data?: unknown };

function seriesArray(option: EChartsOption): MutableSeries[] {
  const series = option.series;
  if (Array.isArray(series)) return series.map((s) => ({ ...(s as MutableSeries) }));
  if (series) return [{ ...(series as MutableSeries) }];
  return [];
}

function applyLine(option: EChartsOption, line: LineChartOptions): EChartsOption {
  const series = seriesArray(option).map((s) => ({
    ...s,
    ...(line.smooth ? { smooth: true } : {}),
    // Absent → leave ECharts' default (markers on). Only an explicit value
    // overrides it, so a persisted `false` reliably hides the markers.
    ...(line.showPoints === false
      ? { showSymbol: false }
      : line.showPoints === true
        ? { showSymbol: true }
        : {}),
    ...(line.areaFill ? { areaStyle: {} } : {}),
  }));
  return { ...option, series } as EChartsOption;
}

/** Replace each series' values with its per-category percent share so every
 *  category's rendered values sum to 100 (ECharts has no native normalized
 *  stack — design.md D4). Divide-by-zero categories map to 0. */
function toPercentShares(series: MutableSeries[]): MutableSeries[] {
  const categoryCount = series.reduce(
    (max, s) => Math.max(max, Array.isArray(s.data) ? s.data.length : 0),
    0,
  );
  const sums: number[] = [];
  for (let i = 0; i < categoryCount; i++) {
    sums[i] = series.reduce((acc, s) => {
      const v = Array.isArray(s.data) ? Number(s.data[i]) : NaN;
      return acc + (isNaN(v) ? 0 : v);
    }, 0);
  }
  return series.map((s) => ({
    ...s,
    data: Array.isArray(s.data)
      ? s.data.map((raw, i) => {
          const v = Number(raw);
          return sums[i] ? ((isNaN(v) ? 0 : v) / sums[i]) * 100 : 0;
        })
      : s.data,
  }));
}

function applyBar(option: EChartsOption, bar: BarChartOptions): EChartsOption {
  const stacked = bar.stacking === "stacked" || bar.stacking === "normalized";
  const normalized = bar.stacking === "normalized";

  let series = seriesArray(option);
  if (normalized) series = toPercentShares(series);
  series = series.map((s) => ({
    ...s,
    ...(stacked ? { stack: "total" } : {}),
    ...(bar.barGapPct !== undefined ? { barCategoryGap: `${bar.barGapPct}%` } : {}),
  }));

  // Normalized: label the value axis 0–100%.
  const valueAxisPatch = normalized
    ? {
        max: 100,
        axisLabel: {
          ...((option.yAxis as { axisLabel?: object } | undefined)?.axisLabel ?? {}),
          formatter: "{value}%",
        },
      }
    : {};

  if (bar.orientation === "horizontal") {
    // Swap axis roles: the category axis (carrying the `data`) becomes the
    // y-axis and the value axis becomes the x-axis.
    const categoryAxis = option.xAxis as object;
    const valueAxis = { ...((option.yAxis as object) ?? {}), ...valueAxisPatch };
    return { ...option, series, xAxis: valueAxis, yAxis: categoryAxis } as EChartsOption;
  }

  return {
    ...option,
    series,
    yAxis: { ...((option.yAxis as object) ?? {}), ...valueAxisPatch },
  } as EChartsOption;
}

function applyPie(option: EChartsOption, pie: PieChartOptions): EChartsOption {
  const series = seriesArray(option).map((s, index) =>
    index === 0
      ? {
          ...s,
          ...(pie.donutHolePct ? { radius: [`${pie.donutHolePct}%`, PIE_OUTER_RADIUS] } : {}),
          ...(pie.showPercentLabels
            ? {
                label: {
                  ...((s.label as object) ?? {}),
                  show: true,
                  formatter: "{b}: {d}%",
                },
              }
            : {}),
        }
      : s,
  );
  return { ...option, series } as EChartsOption;
}

/** Apply the active chart type's persisted options to the assembled option.
 *  Options stored under a non-active type are ignored. Absent per-field entries
 *  fall back to the current defaults. */
export function applyChartTypeOptions(
  option: EChartsOption,
  chartType: ChartType,
  options: ChartTypeOptionsMap | null | undefined,
): EChartsOption {
  if (!options) return option;
  if (chartType === "line" && options.line) return applyLine(option, options.line);
  if (chartType === "bar" && options.bar) return applyBar(option, options.bar);
  if (chartType === "pie" && options.pie) return applyPie(option, options.pie);
  return option;
}

/** Build the ECharts `symbolSize` callback for a scatter `sizeField`: scales
 *  the third data dimension into a clamped px range. Kept here so `ChartPanel`
 *  can attach it to the scatter series it assembles. */
export function makeScatterSymbolSize(sizeValues: number[]): (value: number[]) => number {
  const finite = sizeValues.filter((n) => !isNaN(n));
  const min = finite.length > 0 ? Math.min(...finite) : 0;
  const max = finite.length > 0 ? Math.max(...finite) : 0;
  return (value: number[]) => {
    const raw = Array.isArray(value) ? Number(value[2]) : Number(value);
    const size = isNaN(raw) ? min : raw;
    if (max === min) return (SCATTER_SYMBOL_MIN_PX + SCATTER_SYMBOL_MAX_PX) / 2;
    const t = (size - min) / (max - min);
    return SCATTER_SYMBOL_MIN_PX + t * (SCATTER_SYMBOL_MAX_PX - SCATTER_SYMBOL_MIN_PX);
  };
}
