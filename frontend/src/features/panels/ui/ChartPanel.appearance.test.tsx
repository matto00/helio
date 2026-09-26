import { screen } from "@testing-library/react";

import { resolveChartTheme } from "../../../utils/chartAppearance";
import { ChartPanel } from "./ChartPanel";
import { baseAppearance, baseChartConfig, getOption, renderChart } from "./chartPanelTestHelpers";

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(option)} />
  ),
}));
jest.mock("./echartsCore", () => ({ __esModule: true, default: {} }));

describe("ChartPanel — appearance", () => {
  it("renders without crashing when appearance has chart config", () => {
    const appearance = {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: {
        seriesColors: ["#ff0000"],
        legend: { show: false, position: "bottom" as const },
        tooltip: { enabled: false },
        axisLabels: {
          x: { show: true, label: "Date" },
          y: { show: true, label: "Price" },
        },
      },
    };
    renderChart(<ChartPanel appearance={appearance} />);
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
  });

  it("applies series colors from appearance", () => {
    const appearance = {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: {
        seriesColors: ["#ff0000", "#00ff00"],
        legend: { show: true, position: "top" as const },
        tooltip: { enabled: true },
        axisLabels: {
          x: { show: true },
          y: { show: true },
        },
      },
    };
    renderChart(<ChartPanel appearance={appearance} />);
    const option = getOption(screen.getByTestId("echarts")) as { color: string[] };
    expect(option.color).toEqual(["#ff0000", "#00ff00"]);
  });

  // F-196 regression: chartAppearance.ts wires `textStyle.fontFamily` onto
  // the option, but ChartPanel's own merge used to overwrite `textStyle`
  // (top-level and legend) with a bare `{ color }` object that dropped it —
  // legend text (and any text falling back to the chart-level default)
  // rendered in ECharts' canvas-default font instead of --font-sans.
  it("keeps chartAppearance's fontFamily on the final option's textStyle and legend.textStyle (bar/line)", () => {
    const appearance = {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: baseChartConfig,
    };
    renderChart(<ChartPanel appearance={appearance} />);
    const option = getOption(screen.getByTestId("echarts")) as {
      textStyle: { fontFamily: string };
      legend: { textStyle: { fontFamily: string } };
    };
    const theme = resolveChartTheme();
    expect(option.textStyle.fontFamily).toBe(theme.fontSans);
    expect(option.legend.textStyle.fontFamily).toBe(theme.fontSans);
  });

  it("keeps chartAppearance's fontFamily on the final option's textStyle and legend.textStyle (pie)", () => {
    const appearance = {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: { ...baseChartConfig, chartType: "pie" as const },
    };
    renderChart(
      <ChartPanel
        appearance={appearance}
        headers={["category", "sales"]}
        rawRows={[
          ["A", "1"],
          ["B", "2"],
        ]}
        fieldMapping={{ xAxis: "category", yAxis: "sales" }}
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      textStyle: { fontFamily: string };
      legend: { textStyle: { fontFamily: string } };
    };
    const theme = resolveChartTheme();
    expect(option.textStyle.fontFamily).toBe(theme.fontSans);
    expect(option.legend.textStyle.fontFamily).toBe(theme.fontSans);
  });
});

