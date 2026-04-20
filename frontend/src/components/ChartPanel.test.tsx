import { render, screen } from "@testing-library/react";

import { getChartOption, ChartPanel } from "./ChartPanel";

jest.mock("echarts-for-react", () => ({
  __esModule: true,
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(option)} />
  ),
}));

describe("getChartOption", () => {
  describe("line chart", () => {
    it("returns series[0].type === 'line'", () => {
      const option = getChartOption("line");
      const series = option.series as Array<{ type: string }>;
      expect(series[0].type).toBe("line");
    });

    it("includes xAxis and yAxis", () => {
      const option = getChartOption("line");
      expect(option.xAxis).toBeDefined();
      expect(option.yAxis).toBeDefined();
    });
  });

  describe("bar chart", () => {
    it("returns series[0].type === 'bar'", () => {
      const option = getChartOption("bar");
      const series = option.series as Array<{ type: string }>;
      expect(series[0].type).toBe("bar");
    });

    it("includes xAxis and yAxis", () => {
      const option = getChartOption("bar");
      expect(option.xAxis).toBeDefined();
      expect(option.yAxis).toBeDefined();
    });
  });

  describe("pie chart", () => {
    it("returns series[0].type === 'pie'", () => {
      const option = getChartOption("pie");
      const series = option.series as Array<{ type: string }>;
      expect(series[0].type).toBe("pie");
    });

    it("omits xAxis and yAxis", () => {
      const option = getChartOption("pie");
      expect(option.xAxis).toBeUndefined();
      expect(option.yAxis).toBeUndefined();
    });
  });

  describe("scatter chart", () => {
    it("returns series[0].type === 'scatter'", () => {
      const option = getChartOption("scatter");
      const series = option.series as Array<{ type: string }>;
      expect(series[0].type).toBe("scatter");
    });

    it("includes xAxis and yAxis", () => {
      const option = getChartOption("scatter");
      expect(option.xAxis).toBeDefined();
      expect(option.yAxis).toBeDefined();
    });
  });

  describe("default", () => {
    it("defaults to line when no argument given", () => {
      const option = getChartOption();
      const series = option.series as Array<{ type: string }>;
      expect(series[0].type).toBe("line");
    });
  });
});

describe("ChartPanel — null fieldMapping (placeholder)", () => {
  it("renders an ECharts instance when fieldMapping is null", () => {
    render(<ChartPanel fieldMapping={null} />);
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
  });

  it("renders an ECharts instance when fieldMapping is omitted", () => {
    render(<ChartPanel />);
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
  });

  it("does not show empty-state text when fieldMapping is null", () => {
    render(<ChartPanel fieldMapping={null} />);
    expect(screen.queryByText("Select fields to display chart data")).not.toBeInTheDocument();
  });
});

describe("ChartPanel — empty-state when fields are not mapped", () => {
  it("shows empty-state message when xAxis is absent", () => {
    render(
      <ChartPanel
        fieldMapping={{ yAxis: "price" }}
        headers={["date", "price"]}
        rawRows={[["2024-01-01", "100"]]}
      />,
    );
    expect(screen.getByText("Select fields to display chart data")).toBeInTheDocument();
    expect(screen.queryByTestId("echarts")).not.toBeInTheDocument();
  });

  it("shows empty-state message when yAxis is absent", () => {
    render(
      <ChartPanel
        fieldMapping={{ xAxis: "date" }}
        headers={["date", "price"]}
        rawRows={[["2024-01-01", "100"]]}
      />,
    );
    expect(screen.getByText("Select fields to display chart data")).toBeInTheDocument();
    expect(screen.queryByTestId("echarts")).not.toBeInTheDocument();
  });

  it("shows empty-state message when xAxis is empty string", () => {
    render(
      <ChartPanel
        fieldMapping={{ xAxis: "", yAxis: "price" }}
        headers={["date", "price"]}
        rawRows={[["2024-01-01", "100"]]}
      />,
    );
    expect(screen.getByText("Select fields to display chart data")).toBeInTheDocument();
  });

  it("shows empty-state message when yAxis is empty string", () => {
    render(
      <ChartPanel
        fieldMapping={{ xAxis: "date", yAxis: "" }}
        headers={["date", "price"]}
        rawRows={[["2024-01-01", "100"]]}
      />,
    );
    expect(screen.getByText("Select fields to display chart data")).toBeInTheDocument();
  });
});

describe("ChartPanel — renders with mapped xAxis and yAxis", () => {
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

  it("does not show empty-state text when fields are mapped", () => {
    render(<ChartPanel fieldMapping={fieldMapping} headers={headers} rawRows={rawRows} />);
    expect(screen.queryByText("Select fields to display chart data")).not.toBeInTheDocument();
  });

  it("passes xAxis categories from the mapped column", () => {
    render(<ChartPanel fieldMapping={fieldMapping} headers={headers} rawRows={rawRows} />);
    const el = screen.getByTestId("echarts");
    const option = JSON.parse(el.getAttribute("data-option") ?? "{}") as {
      xAxis: { data: string[] };
    };
    expect(option.xAxis.data).toEqual(["2024-01-01", "2024-01-02", "2024-01-03"]);
  });

  it("passes yAxis values from the mapped column", () => {
    render(<ChartPanel fieldMapping={fieldMapping} headers={headers} rawRows={rawRows} />);
    const el = screen.getByTestId("echarts");
    const option = JSON.parse(el.getAttribute("data-option") ?? "{}") as {
      series: Array<{ data: string[] }>;
    };
    expect(option.series[0].data).toEqual(["100", "200", "150"]);
  });

  it("uses the yAxis field name as the series label", () => {
    render(<ChartPanel fieldMapping={fieldMapping} headers={headers} rawRows={rawRows} />);
    const el = screen.getByTestId("echarts");
    const option = JSON.parse(el.getAttribute("data-option") ?? "{}") as {
      series: Array<{ name: string }>;
    };
    expect(option.series[0].name).toBe("price");
  });

  it("includes all rows in the series (not just the first)", () => {
    render(<ChartPanel fieldMapping={fieldMapping} headers={headers} rawRows={rawRows} />);
    const el = screen.getByTestId("echarts");
    const option = JSON.parse(el.getAttribute("data-option") ?? "{}") as {
      series: Array<{ data: unknown[] }>;
    };
    expect(option.series[0].data).toHaveLength(rawRows.length);
  });
});

describe("ChartPanel — mapped field not present in headers", () => {
  it("renders an ECharts instance (no crash)", () => {
    render(
      <ChartPanel
        fieldMapping={{ xAxis: "date", yAxis: "nonexistent" }}
        headers={["date", "price"]}
        rawRows={[["2024-01-01", "100"]]}
      />,
    );
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
  });

  it("produces an empty series when yAxis field is not in headers", () => {
    render(
      <ChartPanel
        fieldMapping={{ xAxis: "date", yAxis: "nonexistent" }}
        headers={["date", "price"]}
        rawRows={[["2024-01-01", "100"]]}
      />,
    );
    const el = screen.getByTestId("echarts");
    const option = JSON.parse(el.getAttribute("data-option") ?? "{}") as {
      series: Array<{ data: string[] }>;
    };
    // yIdx is -1, so each entry in yData is ""
    expect(option.series[0].data).toEqual([""]);
  });
});
