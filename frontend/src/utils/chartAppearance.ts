import type { EChartsOption } from "echarts";

import type { ChartAppearance } from "../types/models";

export type ChartType = "bar" | "line" | "pie" | "scatter";

export interface AppearanceResult {
  option: EChartsOption;
  chartType: ChartType;
}

function legendPositionProps(position: string): Record<string, unknown> {
  switch (position) {
    case "top":
      return { orient: "horizontal", top: 0, left: "center" };
    case "bottom":
      return { orient: "horizontal", bottom: 0, left: "center" };
    case "left":
      return { orient: "vertical", left: 0, top: "middle" };
    case "right":
      return { orient: "vertical", right: 0, top: "middle" };
    default:
      return { orient: "horizontal", top: 0, left: "center" };
  }
}

export function appearanceToEChartsOption(chart: ChartAppearance): AppearanceResult {
  const chartType: ChartType = (chart.chartType as ChartType) ?? "line";
  const option: EChartsOption = {
    legend: {
      show: chart.legend.show,
      ...legendPositionProps(chart.legend.position),
    },
    tooltip: {
      show: chart.tooltip.enabled,
    },
    xAxis: {
      type: "category",
      name: chart.axisLabels.x.label ?? "",
      axisLabel: { show: chart.axisLabels.x.show },
    },
    yAxis: {
      type: "value",
      name: chart.axisLabels.y.label ?? "",
      axisLabel: { show: chart.axisLabels.y.show },
    },
  };
  if (chart.seriesColors.length > 0) {
    option.color = chart.seriesColors;
  }
  return { option, chartType };
}
