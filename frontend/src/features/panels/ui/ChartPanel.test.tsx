import type { ReactElement } from "react";
import { act, render, screen } from "@testing-library/react";

import { ThemeProvider, useTheme } from "../../../theme/ThemeProvider";
import * as chartAppearance from "../../../utils/chartAppearance";
import { resolveChartTheme } from "../../../utils/chartAppearance";
import { ChartPanel } from "./ChartPanel";

// F-022 — `ChartPanel` renders via `echarts-for-react/lib/core` (tree-shaken
// `echarts/core` registration) rather than the default `echarts-for-react`
// export; mock the `/core` entry it actually imports. `echartsCore.ts` (the
// module that does the real `echarts/core` + chart-type/component `.use()`
// registration) is mocked too — it's a ship-time bundle-size concern only,
// irrelevant to the option-assembly behavior under test here, and its real
// implementation pulls in `echarts`'s ESM-only subpath exports, which this
// project's CommonJS Jest transform doesn't handle.
jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(option)} />
  ),
}));
jest.mock("./echartsCore", () => ({ __esModule: true, default: {} }));

function getOption(el: HTMLElement) {
  return JSON.parse(el.getAttribute("data-option") ?? "{}") as Record<string, unknown>;
}

// `ChartPanel` reads `useTheme()` (F-024/F-025 — a theme flip must recompute
// its ECharts option, see the component's own comment), which throws outside
// a `ThemeProvider`. Every render in this file goes through here rather than
// `@testing-library/react`'s bare `render` — no Redux/router dependency, so
// the shared `renderWithStore` test helper (which pulls both in) would be
// more than this file needs.
function renderChart(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

describe("ChartPanel \u2014 no data", () => {
  it("renders an ECharts instance with default option", () => {
    renderChart(<ChartPanel />);
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
  });

  it("renders when fieldMapping is null", () => {
    renderChart(<ChartPanel fieldMapping={null} />);
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
  });
});

describe("ChartPanel \u2014 mapped xAxis and yAxis", () => {
  const headers = ["date", "price"];
  const rawRows = [
    ["2024-01-01", "100"],
    ["2024-01-02", "200"],
    ["2024-01-03", "150"],
  ];
  const fieldMapping = { xAxis: "date", yAxis: "price" };

  it("renders an ECharts instance", () => {
    renderChart(<ChartPanel fieldMapping={fieldMapping} headers={headers} rawRows={rawRows} />);
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
  });

  it("sets xAxis categories from the mapped column", () => {
    renderChart(<ChartPanel fieldMapping={fieldMapping} headers={headers} rawRows={rawRows} />);
    const option = getOption(screen.getByTestId("echarts")) as { xAxis: { data: string[] } };
    expect(option.xAxis.data).toEqual(["2024-01-01", "2024-01-02", "2024-01-03"]);
  });

  it("uses the yAxis field name as the series label", () => {
    renderChart(<ChartPanel fieldMapping={fieldMapping} headers={headers} rawRows={rawRows} />);
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ name: string }>;
    };
    expect(option.series[0].name).toBe("price");
  });

  it("includes all rows in the series", () => {
    renderChart(<ChartPanel fieldMapping={fieldMapping} headers={headers} rawRows={rawRows} />);
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ data: unknown[] }>;
    };
    expect(option.series[0].data).toHaveLength(rawRows.length);
  });
});

describe("ChartPanel \u2014 auto-detect numeric columns", () => {
  it("uses first column as x-axis when no fieldMapping", () => {
    const headers = ["label", "value"];
    const rawRows = [
      ["A", "10"],
      ["B", "20"],
    ];
    renderChart(<ChartPanel headers={headers} rawRows={rawRows} />);
    const option = getOption(screen.getByTestId("echarts")) as { xAxis: { data: string[] } };
    expect(option.xAxis.data).toEqual(["A", "B"]);
  });

  it("renders default chart when no numeric columns exist", () => {
    const headers = ["a", "b"];
    const rawRows = [["foo", "bar"]];
    renderChart(<ChartPanel headers={headers} rawRows={rawRows} />);
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
  });
});

