import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

import type { PanelAppearance } from "../types/models";

export type ChartType = "line" | "bar" | "pie" | "scatter";

const PLACEHOLDER_CATEGORIES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
const PLACEHOLDER_VALUES = [120, 200, 150, 80, 170, 110];

export function getChartOption(chartType: ChartType = "line"): EChartsOption {
  if (chartType === "pie") {
    return {
      legend: {
        data: ["Chart"],
      },
      series: [
        {
          type: "pie",
          data: PLACEHOLDER_CATEGORIES.map((name, i) => ({
            name,
            value: PLACEHOLDER_VALUES[i],
          })),
        },
      ],
    };
  }

  return {
    legend: {
      data: ["Chart"],
    },
    xAxis: {
      type: "category",
      name: "X Axis",
      data: PLACEHOLDER_CATEGORIES,
    },
    yAxis: {
      type: "value",
      name: "Y Axis",
    },
    series: [
      {
        type: chartType,
        data: PLACEHOLDER_VALUES,
      },
    ],
  };
}

interface ChartPanelProps {
  appearance?: PanelAppearance;
}

export function ChartPanel({ appearance }: ChartPanelProps = {}) {
  const chartType: ChartType = appearance?.chartType ?? "line";
  return (
    <ReactECharts
      option={getChartOption(chartType)}
      autoResize={true}
      style={{ height: "100%", width: "100%" }}
    />
  );
}
