// HEL-1311 — data options and theming for the `heatmap` and `histogram` chart types, split out of
// `chartDataOptions.ts` to keep that file inside the size budget. Both branches check
// `fieldMapping` slots explicitly and never use `resolveDataColumns`' column-0 fallback: an unmapped
// slot renders an empty chart rather than a guessed one.

import type { EChartsOption } from "echarts";

import type { HistogramChartOptions } from "../types/panel";
import { binHistogram } from "../../../utils/histogramBins";
import { formatChartNumber } from "../../../utils/chartAppearance";
import { withAlpha } from "./chartOverlayOption";
import type { ChartThemeTokens } from "../../../utils/chartAppearance";

/** The lowest alpha of the heatmap colour scale: a floor so the smallest value is still
 *  distinguishable from an empty cell (the card surface showing through). */
export const HEATMAP_MIN_OPACITY = 0.25;

/** Space below the grid for the horizontal colour-scale legend (visualMap) in px. */
export const HEATMAP_VISUALMAP_CLEARANCE_PX = 56;
/** The same in compact mode (a ~100px-tall phone/small card): a thinner bar and 10px labels. */
export const HEATMAP_COMPACT_CLEARANCE_PX = 36;
export const HEATMAP_COMPACT_BAR_THICKNESS_PX = 10;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnIndex(headers: string[], name: string | undefined): number {
  return name ? headers.indexOf(name) : -1;
}

/** Columns = `xAxis` values, rows = `series` values (both first-appearance order), cell = the SUM of
 *  the numeric `yAxis` values sharing that column/row. A cell with no numeric value is not emitted
 *  (drawn empty). Any unmapped or unknown slot, or no plottable cell, yields `{}`. */
export function buildHeatmapDataOption(
  rawRows: string[][],
  headers: string[],
  fieldMapping: Record<string, string> | null | undefined,
): Partial<EChartsOption> {
  const xCol = columnIndex(headers, fieldMapping?.xAxis);
  const rowCol = columnIndex(headers, fieldMapping?.series);
  const vCol = columnIndex(headers, fieldMapping?.yAxis);
  if (xCol === -1 || rowCol === -1 || vCol === -1) return {};

  const columns = [...new Set(rawRows.map((r) => r[xCol] ?? ""))];
  const rows = [...new Set(rawRows.map((r) => r[rowCol] ?? ""))];
  const colIdx = new Map(columns.map((c, i) => [c, i]));
  const rowIdx = new Map(rows.map((c, i) => [c, i]));

  const sums = new Map<string, number>();
  for (const r of rawRows) {
    const v = parseFloat(r[vCol] ?? "");
    if (!Number.isFinite(v)) continue;
    const key = `${colIdx.get(r[xCol] ?? "")}:${rowIdx.get(r[rowCol] ?? "")}`;
    sums.set(key, (sums.get(key) ?? 0) + v);
  }
  if (sums.size === 0) return {};

  const data = [...sums].map(([key, sum]) => {
    const [xi, yi] = key.split(":").map(Number);
    return [xi, yi, sum];
  });
  const values = data.map((d) => d[2]);
  return {
    xAxis: { type: "category", data: columns, splitArea: { show: false } },
    yAxis: { type: "category", data: rows },
    // The colour scale replaces a per-series legend.
    legend: { data: [] },
    visualMap: {
      type: "continuous",
      min: Math.min(...values),
      max: Math.max(...values),
      // End labels: the plotted maximum (right) and minimum (left).
      text: [formatChartNumber(Math.max(...values)), formatChartNumber(Math.min(...values))],
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 0,
    },
    tooltip: {
      trigger: "item",
      formatter: (p: unknown) => {
        const [xi, yi, v] = (p as { value: number[] }).value;
        return `${escapeHtml(rows[yi])} / ${escapeHtml(columns[xi])}<br/>${formatChartNumber(v)}`;
      },
    },
    series: [{ type: "heatmap", name: headers[vCol], data }],
  } as Partial<EChartsOption>;
}

/** Colours the heatmap's visualMap from theme tokens (no new token: the user's accent, with an opacity
 *  ramp so it works on both light and dark surfaces) and gives the grid room for it. */