describe("ChartPanel — chartOptions (HEL-248)", () => {
  const lineAppearance = {
    ...baseAppearance,
    chart: { ...baseChartConfig, chartType: "line" as const },
  };

  it("applies line smooth / showSymbol / areaStyle from chartOptions.line", () => {
    renderChart(
      <ChartPanel
        appearance={lineAppearance}
        headers={["date", "price"]}
        rawRows={[
          ["2024-01-01", "100"],
          ["2024-01-02", "200"],
        ]}
        fieldMapping={{ xAxis: "date", yAxis: "price" }}
        chartOptions={{ line: { smooth: true, showPoints: false, areaFill: true } }}
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ smooth?: boolean; showSymbol?: boolean; areaStyle?: object }>;
    };
    expect(option.series[0].smooth).toBe(true);
    expect(option.series[0].showSymbol).toBe(false);
    expect(option.series[0].areaStyle).toBeDefined();
  });

  it("does not touch the line render when only an inactive type's options are stored", () => {
    renderChart(
      <ChartPanel
        appearance={lineAppearance}
        headers={["date", "price"]}
        rawRows={[["2024-01-01", "100"]]}
        fieldMapping={{ xAxis: "date", yAxis: "price" }}
        chartOptions={{ pie: { donutHolePct: 50 } }}
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ smooth?: boolean; radius?: unknown }>;
    };
    expect(option.series[0].smooth).toBeUndefined();
    expect(option.series[0].radius).toBeUndefined();
  });

  const barMultiSeries = {
    appearance: { ...baseAppearance, chart: { ...baseChartConfig, chartType: "bar" as const } },
    headers: ["year", "value", "team"],
    rawRows: [
      ["2020", "10", "A"],
      ["2020", "30", "B"],
      ["2021", "20", "A"],
      ["2021", "20", "B"],
    ],
    fieldMapping: { xAxis: "year", yAxis: "value", series: "team" },
  };

  it("stacks every series for stacking=stacked", () => {
    renderChart(<ChartPanel {...barMultiSeries} chartOptions={{ bar: { stacking: "stacked" } }} />);
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ stack?: string }>;
    };
    expect(option.series.length).toBe(2);
    expect(option.series.every((s) => s.stack === "total")).toBe(true);
  });

  it("swaps category to the y-axis for orientation=horizontal", () => {
    renderChart(
      <ChartPanel
        {...barMultiSeries}
        chartOptions={{ bar: { orientation: "horizontal", stacking: "stacked" } }}
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      xAxis: { type?: string };
      yAxis: { type?: string; data?: string[] };
      series: Array<{ stack?: string }>;
    };
    expect(option.yAxis.type).toBe("category");
    expect(option.yAxis.data).toEqual(["2020", "2021"]);
    expect(option.xAxis.type).toBe("value");
    expect(option.series.every((s) => s.stack === "total")).toBe(true);
  });

  it("renders per-category percent shares summing to 100 for stacking=normalized", () => {
    renderChart(
      <ChartPanel {...barMultiSeries} chartOptions={{ bar: { stacking: "normalized" } }} />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      yAxis: { max?: number; axisLabel?: { formatter?: string } };
      series: Array<{ data: number[] }>;
    };
    // 2020: A=10,B=30 → 25 / 75 ; 2021: A=20,B=20 → 50 / 50.
    expect(option.series[0].data).toEqual([25, 50]);
    expect(option.series[1].data).toEqual([75, 50]);
    // Each category index sums to 100 across series.
    for (let i = 0; i < 2; i++) {
      expect(option.series[0].data[i] + option.series[1].data[i]).toBe(100);
    }
    expect(option.yAxis.max).toBe(100);
    expect(option.yAxis.axisLabel?.formatter).toBe("{value}%");
  });

  it("applies group spacing as series.barCategoryGap", () => {
    renderChart(<ChartPanel {...barMultiSeries} chartOptions={{ bar: { barGapPct: 40 } }} />);
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ barCategoryGap?: string }>;
    };
    expect(option.series[0].barCategoryGap).toBe("40%");
  });

  const pieSetup = {
    appearance: { ...baseAppearance, chart: { ...baseChartConfig, chartType: "pie" as const } },
    headers: ["category", "sales"],
    rawRows: [
      ["Apples", "100"],
      ["Bananas", "200"],
    ],
    fieldMapping: { xAxis: "category", yAxis: "sales" },
  };

  it("applies donut radius and percentage-label formatter for pie", () => {
    renderChart(
      <ChartPanel
        {...pieSetup}
        chartOptions={{ pie: { donutHolePct: 50, showPercentLabels: true } }}
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ radius?: string[]; label?: { show?: boolean; formatter?: string } }>;
    };
    expect(option.series[0].radius).toEqual(["50%", "70%"]);
    expect(option.series[0].label?.show).toBe(true);
    expect(option.series[0].label?.formatter).toContain("{d}");
  });

  const scatterSetup = {
    appearance: { ...baseAppearance, chart: { ...baseChartConfig, chartType: "scatter" as const } },
    headers: ["x", "y", "population", "region"],
    rawRows: [
      ["1", "2", "100", "west"],
      ["3", "4", "200", "east"],
      ["5", "6", "300", "west"],
    ],
    fieldMapping: { xAxis: "x", yAxis: "y" },
  };

  it("adds a third size dimension for scatter sizeField", () => {
    renderChart(
      <ChartPanel {...scatterSetup} chartOptions={{ scatter: { sizeField: "population" } }} />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ data: number[][] }>;
    };
    expect(option.series[0].data[0]).toEqual([1, 2, 100]);
  });

  it("groups scatter rows into one series per distinct colorField value", () => {
    renderChart(
      <ChartPanel {...scatterSetup} chartOptions={{ scatter: { colorField: "region" } }} />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ name?: string; data: number[][] }>;
      legend?: { data?: string[] };
    };
    expect(option.series.map((s) => s.name)).toEqual(["west", "east"]);
    // west has two rows, east has one.
    expect(option.series[0].data).toEqual([
      [1, 2],
      [5, 6],
    ]);
    expect(option.series[1].data).toEqual([[3, 4]]);
  });
});
