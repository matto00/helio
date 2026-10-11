/**
 * The MCP surface's single chart-type set (HEL-1311). `proposal.ts` builds its `chartType` enum
 * from it and `outputs.ts` renders its prose list from it. `chartTypes.guard.test.ts` pins it to
 * the backend `ChartTypes.All` set via every `schemas/**` chartType enum.
 */
export const CHART_TYPES = ["bar", "line", "pie", "scatter", "heatmap", "histogram"] as const;

export type McpChartType = (typeof CHART_TYPES)[number];

/** "bar|line|pie|..." for tool descriptions. */
export const CHART_TYPES_PIPE_LIST: string = CHART_TYPES.join("|");
