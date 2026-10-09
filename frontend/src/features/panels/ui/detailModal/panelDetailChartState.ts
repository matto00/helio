import { defaultChartAppearance } from "../../../../theme/appearance";
import type { ChartAppearance, Panel } from "../../types/panel";

function padSeriesColors(colors: string[]): string[] {
  const defaults = defaultChartAppearance.seriesColors;
  const padded = [...colors];
  while (padded.length < 8) {
    padded.push(defaults[padded.length]);
  }
  return padded.slice(0, 8);
}

export function buildInitialChart(panel: Panel): ChartAppearance {
  // HEL-1378 -- no default `chartType`: a panel that stores none must stay unset so the bound
  // Output's chartType still applies (a seeded "line" would be saved back and outrank it).
  const { chartType: _defaultChartType, ...defaultsWithoutType } = defaultChartAppearance;
  return {
    ...defaultsWithoutType,
    ...(panel.appearance.chart ?? {}),
    seriesColors: padSeriesColors(panel.appearance.chart?.seriesColors ?? []),
    legend: panel.appearance.chart?.legend ?? defaultChartAppearance.legend,
    tooltip: panel.appearance.chart?.tooltip ?? defaultChartAppearance.tooltip,
    axisLabels: panel.appearance.chart?.axisLabels ?? defaultChartAppearance.axisLabels,
  };
}
