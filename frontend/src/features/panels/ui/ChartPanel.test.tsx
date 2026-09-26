import { screen } from "@testing-library/react";

import { ChartPanel } from "./ChartPanel";
import { baseAppearance, baseChartConfig, getOption, renderChart } from "./chartPanelTestHelpers";

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

describe("ChartPanel — no data", () => {
  it("renders an ECharts instance with default option", () => {
    renderChart(<ChartPanel />);
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
  });

  it("renders when fieldMapping is null", () => {
    renderChart(<ChartPanel fieldMapping={null} />);
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
  });
});

describe("ChartPanel — mapped xAxis and yAxis", () => {
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

describe("ChartPanel — auto-detect numeric columns", () => {
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

describe("ChartPanel — pie chart", () => {
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

describe("ChartPanel — scatter chart", () => {
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