export function applyHeatmapTheme(
  option: EChartsOption,
  themeTokens: ChartThemeTokens,
  textColor: string,
): EChartsOption {
  const visualMap = option.visualMap as Record<string, unknown> | undefined;
  if (!visualMap || Array.isArray(visualMap)) return option;
  return {
    ...option,
    visualMap: {
      ...visualMap,
      // A two-stop ramp (accent at the alpha floor -> full accent) rather than one colour plus an
      // opacity channel: the legend bar then shows the same ramp the cells are painted with.
      // Without an outOfRange colour ECharts paints a grey `inactiveColor` bar UNDER the gradient, so the
      // 0.25-alpha low stop would blend over grey in the legend but over the card in the cells. A
      // transparent layer makes both blend over the same surface.
      outOfRange: { color: ["rgba(0, 0, 0, 0)"] },
      inRange: { color: [withAlpha(themeTokens.accent, HEATMAP_MIN_OPACITY), themeTokens.accent] },
      textStyle: { color: textColor, fontFamily: themeTokens.fontMono },
    },
    grid: {
      ...(option.grid as object),
      bottom: HEATMAP_VISUALMAP_CLEARANCE_PX,
      containLabel: true,
    },
  } as EChartsOption;
}

/** "3" -> "3", "2.5" -> "2.5" (the shared chart number format), as a bin's range label. */
export function histogramBinLabel(start: number, end: number): string {
  return start === end
    ? formatChartNumber(start)
    : `${formatChartNumber(start)} to ${formatChartNumber(end)}`;
}

/** Bins the numeric `xAxis` field (see `binHistogram`) into a bar series on a category axis labelled
 *  with the ranges, bars touching. No `xAxis` mapping, an unknown column or no numeric value -> `{}`. */
export function buildHistogramDataOption(
  rawRows: string[][],
  headers: string[],
  fieldMapping: Record<string, string> | null | undefined,
  histogramOptions?: HistogramChartOptions,
): Partial<EChartsOption> {
  const xCol = columnIndex(headers, fieldMapping?.xAxis);
  if (xCol === -1) return {};
  const { bins } = binHistogram(
    rawRows.map((r) => r[xCol] ?? ""),
    histogramOptions?.binCount,
  );
  if (bins.length === 0) return {};
  return {
    xAxis: { type: "category", data: bins.map((b) => histogramBinLabel(b.start, b.end)) },
    legend: { data: [] },
    series: [{ type: "bar", name: "Count", data: bins.map((b) => b.count), barCategoryGap: 0 }],
  } as Partial<EChartsOption>;
}

/** Compact-mode sizing of the heatmap colour scale (see `COMPACT_AXIS_LABEL_FONT_SIZE`). */
export function compactHeatmapVisualMap(option: EChartsOption, fontSize: number): EChartsOption {
  const visualMap = option.visualMap as Record<string, unknown> | undefined;
  if (!visualMap || Array.isArray(visualMap)) return option;
  return {
    ...option,
    visualMap: {
      ...visualMap,
      itemWidth: HEATMAP_COMPACT_BAR_THICKNESS_PX,
      textStyle: { ...(visualMap.textStyle as object), fontSize },
    },
  } as EChartsOption;
}

/** A heatmap's y axis is a CATEGORY axis of the row values, which the data option carries. The
 *  appearance axis forces `type: "value"` and a number formatter, so keep only its label/name styling
 *  (never its `type` or `formatter`). Any other chart type, or a heatmap with no data, is unchanged. */
export function mergeHeatmapYAxis(
  chartType: string,
  dataOption: Partial<EChartsOption>,
  defaultYAxis: object,
  appearanceYAxis: object,
): object {
  if (chartType !== "heatmap" || !dataOption.yAxis) {
    return { ...defaultYAxis, ...appearanceYAxis };
  }
  const {
    type: _type,
    axisLabel,
    ...rest
  } = appearanceYAxis as {
    type?: string;
    axisLabel?: Record<string, unknown>;
  };
  const { formatter: _formatter, ...labelStyle } = axisLabel ?? {};
  return { ...(dataOption.yAxis as object), ...rest, axisLabel: labelStyle };
}
