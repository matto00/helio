import type { EChartsOption } from "echarts";

import {
  COMPACT_GRID_INSET_PX,
  COMPACT_LABEL_LINE_BOX_PX,
  COMPACT_X_LABEL_BAND_PX,
} from "./compactChartMetrics";
import { CHART_COMPACT_HEIGHT_PX } from "./useChartCompact";

/** ECharts' default value-axis split count; a cap at or above it changes nothing. */
const DEFAULT_SPLIT_NUMBER = 5;

/** HEL-1444 -- the most value-axis splits whose labels fit a measured compact canvas without
 *  overprinting, or `undefined` when ECharts' default split count already fits (a canvas of 180px
 *  or more, an unmeasured one, or a compact one tall enough for five splits). The plot area is the
 *  canvas minus the compact grid insets and the x-axis label band; one split (the axis minimum and
 *  maximum) is the floor, and any label still overlapping is dropped by `hideOverlap`. */
export function valueAxisSplitCap(measuredHeight: number): number | undefined {
  if (!(measuredHeight > 0) || measuredHeight > CHART_COMPACT_HEIGHT_PX) return undefined;
  const plotHeight = measuredHeight - 2 * COMPACT_GRID_INSET_PX - COMPACT_X_LABEL_BAND_PX;
  const cap = Math.max(1, Math.floor(plotHeight / COMPACT_LABEL_LINE_BOX_PX));
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
      axisLabel: {
        ...yAxis.axisLabel,
        hideOverlap: true,
        showMinLabel: true,
        showMaxLabel: true,
        // zrender sizes a label's overlap box from its text ink (~6px for 10px text), so
        // `hideOverlap` lets labels one ink-height apart through (HEL-1444 cycle 2: "60/30/0" at a
        // 7.5px pitch). A line height of one line box makes the box the real one.
        lineHeight: COMPACT_LABEL_LINE_BOX_PX,
      },
    } as EChartsOption["yAxis"],
  };
}
