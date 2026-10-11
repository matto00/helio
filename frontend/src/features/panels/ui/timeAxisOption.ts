// HEL-1305 — option-level half of the chart time axis: which instants a data option plots, and the
// UTC tooltip that replaces the default (which would print the raw epoch). Lives apart from
// `chartTimeAxis.ts`, which must stay echarts-free; this file may import chart option helpers.

import type { EChartsOption } from "echarts";

import { formatChartTooltipValue } from "../../../utils/chartAppearance";
import { allMidnightUtc, formatChartInstant } from "../../../utils/chartTimeAxis";
import { escapeHtml } from "./heatmapHistogramOptions";

/** ECharts names an unnamed series `series\u00000...`; that auto name must not reach the tooltip. */
const ECHARTS_AUTO_SERIES_NAME_MARK = "\u0000";

interface TimePoint {
  value?: unknown;
}

/** The distinct instants a data option plots on a time x axis, or `null` when its x axis is not one.
 *  Read from the data option (before any overlay) so an overlay can never change the tooltip format. */
export function plottedInstants(dataOption: Partial<EChartsOption>): number[] | null {
  const xAxis = dataOption.xAxis as { type?: string } | undefined;
  if (!xAxis || Array.isArray(xAxis) || xAxis.type !== "time") return null;
  const series = Array.isArray(dataOption.series) ? dataOption.series : [];
  const instants = new Set<number>();
  for (const s of series as Array<{ data?: unknown }>) {
    if (!Array.isArray(s.data)) continue;
    for (const item of s.data as TimePoint[]) {
      const t = Array.isArray(item?.value) ? item.value[0] : undefined;
      if (typeof t === "number") instants.add(t);
    }
  }
  return [...instants];
}

interface TooltipParam {
  value?: unknown;
  seriesName?: string;
  marker?: string;
}

function tooltipRow(p: TooltipParam): string {
  const y = Array.isArray(p.value) ? p.value[1] : undefined;
  const name =
    p.seriesName && !p.seriesName.includes(ECHARTS_AUTO_SERIES_NAME_MARK)
      ? escapeHtml(p.seriesName)
      : "";
  const text = `<b>${escapeHtml(formatChartTooltipValue(y))}</b>`;
  return `${p.marker ?? ""}${name ? `${name}: ` : ""}${text}`;
}

/** Tooltip formatter for a time x axis: the instant in UTC (`yyyy-MM-dd` when every plotted instant is
 *  midnight UTC, else `yyyy-MM-dd HH:mm`) over one row per series. ECharts renders a string formatter
 *  as HTML, so every user-derived string is escaped. */
export function timeAxisTooltipFormatter(instants: readonly number[]) {
  const withTime = !allMidnightUtc(instants);
  return (params: TooltipParam | TooltipParam[]): string => {
    const list = Array.isArray(params) ? params : [params];
    const first = list[0]?.value;
    const t = Array.isArray(first) ? first[0] : undefined;
    const header = typeof t === "number" ? `${formatChartInstant(t, withTime)}<br/>` : "";
    return `${header}${list.map(tooltipRow).join("<br/>")}`;
  };
}

/** Marks the built option as UTC and gives its tooltip the time-axis formatter (ruling 3 and 4). */
export function applyTimeAxisTooltip(
  option: EChartsOption,
  instants: readonly number[],
): EChartsOption {
  return {
    ...option,
    useUTC: true,
    tooltip: { ...(option.tooltip as object), formatter: timeAxisTooltipFormatter(instants) },
  } as EChartsOption;
}
