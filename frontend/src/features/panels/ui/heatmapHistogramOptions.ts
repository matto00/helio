// HEL-1311 — data options and theming for the `heatmap` and `histogram` chart types, split out of
// `chartDataOptions.ts` to keep that file inside the size budget. Both branches check
// `fieldMapping` slots explicitly and never use `resolveDataColumns`' column-0 fallback: an unmapped
// slot renders an empty chart rather than a guessed one.

import type { EChartsOption } from "echarts";

import type { HistogramChartOptions } from "../types/panel";
import { binHistogram, type HistogramBin } from "../../../utils/histogramBins";
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

/** `interval: 0` turns off ECharts' automatic every-other-label skipping on a category axis, so every
 *  label is laid out; `hideOverlap` then drops only labels that would collide on a narrow chart. It
 *  must be applied where `buildChartOption` rebuilds `axisLabel`: one set on the data option is dropped. */
const CATEGORY_LABEL_SHOW_ALL = { interval: 0, hideOverlap: true } as const;

/** ECharts' default axis-label font size, used when the appearance sets none. */
const CATEGORY_LABEL_DEFAULT_FONT_SIZE = 12;

/** The label text's real height with a little leading. ECharts sizes each label's collision box from a
 *  line height it MEASURES on the glyph '国'; with no CJK font installed that glyph falls back to a
 *  half-width one (about 0.6em), so the boxes come out too short and `hideOverlap` hides nothing
 *  (stacked heatmap row labels at 375px). An explicit font-size-based `lineHeight` avoids the probe. */
export function categoryLabelLineHeight(fontSize: number): number {
  return Math.ceil(fontSize * 1.2);
}

/** `CATEGORY_LABEL_SHOW_ALL` plus the explicit line height for `fontSize`. */
export function categoryLabelShowAll(fontSize: number) {
  return { ...CATEGORY_LABEL_SHOW_ALL, lineHeight: categoryLabelLineHeight(fontSize) };
}

/** Horizontal `textMargin` per px of label font size on a show-all X axis. ECharts widens each label's
 *  collision box by the margin on BOTH sides, so it hides a label whose free gap to a neighbour is under
 *  2 x margin: 0.6 em of margin keeps shown labels at least about 1.2 em apart (14.4 px at 12 px, 12 px at the
 *  10 px compact font). With no margin a bin range such as "133 to 148" runs into its neighbour; a fixed 8 px
 *  re-thinned the 375 px heatmap day axis (4 of 7), so the margin follows the font. */
const CATEGORY_X_LABEL_MARGIN_PER_PX_FONT = 0.6;

/** Horizontal margin only (vertical component 0); the heatmap row (y) axis stacks its labels and gets none. */
export function categoryXLabelMargin(fontSize: number): [number, number] {
  return [0, fontSize * CATEGORY_X_LABEL_MARGIN_PER_PX_FONT];
}

/** The font size an axis' `axisLabel` carries (ECharts' default when it sets none). */
export function fontSizeOf(axis: unknown): number {
  const size = (axis as { axisLabel?: { fontSize?: unknown } } | undefined)?.axisLabel?.fontSize;
  return typeof size === "number" ? size : CATEGORY_LABEL_DEFAULT_FONT_SIZE;
}

/** `categoryLabelShowAll` for a show-all X axis: also keeps neighbouring labels visibly apart. */
export function categoryXLabelShowAll(fontSize: number) {
  return { ...categoryLabelShowAll(fontSize), textMargin: categoryXLabelMargin(fontSize) };
}

/** The chart types whose category axes show every label that fits (heatmap: both axes; histogram: x). */
export function showsEveryCategoryLabel(chartType: string): boolean {
  return chartType === "heatmap" || chartType === "histogram";
}

export function escapeHtml(text: string): string {
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

/** `Intl.NumberFormat`'s ceiling for `maximumFractionDigits`. */
const MAX_BIN_LABEL_DECIMALS = 20;

/** One decimal count for every edge of a multi-bin histogram: the fewest places at which each edge
 *  reads exactly (within a millionth of a bin width), never more than one place past the width's
 *  first significant decimal, so adjacent labels stay distinct. */
function binLabelDecimals(bins: readonly HistogramBin[]): number {
  const width = (bins[bins.length - 1].end - bins[0].start) / bins.length;
  if (!(width > 0)) return MAX_BIN_LABEL_DECIMALS;
  const cap = Math.min(MAX_BIN_LABEL_DECIMALS, Math.max(0, 1 - Math.floor(Math.log10(width))));
  const tolerance = width * 1e-6;
  const edges = [bins[0].start, ...bins.map((b) => b.end)];
  for (let d = 0; d < cap; d += 1) {
    const scale = 10 ** d;
    if (edges.every((e) => Math.abs(Math.round(e * scale) / scale - e) <= tolerance)) return d;
  }
  return cap;
}

/** Range labels ("a to b") for the bins, all with the same number of decimal places. A single bin keeps
 *  the shared chart number format (no precision rule: it has no neighbour to match or tell apart). */
export function histogramBinLabels(bins: readonly HistogramBin[]): string[] {
  if (bins.length === 1) {
    const { start, end } = bins[0];
    return [
      start === end
        ? formatChartNumber(start)
        : `${formatChartNumber(start)} to ${formatChartNumber(end)}`,
    ];
  }
  const d = binLabelDecimals(bins);
  const format = new Intl.NumberFormat(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
    useGrouping: false,
  });
  // Rounding first keeps a float residue such as -1.39e-17 from printing as "-0.0".
  const edge = (value: number): string => {
    const rounded = Number(value.toFixed(d));
    return format.format(rounded === 0 ? 0 : rounded);
  };
  return bins.map((b) =>
    b.start === b.end ? edge(b.start) : `${edge(b.start)} to ${edge(b.end)}`,
  );
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
    xAxis: { type: "category", data: histogramBinLabels(bins) },
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
