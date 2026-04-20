import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

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

export interface ChartPanelProps {
  rawRows?: string[][] | null;
  headers?: string[] | null;
  fieldMapping?: Record<string, string> | null;
  chartType?: ChartType;
}

export function ChartPanel({ rawRows, headers, fieldMapping, chartType }: ChartPanelProps = {}) {
  // fieldMapping is present but xAxis or yAxis not set → empty state message
  if (fieldMapping != null) {
    const xField = fieldMapping.xAxis;
    const yField = fieldMapping.yAxis;

    if (!xField || !yField) {
      return (
        <div className="panel-content panel-content--state">
          <span className="panel-content__state-label">Select fields to display chart data</span>
        </div>
      );
    }

    // Build ECharts series from rawRows + headers
    const xIdx = headers ? headers.indexOf(xField) : -1;
    const yIdx = headers ? headers.indexOf(yField) : -1;

    const xData: string[] = [];
    const yData: (number | string)[] = [];

    if (rawRows) {
      for (const row of rawRows) {
        xData.push(xIdx >= 0 ? (row[xIdx] ?? "") : "");
        yData.push(yIdx >= 0 ? (row[yIdx] ?? "") : "");
      }
    }

    const dataOption: EChartsOption = {
      xAxis: {
        type: "category",
        data: xData,
      },
      yAxis: {
        type: "value",
      },
      series: [
        {
          name: yField,
          type: "line",
          data: yData,
        },
      ],
    };

    return (
      <ReactECharts
        option={dataOption}
        autoResize={true}
        style={{ height: "100%", width: "100%" }}
      />
    );
  }

  // fieldMapping is null/undefined → default placeholder chart
  return (
    <ReactECharts
      option={getChartOption(chartType ?? "line")}
      autoResize={true}
      style={{ height: "100%", width: "100%" }}
    />
  );
}
