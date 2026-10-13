import type { EChartsOption } from "echarts";

import { COMPACT_AXIS_LABEL_FONT_SIZE, COMPACT_GRID_INSET_PX } from "./buildChartOption";
import { CHART_COMPACT_HEIGHT_PX } from "./useChartCompact";

/** ECharts' default value-axis split count; a cap at or above it changes nothing. */
const DEFAULT_SPLIT_NUMBER = 5;

/** Vertical room one value-axis label needs: the compact font's line box (1.2 x its size).
 *  Read lazily: this module and `buildChartOption` import each other. */
const labelPitchPx = () => Math.ceil(COMPACT_AXIS_LABEL_FONT_SIZE * 1.2);

/** The band the compact x-axis labels take under the plot: label line box plus the gap to the axis
 *  (measured at 17px with a 10px font; `containLabel` reserves it inside the canvas). */
const X_LABEL_BAND_PX = 17;

/** HEL-1444 -- the most value-axis splits whose labels fit a measured compact canvas without
 *  overprinting, or `undefined` when ECharts' default split count already fits (a canvas of 180px
 *  or more, an unmeasured one, or a compact one tall enough for five splits). The plot area is the
 *  canvas minus the compact grid insets and the x-axis label band; one split (the axis minimum and
 *  maximum) is the floor, and any label still overlapping is dropped by `hideOverlap`. */
export function valueAxisSplitCap(measuredHeight: number): number | undefined {
  if (!(measuredHeight > 0) || measuredHeight > CHART_COMPACT_HEIGHT_PX) return undefined;
  const plotHeight = measuredHeight - 2 * COMPACT_GRID_INSET_PX - X_LABEL_BAND_PX;
  const cap = Math.max(1, Math.floor(plotHeight / labelPitchPx()));
  return cap < DEFAULT_SPLIT_NUMBER ? cap : undefined;
}

/** Applies the cap to a built option's value-type y axis: `splitNumber`, `hideOverlap` and
 *  `showMinLabel` / `showMaxLabel`. `splitNumber` is only a hint (ECharts rounds the interval to a
 *  nice number), so labels still drawn too close are dropped by `hideOverlap`, and
 *  `showMin/MaxLabel: true` makes a crowded neighbour yield to the axis minimum and maximum, not
 *  the other way round. A category y axis (horizontal bar, heatmap) and an absent cap leave the
 *  option as it was. */
export function applyValueAxisSplitCap(built: EChartsOption, cap: number | undefined) {
  const yAxis = built.yAxis as { type?: string; axisLabel?: object } | undefined;
  if (cap === undefined || yAxis?.type !== "value") return built;
  return {
    ...built,
    yAxis: {
      ...yAxis,
      splitNumber: cap,
      axisLabel: { ...yAxis.axisLabel, hideOverlap: true, showMinLabel: true, showMaxLabel: true },
    } as EChartsOption["yAxis"],
  };
}
