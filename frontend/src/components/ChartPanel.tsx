import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

const defaultOption: EChartsOption = {
  legend: {
    data: ["Chart"],
  },
  xAxis: {
    type: "category",
    name: "X Axis",
    data: [],
  },
  yAxis: {
    type: "value",
    name: "Y Axis",
  },
  series: [],
};

export function ChartPanel() {
  return (
    <ReactECharts
      option={defaultOption}
      autoResize={true}
      style={{ height: "100%", width: "100%" }}
    />
  );
}
