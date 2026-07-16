import { render, screen } from "@testing-library/react";

import { ChartPanel } from "./ChartPanel";

jest.mock("echarts-for-react", () => ({
  __esModule: true,
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(option)} />
  ),
}));

function getOption(el: HTMLElement) {
  return JSON.parse(el.getAttribute("data-option") ?? "{}") as Record<string, unknown>;
}

describe("ChartPanel \u2014 no data", () => {
  it("renders an ECharts instance with default option", () => {
    render(<ChartPanel />);
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
  });

  it("renders when fieldMapping is null", () => {
    render(<ChartPanel fieldMapping={null} />);
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
    render(<ChartPanel fieldMapping={fieldMapping} headers={headers} rawRows={rawRows} />);
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
  });

  it("sets xAxis categories from the mapped column", () => {
    render(<ChartPanel fieldMapping={fieldMapping} headers={headers} rawRows={rawRows} />);
    const option = getOption(screen.getByTestId("echarts")) as { xAxis: { data: string[] } };
    expect(option.xAxis.data).toEqual(["2024-01-01", "2024-01-02", "2024-01-03"]);
  });

  it("uses the yAxis field name as the series label", () => {
    render(<ChartPanel fieldMapping={fieldMapping} headers={headers} rawRows={rawRows} />);
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ name: string }>;
    };
    expect(option.series[0].name).toBe("price");
  });

  it("includes all rows in the series", () => {
    render(<ChartPanel fieldMapping={fieldMapping} headers={headers} rawRows={rawRows} />);
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
    render(<ChartPanel headers={headers} rawRows={rawRows} />);
    const option = getOption(screen.getByTestId("echarts")) as { xAxis: { data: string[] } };
    expect(option.xAxis.data).toEqual(["A", "B"]);
  });

  it("renders default chart when no numeric columns exist", () => {
    const headers = ["a", "b"];
    const rawRows = [["foo", "bar"]];
    render(<ChartPanel headers={headers} rawRows={rawRows} />);
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
    render(<ChartPanel appearance={appearance} />);
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
    render(<ChartPanel appearance={appearance} />);
    const option = getOption(screen.getByTestId("echarts")) as { color: string[] };
    expect(option.color).toEqual(["#ff0000", "#00ff00"]);
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
    render(
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
    render(
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
    render(<ChartPanel appearance={appearance} chartAggregate={chartAggregate} />);
    const option = getOption(screen.getByTestId("echarts")) as {
      xAxis: { data: string[] };
      series: Array<{ type: string; data: number[] }>;
    };
    expect(option.xAxis.data).toEqual(["2019", "2020"]);
    expect(option.series[0].type).toBe("bar");
    expect(option.series[0].data).toEqual([3, 6]);
  });

  it("renders the precomputed chartAggregate for the default (line) chart type", () => {
    render(<ChartPanel chartAggregate={chartAggregate} />);
    const option = getOption(screen.getByTestId("echarts")) as {
      xAxis: { data: string[] };
      series: Array<{ type: string; data: number[] }>;
    };
    expect(option.xAxis.data).toEqual(["2019", "2020"]);
    expect(option.series[0].type).toBe("line");
    expect(option.series[0].data).toEqual([3, 6]);
  });

  it("ignores chartAggregate for a pie chart and falls back to the rawRows path", () => {
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
    render(
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
    // Per-row data, NOT the aggregate categories/values.
    expect(option.series[0].data).toEqual([
      { name: "Apples", value: 100 },
      { name: "Bananas", value: 200 },
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
    render(
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
    render(<ChartPanel fieldMapping={fieldMapping} headers={headers} rawRows={rawRows} />);
    const option = getOption(screen.getByTestId("echarts")) as { xAxis: { data: string[] } };
    expect(option.xAxis.data).toEqual(["2024-01-01", "2024-01-02"]);
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
    render(<ChartPanel appearance={appearance} compact />);
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
    render(<ChartPanel appearance={appearance} />);
    const option = getOption(screen.getByTestId("echarts")) as { legend: { show: boolean } };
    expect(option.legend.show).toBe(true);
  });

  it("shrinks axis label font size when compact is true", () => {
    const headers = ["date", "price"];
    const rawRows = [["2024-01-01", "100"]];
    render(
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
    render(<ChartPanel appearance={appearance} compact />);
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
    render(
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

// ── HEL-248: per-chart-type display options → ECharts option mapping ─────────

describe("ChartPanel — chartOptions (HEL-248)", () => {
  const lineAppearance = {
    ...baseAppearance,
    chart: { ...baseChartConfig, chartType: "line" as const },
  };

  it("applies line smooth / showSymbol / areaStyle from chartOptions.line", () => {
    render(
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
    render(
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
    render(<ChartPanel {...barMultiSeries} chartOptions={{ bar: { stacking: "stacked" } }} />);
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ stack?: string }>;
    };
    expect(option.series.length).toBe(2);
    expect(option.series.every((s) => s.stack === "total")).toBe(true);
  });

  it("swaps category to the y-axis for orientation=horizontal", () => {
    render(
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
    render(<ChartPanel {...barMultiSeries} chartOptions={{ bar: { stacking: "normalized" } }} />);
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
    render(<ChartPanel {...barMultiSeries} chartOptions={{ bar: { barGapPct: 40 } }} />);
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
    render(
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
    render(
      <ChartPanel {...scatterSetup} chartOptions={{ scatter: { sizeField: "population" } }} />,
    );
    const option = getOption(screen.getByTestId("echarts")) as {
      series: Array<{ data: number[][] }>;
    };
    expect(option.series[0].data[0]).toEqual([1, 2, 100]);
  });

  it("groups scatter rows into one series per distinct colorField value", () => {
    render(<ChartPanel {...scatterSetup} chartOptions={{ scatter: { colorField: "region" } }} />);
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
