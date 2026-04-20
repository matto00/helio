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

describe("ChartPanel — no data", () => {
  it("renders an ECharts instance with default option", () => {
    render(<ChartPanel />);
    expect(screen.getByTestId("echarts")).toBeInTheDocument();
  });

  it("renders when fieldMapping is null", () => {
    render(<ChartPanel fieldMapping={null} />);
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

describe("ChartPanel — auto-detect numeric columns", () => {
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
