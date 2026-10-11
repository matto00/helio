/** HEL-1311 — the ONE frontend chart-type set. `chartTypes.guard.test.ts` pins it to the backend
 *  `ChartTypes.All`, the MCP const and every `schemas/**` enum. */
export const CHART_TYPES = ["bar", "line", "pie", "scatter", "heatmap", "histogram"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** Chart types that never aggregate (the server rejects a non-null `aggregation` on them). Mirrors the
 *  backend `ChartTypes.NonAggregating`. */
export const NON_AGGREGATING_CHART_TYPES: readonly ChartType[] = [
  "scatter",
  "heatmap",
  "histogram",
];

export function isNonAggregatingChartType(chartType: unknown): boolean {
  return NON_AGGREGATING_CHART_TYPES.includes(chartType as ChartType);
}

/** Whether a click on a plotted element can select anything. A heatmap cell / histogram bar cannot
 *  (cell and bin selection is a follow-up). */
export function isSelectableChartType(chartType: unknown): boolean {
  return chartType !== "heatmap" && chartType !== "histogram";
}

export function isChartType(value: unknown): value is ChartType {
  return CHART_TYPES.includes(value as ChartType);
}
