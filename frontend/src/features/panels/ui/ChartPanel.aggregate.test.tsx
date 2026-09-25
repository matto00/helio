import { screen } from "@testing-library/react";

import { ChartPanel } from "./ChartPanel";
import { baseAppearance, baseChartConfig, getOption, renderChart } from "./chartPanelTestHelpers";

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(option)} />
  ),
}));
jest.mock("./echartsCore", () => ({ __esModule: true, default: {} }));

describe("ChartPanel — chartAggregate (HEL-292)", () => {
  const chartAggregate = { categories: ["2019", "2020"], values: [3, 6] };

  it("renders the precomputed chartAggregate categories/values directly for a bar chart", () => {
    const appearance = {
      ...baseAppearance,
      chart: { ...baseChartConfig, chartType: "bar" as const },
    };
    renderChart(<ChartPanel appearance={appearance} chartAggregate={chartAggregate} />);
    const option = getOption(screen.getByTestId("echarts")) as {
      xAxis: { data: string[] };
      series: Array<{ type: string; data: number[] }>;
    };
    expect(option.xAxis.data).toEqual(["2019", "2020"]);
    expect(option.series[0].type).toBe("bar");
    expect(option.series[0].data).toEqual([3, 6]);
  });

  it("renders the precomputed chartAggregate for the default (line) chart type", () => {
    renderChart(<ChartPanel chartAggregate={chartAggregate} />);
    const option = getOption(screen.getByTestId("echarts")) as {
      xAxis: { data: string[] };
      series: Array<{ type: string; data: number[] }>;
    };
    expect(option.xAxis.data).toEqual(["2019", "2020"]);
    expect(option.series[0].type).toBe("line");
    expect(option.series[0].data).toEqual([3, 6]);
  });

  it("honors chartAggregate for a pie chart, producing {name,value} slices (HEL-624)", () => {
    const headers = ["category", "sales"];
    const rawRows = [
      ["Apples", "100"],
      ["Bananas", "200"],
    ];
    const fieldMapping = { xAxis: "category", yAxis: "sales" };
    const appearance = {
      ...baseAppearance,
      chart: { ...baseChartConfig, chartType: "pie" as const },
    };
    renderChart(
      <ChartPanel
        appearance={appearance}
        headers={headers}
        rawRows={rawRows}
        fieldMapping={fieldMapping}
        chartAggregate={chartAggregate}
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ type: string; data: Array<{ name: string; value: number }> }>;
    };
    expect(option.series[0].type).toBe("pie");
    // Aggregate categories/values, NOT the per-row rawRows data.
    expect(option.series[0].data).toEqual([
      { name: "2019", value: 3 },
      { name: "2020", value: 6 },
    ]);
  });

  it("ignores chartAggregate for a scatter chart and falls back to the rawRows path", () => {
    const headers = ["x", "y"];
    const rawRows = [
      ["1", "2"],
      ["3", "4"],
    ];
    const fieldMapping = { xAxis: "x", yAxis: "y" };
    const appearance = {
      ...baseAppearance,
      chart: { ...baseChartConfig, chartType: "scatter" as const },
    };
    renderChart(
      <ChartPanel
        appearance={appearance}
        headers={headers}
        rawRows={rawRows}
        fieldMapping={fieldMapping}
        chartAggregate={chartAggregate}
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ type: string; data: Array<[number, number]> }>;
    };
    expect(option.series[0].type).toBe("scatter");
    expect(option.series[0].data).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("falls back to the rawRows path when chartAggregate is absent, even for bar/line", () => {
    const headers = ["date", "price"];
    const rawRows = [
      ["2024-01-01", "100"],
      ["2024-01-02", "200"],
    ];
    const fieldMapping = { xAxis: "date", yAxis: "price" };
    renderChart(<ChartPanel fieldMapping={fieldMapping} headers={headers} rawRows={rawRows} />);
    const option = getOption(screen.getByTestId("echarts")) as { xAxis: { data: string[] } };
    expect(option.xAxis.data).toEqual(["2024-01-01", "2024-01-02"]);
  });
});

describe("ChartPanel — pie chartAggregate (HEL-624)", () => {
  const chartAggregate = { categories: ["Apples", "Bananas", "Cherries"], values: [100, 200, 50] };
  const appearance = {
    ...baseAppearance,
    chart: { ...baseChartConfig, chartType: "pie" as const },
  };

  it("maps aggregate categories/values into {name,value} pie slices", () => {
    renderChart(<ChartPanel appearance={appearance} chartAggregate={chartAggregate} />);
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ type: string; data: Array<{ name: string; value: number }> }>;
    };
    expect(option.series[0].type).toBe("pie");
    expect(option.series[0].data).toEqual([
      { name: "Apples", value: 100 },
      { name: "Bananas", value: 200 },
      { name: "Cherries", value: 50 },
    ]);
  });

  it("does not include xAxis or yAxis keys for an aggregated pie", () => {
    renderChart(<ChartPanel appearance={appearance} chartAggregate={chartAggregate} />);
    const option = getOption(screen.getByTestId("echarts"));
    expect(option.xAxis).toBeUndefined();
    expect(option.yAxis).toBeUndefined();
  });

  it("still applies donut radius and percent-label chartOptions on top of an aggregated pie", () => {
    renderChart(
      <ChartPanel
        appearance={appearance}
        chartAggregate={chartAggregate}
        chartOptions={{ pie: { donutHolePct: 50, showPercentLabels: true } }}
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{
        radius?: string[];
        label?: { show?: boolean; formatter?: string };
        data: Array<{ name: string; value: number }>;
      }>;
    };
    expect(option.series[0].radius).toEqual(["50%", "70%"]);
    expect(option.series[0].label?.show).toBe(true);
    expect(option.series[0].label?.formatter).toContain("{d}");
    expect(option.series[0].data).toEqual([
      { name: "Apples", value: 100 },
      { name: "Bananas", value: 200 },
      { name: "Cherries", value: 50 },
    ]);
  });
});
