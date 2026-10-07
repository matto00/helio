import type { ChartAppearance } from "../types/panel";
import { readChartConfig } from "../../pipelines/ui/outputEditor/outputConfigTypes";
import type { ChartType } from "../../../utils/chartAppearance";

const CHART_TYPES: readonly string[] = ["bar", "line", "pie", "scatter"];

/** HEL-1351 design D7 — the ONE chart-type resolver for a dashboard chart panel: the panel's own
 *  stored `appearance.chart.chartType`, else the bound Output's `config.chartType` (what the
 *  editor preview and the History view render), else `line`. Render/click/Inspect all read this,
 *  so what is drawn, what a click maps and what Inspect filters can never disagree. Render-time
 *  only: it never writes the stored appearance. */
export function resolvePanelChartType(
  chart: ChartAppearance | undefined,
  outputConfig: Record<string, unknown>,
): ChartType {
  if (chart?.chartType) return chart.chartType as ChartType;
  const fromOutput = readChartConfig(outputConfig).chartType;
  return CHART_TYPES.includes(fromOutput) ? fromOutput : "line";
}