describe("ChartPanel \u2014 appearance", () => {
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

const baseAppearance = {
  background: "transparent",
  color: "inherit",
  transparency: 0,
};

const baseChartConfig = {
  seriesColors: [],
  legend: { show: true, position: "top" as const },
  tooltip: { enabled: true },
  axisLabels: {
    x: { show: true, label: "X" },
    y: { show: true, label: "Y" },
  },
};

describe("ChartPanel \u2014 pie chart", () => {
  const headers = ["category", "sales"];
  const rawRows = [
    ["Apples", "100"],
    ["Bananas", "200"],
    ["Cherries", "50"],
  ];
  const fieldMapping = { xAxis: "category", yAxis: "sales" };
  const appearance = {
    ...baseAppearance,
    chart: { ...baseChartConfig, chartType: "pie" as const },
  };

  it("produces pie series with {name, value} data shape", () => {
    renderChart(
      <ChartPanel
        appearance={appearance}
        headers={headers}
        rawRows={rawRows}
        fieldMapping={fieldMapping}
      />,
    );
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

  it("does not include xAxis or yAxis keys when chartType is pie", () => {
    renderChart(
      <ChartPanel
        appearance={appearance}
        headers={headers}
        rawRows={rawRows}
        fieldMapping={fieldMapping}
      />,
    );
    const option = getOption(screen.getByTestId("echarts"));
    expect(option.xAxis).toBeUndefined();
    expect(option.yAxis).toBeUndefined();
  });
});

describe("ChartPanel \u2014 chartAggregate (HEL-292)", () => {
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

describe("ChartPanel \u2014 pie chartAggregate (HEL-624)", () => {
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

describe("ChartPanel \u2014 compact (HEL-301, phone stack)", () => {
  it("hides the legend when compact is true", () => {
    const appearance = {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: { ...baseChartConfig, legend: { show: true, position: "top" as const } },
    };
    renderChart(<ChartPanel appearance={appearance} compact />);
    const option = getOption(screen.getByTestId("echarts")) as { legend: { show: boolean } };
    expect(option.legend.show).toBe(false);
  });

  it("does not hide the legend when compact is omitted (desktop default)", () => {
    const appearance = {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: { ...baseChartConfig, legend: { show: true, position: "top" as const } },
    };
    renderChart(<ChartPanel appearance={appearance} />);
    const option = getOption(screen.getByTestId("echarts")) as { legend: { show: boolean } };
    expect(option.legend.show).toBe(true);
  });

  it("shrinks axis label font size when compact is true", () => {
    const headers = ["date", "price"];
    const rawRows = [["2024-01-01", "100"]];
    renderChart(
      <ChartPanel
        fieldMapping={{ xAxis: "date", yAxis: "price" }}
        headers={headers}
        rawRows={rawRows}
        compact
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      xAxis: { axisLabel: { fontSize: number } };
    };
    expect(option.xAxis.axisLabel.fontSize).toBe(10);
  });

  it("does not add axis overrides for a pie chart when compact is true", () => {
    const appearance = {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: { ...baseChartConfig, chartType: "pie" as const },
    };
    renderChart(<ChartPanel appearance={appearance} compact />);
    const option = getOption(screen.getByTestId("echarts"));
    expect(option.xAxis).toBeUndefined();
    expect(option.yAxis).toBeUndefined();
  });
});

describe("ChartPanel \u2014 scatter chart", () => {
  const headers = ["x", "y"];
  const rawRows = [
    ["1", "2"],
    ["3", "4"],
    ["5", "6"],
  ];
  const fieldMapping = { xAxis: "x", yAxis: "y" };
  const appearance = {
    ...baseAppearance,
    chart: { ...baseChartConfig, chartType: "scatter" as const },
  };

  it("produces scatter series with [[x,y]] coordinate pairs", () => {
    renderChart(
      <ChartPanel
        appearance={appearance}
        headers={headers}
        rawRows={rawRows}
        fieldMapping={fieldMapping}
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ type: string; data: Array<[number, number]> }>;
    };
    expect(option.series[0].type).toBe("scatter");
    expect(option.series[0].data).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
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

// F-027 — pie + an unmapped/empty fieldMapping used to fall through to the
// generic "auto-detect numeric columns" branch, which builds a cartesian
// `{xAxis, series:[{type:'pie', data:number[]}]}` shape: an orphaned
// category xAxis with no matching grid (crashes ECharts' axis builder) and
// the wrong data shape for pie besides. Live repro: HEL-248 Chart Config
// Eval / "Skeptic Pie Agg Test" (config.fieldMapping: {}).
describe("ChartPanel — pie with unmapped fieldMapping (F-027 regression)", () => {
  const headers = ["category", "sales"];
  const rawRows = [
    ["Apples", "100"],
    ["Bananas", "200"],
  ];
  const appearance = {
    ...baseAppearance,
    chart: { ...baseChartConfig, chartType: "pie" as const },
  };

  it("auto-detects the first numeric column and builds {name,value} pie slices instead of crashing", () => {
    renderChart(
      <ChartPanel appearance={appearance} headers={headers} rawRows={rawRows} fieldMapping={{}} />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ type: string; data: Array<{ name: string; value: number }> }>;
      xAxis?: unknown;
    };
    expect(option.series[0].type).toBe("pie");
    expect(option.series[0].data).toEqual([
      { name: "Apples", value: 100 },
      { name: "Bananas", value: 200 },
    ]);
    // Never an orphaned cartesian xAxis alongside a pie series.
    expect(option.xAxis).toBeUndefined();
  });

  it("also auto-detects when fieldMapping is undefined entirely", () => {
    renderChart(<ChartPanel appearance={appearance} headers={headers} rawRows={rawRows} />);
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ type: string; data: Array<{ name: string; value: number }> }>;
    };
    expect(option.series[0].data).toEqual([
      { name: "Apples", value: 100 },
      { name: "Bananas", value: 200 },
    ]);
  });

  it("renders without a series when no column is numeric, rather than crashing", () => {
    renderChart(
      <ChartPanel
        appearance={appearance}
        headers={["a", "b"]}
        rawRows={[["foo", "bar"]]}
        fieldMapping={{}}
      />,
    );
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
  });
});

// F-028 — the mobile phone stack squashed the chart's plotted data into a
// near-invisible sliver: `compact` shrank the axisLabel font but the grid
// still used ECharts' own default percentage-based margins, which consumed
// nearly the whole ~140px-tall mobile canvas.
describe("ChartPanel — compact grid sizing (F-028 regression)", () => {
  it("gives the grid an explicit small inset with containLabel in compact mode", () => {
    renderChart(
      <ChartPanel
        fieldMapping={{ xAxis: "date", yAxis: "price" }}
        headers={["date", "price"]}
        rawRows={[["2024-01-01", "100"]]}
        compact
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      grid?: {
        top?: number;
        right?: number;
        bottom?: number;
        left?: number;
        containLabel?: boolean;
      };
    };
    expect(option.grid).toMatchObject({ containLabel: true });
    expect(option.grid?.top).toBeLessThanOrEqual(12);
    expect(option.grid?.right).toBeLessThanOrEqual(12);
    expect(option.grid?.bottom).toBeLessThanOrEqual(12);
    expect(option.grid?.left).toBeLessThanOrEqual(12);
  });

  it("shrinks the axis name font size, not only the tick label font size", () => {
    const appearance = {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: {
        ...baseChartConfig,
        axisLabels: { x: { show: true, label: "Date" }, y: { show: true, label: "Price" } },
      },
    };
    renderChart(
      <ChartPanel
        appearance={appearance}
        fieldMapping={{ xAxis: "date", yAxis: "price" }}
        headers={["date", "price"]}
        rawRows={[["2024-01-01", "100"]]}
        compact
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      xAxis: { nameTextStyle?: { fontSize?: number } };
      yAxis: { nameTextStyle?: { fontSize?: number } };
    };
    expect(option.xAxis.nameTextStyle?.fontSize).toBe(10);
    expect(option.yAxis.nameTextStyle?.fontSize).toBe(10);
  });

  it("does not add a grid override for a pie chart in compact mode", () => {
    const appearance = {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: { ...baseChartConfig, chartType: "pie" as const },
    };
    renderChart(<ChartPanel appearance={appearance} compact />);
    const option = getOption(screen.getByTestId("echarts")) as { grid?: unknown };
    expect(option.grid).toBeUndefined();
  });
});

// F-094/F-026 — `compact` used to be wired only from the mobile-stack-only
// boolean (`MobilePanelStack.tsx` passes it unconditionally). A short chart
// on the *desktop* grid never got any density relief, which is how a normal
// panel-card-sized pie chart's legend collided with its own outer data
// labels (F-026, "Mobile Title Test" panel, HEL-248 Chart Config Eval).
// `ChartPanel` now also measures its own wrapper via `ResizeObserver` and
// applies the same compact treatment once the box gets short enough,
// without needing the prop threaded in.
describe("ChartPanel — measured compact from ResizeObserver (F-094/F-026)", () => {
  type ObserverCallback = (entries: Array<{ contentRect: { height: number } }>) => void;
  let observerCallback: ObserverCallback | null = null;
  const originalResizeObserver = (global as { ResizeObserver?: unknown }).ResizeObserver;

  beforeEach(() => {
    observerCallback = null;
    class FakeResizeObserver {
      constructor(cb: ObserverCallback) {
        observerCallback = cb;
      }
      observe() {
        /* no-op: the test triggers `observerCallback` manually */
      }
      disconnect() {}
    }
    (global as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
  });

  afterEach(() => {
    (global as { ResizeObserver?: unknown }).ResizeObserver = originalResizeObserver;
  });

  const appearance = {
    background: "transparent",
    color: "inherit",
    transparency: 0,
    chart: { ...baseChartConfig, legend: { show: true, position: "top" as const } },
  };

  it("hides the legend once the measured wrapper height drops to/below the compact threshold", () => {
    renderChart(<ChartPanel appearance={appearance} />);
    expect(getOption(screen.getByTestId("echarts"))).toMatchObject({ legend: { show: true } });

    act(() => {
      observerCallback?.([{ contentRect: { height: 150 } }]);
    });

    expect(getOption(screen.getByTestId("echarts"))).toMatchObject({ legend: { show: false } });
  });

  it("leaves the legend alone when the measured height is above the compact threshold", () => {
    renderChart(<ChartPanel appearance={appearance} />);

    act(() => {
      observerCallback?.([{ contentRect: { height: 400 } }]);
    });

    expect(getOption(screen.getByTestId("echarts"))).toMatchObject({ legend: { show: true } });
  });

  it("stays compact when the explicit `compact` prop is true regardless of measured size", () => {
    renderChart(<ChartPanel appearance={appearance} compact />);

    act(() => {
      observerCallback?.([{ contentRect: { height: 400 } }]);
    });

    expect(getOption(screen.getByTestId("echarts"))).toMatchObject({ legend: { show: false } });
  });

  // F-026's own threshold is higher than the generic compact one: a pie's
  // outer data-labels collide with a top/bottom legend at heights well above
  // where a cartesian chart's axis labels start getting cramped (live-repro'd
  // at ~198px and ~227px canvas height on default-sized, `h: 4`, panels).
  it("hides a pie chart's legend at a measured height above the generic compact threshold but below the pie-specific one", () => {
    const pieAppearance = {
      ...appearance,
      chart: { ...appearance.chart, chartType: "pie" as const },
    };
    renderChart(<ChartPanel appearance={pieAppearance} />);
    expect(getOption(screen.getByTestId("echarts"))).toMatchObject({ legend: { show: true } });

    act(() => {
      // Above CHART_COMPACT_HEIGHT_PX (179) but at/below PIE_LEGEND_HIDE_HEIGHT_PX (250).
      observerCallback?.([{ contentRect: { height: 220 } }]);
    });

    expect(getOption(screen.getByTestId("echarts"))).toMatchObject({ legend: { show: false } });
  });

  it("leaves a non-pie chart's legend alone at that same in-between height", () => {
    renderChart(<ChartPanel appearance={appearance} />);

    act(() => {
      observerCallback?.([{ contentRect: { height: 220 } }]);
    });

    expect(getOption(screen.getByTestId("echarts"))).toMatchObject({ legend: { show: true } });
  });

  it("leaves a pie chart's legend alone once the measured height clears the pie-specific threshold", () => {
    const pieAppearance = {
      ...appearance,
      chart: { ...appearance.chart, chartType: "pie" as const },
    };
    renderChart(<ChartPanel appearance={pieAppearance} />);

    act(() => {
      observerCallback?.([{ contentRect: { height: 300 } }]);
    });

    expect(getOption(screen.getByTestId("echarts"))).toMatchObject({ legend: { show: true } });
  });
});

// HEL-566 — tooltip shadow/radius/mono-value-font, axis-trigger multi-series
// tooltip, and hover emphasis, wired end-to-end through ChartPanel.
describe("ChartPanel — tooltip and hover emphasis (HEL-566)", () => {
  const barMultiSeries = {
    appearance: { ...baseAppearance, chart: { ...baseChartConfig, chartType: "bar" as const } },
    headers: ["year", "value", "team"],
    rawRows: [
      ["2020", "10", "A"],
      ["2020", "30", "B"],
    ],
    fieldMapping: { xAxis: "year", yAxis: "value", series: "team" },
  };

  it("carries the tooltip's shadow/radius (extraCssText) and mono value font", () => {
    renderChart(
      <ChartPanel
        appearance={{ ...baseAppearance, chart: baseChartConfig }}
        fieldMapping={{ xAxis: "date", yAxis: "price" }}
        headers={["date", "price"]}
        rawRows={[["2024-01-01", "100"]]}
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      tooltip: { extraCssText?: string; textStyle?: { fontFamily?: string } };
    };
    const theme = resolveChartTheme();
    expect(option.tooltip.extraCssText).toContain(theme.shadowSoft);
    expect(option.tooltip.extraCssText).toContain(theme.radiusMd);
    expect(option.tooltip.textStyle?.fontFamily).toBe(theme.fontMono);
  });

  it("uses an axis-trigger tooltip for a multi-series bar chart", () => {
    renderChart(<ChartPanel {...barMultiSeries} />);
    const option = getOption(screen.getByTestId("echarts")) as {
      tooltip: { trigger?: string; axisPointer?: { type?: string } };
      series: unknown[];
    };
    expect(option.series.length).toBe(2);
    expect(option.tooltip.trigger).toBe("axis");
    expect(option.tooltip.axisPointer?.type).toBe("shadow");
  });

  it("keeps an item-trigger tooltip for a single-series bar chart", () => {
    renderChart(
      <ChartPanel
        appearance={{ ...baseAppearance, chart: { ...baseChartConfig, chartType: "bar" as const } }}
        fieldMapping={{ xAxis: "date", yAxis: "price" }}
        headers={["date", "price"]}
        rawRows={[["2024-01-01", "100"]]}
      />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      tooltip: { trigger?: string };
    };
    expect(option.tooltip.trigger).toBeUndefined();
  });

  it("adds accent-strong-colored emphasis to every rendered series", () => {
    renderChart(<ChartPanel {...barMultiSeries} />);
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ emphasis?: { focus?: string; itemStyle?: { borderColor?: string } } }>;
    };
    const theme = resolveChartTheme();
    for (const s of option.series) {
      expect(s.emphasis).toMatchObject({
        focus: "series",
        itemStyle: { borderColor: theme.accentStrong },
      });
    }
  });

  // HEL-566 skeptic-final-1 CR1/CR2 — `resolveChartTheme()`'s live
  // `getComputedStyle` read races `ThemeProvider`'s own `useEffect` (the
  // thing that actually flips `data-theme`/writes the accent custom
  // properties): on the SAME render a `theme`/`accentColor` context change
  // triggers, that effect has not run yet, so a naive re-resolve captures
  // the PREVIOUS theme/accent's values. Root-cause confirmed via a minimal
  // probe (see files-modified.md) — fixed by `themeSyncTick`, a
  // `requestAnimationFrame`-deferred corrective re-render scheduled from an
  // effect keyed on `theme`/`accentColor` (rAF fires after every effect of
  // the commit — ancestor and descendant alike — has already run).
  //
  // These tests mock `resolveChartTheme`'s return value from a REAL,
  // JS-visible signal `ThemeProvider` actually mutates
  // (`document.documentElement`'s `data-theme` attribute for theme;
  // `applyAccentTokens`'s real inline `--app-accent` custom property for
  // accent — `--app-accent-strong` itself is CSS `color-mix`-derived and
  // unreadable in jsdom, which never loads theme.css, so the mock stands in
  // for the browser's own cascade) — this is a faithful "does the real
  // wiring converge to the right VALUE" test, not merely a call-count spy
  // (a call-count-only assertion passes even when the returned value is
  // stale, which is exactly how this defect shipped past task 3.2's
  // original version of this test).
  describe("theme/accent toggle without remount (HEL-566 skeptic-final-1)", () => {
    function mockResolveChartThemeFromLiveDom() {
      return jest.spyOn(chartAppearance, "resolveChartTheme").mockImplementation(() => {
        const isDark = document.documentElement.getAttribute("data-theme") !== "light";
        const accent = document.documentElement.style.getPropertyValue("--app-accent") || "#f97316";
        return {
          surfaceStrong: isDark ? "DARK_SURFACE" : "LIGHT_SURFACE",
          borderSubtle: isDark ? "DARK_BORDER" : "LIGHT_BORDER",
          text: isDark ? "DARK_TEXT" : "LIGHT_TEXT",
          fontSans: "sans",
          fontMono: "mono",
          shadowSoft: isDark ? "DARK_SHADOW" : "LIGHT_SHADOW",
          radiusMd: "9px",
          accentStrong: `ACCENT_STRONG(${accent})`,
        };
      });
    }

    it("re-resolves the RENDERED tooltip background to the new theme after a light/dark toggle, without remounting", async () => {
      const resolveSpy = mockResolveChartThemeFromLiveDom();
      function ThemeToggler() {
        const { toggleTheme } = useTheme();
        return (
          <button type="button" onClick={toggleTheme}>
            toggle theme
          </button>
        );
      }
      render(
        <ThemeProvider>
          <ChartPanel {...barMultiSeries} />
          <ThemeToggler />
        </ThemeProvider>,
      );

      const echartsNode = screen.getByTestId("echarts");
      const before = getOption(echartsNode) as { tooltip: { backgroundColor?: string } };
      expect(before.tooltip.backgroundColor).toBe("DARK_SURFACE");

      await act(async () => {
        screen.getByText("toggle theme").click();
        // Flushes ThemeProvider's `data-theme`-flipping effect AND the
        // rAF-deferred `themeSyncTick` corrective re-render.
        await new Promise((r) => setTimeout(r, 50));
      });

      const after = getOption(screen.getByTestId("echarts")) as {
        tooltip: { backgroundColor?: string };
      };
      expect(after.tooltip.backgroundColor).toBe("LIGHT_SURFACE");
      // Same mounted echarts node throughout — never remounted.
      expect(screen.getByTestId("echarts")).toBe(echartsNode);

      resolveSpy.mockRestore();
    });

    it("re-resolves the RENDERED hover-emphasis color when accentColor changes alone, with no theme change", async () => {
      const resolveSpy = mockResolveChartThemeFromLiveDom();
      function AccentChanger() {
        const { setAccentColor } = useTheme();
        return (
          <button type="button" onClick={() => setAccentColor("#123456")}>
            change accent
          </button>
        );
      }
      render(
        <ThemeProvider>
          <ChartPanel {...barMultiSeries} />
          <AccentChanger />
        </ThemeProvider>,
      );

      const echartsNode = screen.getByTestId("echarts");
      const before = getOption(echartsNode) as {
        series: Array<{ emphasis?: { itemStyle?: { borderColor?: string } } }>;
      };
      expect(before.series[0].emphasis?.itemStyle?.borderColor).toBe("ACCENT_STRONG(#f97316)");

      await act(async () => {
        screen.getByText("change accent").click();
        await new Promise((r) => setTimeout(r, 50));
      });

      const after = getOption(screen.getByTestId("echarts")) as {
        series: Array<{ emphasis?: { itemStyle?: { borderColor?: string } } }>;
      };
      expect(after.series[0].emphasis?.itemStyle?.borderColor).toBe("ACCENT_STRONG(#123456)");
      expect(screen.getByTestId("echarts")).toBe(echartsNode);

      resolveSpy.mockRestore();
    });
  });
});
