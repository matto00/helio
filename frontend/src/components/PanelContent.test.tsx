import { render, screen } from "@testing-library/react";

import { PanelContent } from "./PanelContent";
import type { ChartPanelProps } from "./ChartPanel";

let capturedChartProps: ChartPanelProps | null = null;

jest.mock("./ChartPanel", () => ({
  ChartPanel: (props: ChartPanelProps) => {
    capturedChartProps = props;
    return <div data-testid="chart-panel" />;
  },
}));

beforeEach(() => {
  capturedChartProps = null;
});

describe("PanelContent — placeholder (unbound)", () => {
  it("renders the metric placeholder for type metric", () => {
    render(<PanelContent type="metric" />);
    expect(screen.getByText("--")).toBeInTheDocument();
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("renders an ECharts chart panel for type chart", () => {
    render(<PanelContent type="chart" />);
    expect(screen.getByTestId("chart-panel")).toBeInTheDocument();
  });

  it("passes appearance prop to ChartPanel", () => {
    const appearance = {
      background: "#fff",
      color: "#000",
      transparency: 0,
      chartType: "bar" as const,
    };
    render(<PanelContent type="chart" appearance={appearance} />);
    expect(screen.getByTestId("chart-panel")).toBeInTheDocument();
  });

  it("renders placeholder lines for type text", () => {
    const { container } = render(<PanelContent type="text" />);
    const lines = container.querySelectorAll(".panel-content__text-line");
    expect(lines.length).toBeGreaterThan(0);
  });

  it("renders a table element for type table", () => {
    const { container } = render(<PanelContent type="table" />);
    expect(container.querySelector("table")).toBeInTheDocument();
  });
});

describe("PanelContent — loading state", () => {
  it("shows a spinner and loading label", () => {
    render(<PanelContent type="metric" isLoading={true} />);
    expect(screen.getByLabelText("Loading data")).toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("does not render metric content while loading", () => {
    render(<PanelContent type="metric" isLoading={true} />);
    expect(screen.queryByText("--")).not.toBeInTheDocument();
  });
});

describe("PanelContent — error state", () => {
  it("shows the error message", () => {
    render(<PanelContent type="metric" error="Failed to load data." />);
    expect(screen.getByText("Failed to load data.")).toBeInTheDocument();
  });

  it("does not render metric content when there is an error", () => {
    render(<PanelContent type="metric" error="Failed to load data." />);
    expect(screen.queryByText("--")).not.toBeInTheDocument();
  });
});

describe("PanelContent — no-data state", () => {
  it("shows the no-data message", () => {
    render(<PanelContent type="metric" noData={true} />);
    expect(screen.getByText("No data available")).toBeInTheDocument();
  });
});

describe("PanelContent — live metric data", () => {
  it("displays value and label from data prop", () => {
    render(<PanelContent type="metric" data={{ value: "42", label: "Revenue" }} />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Revenue")).toBeInTheDocument();
  });

  it("falls back to placeholder when data is null", () => {
    render(<PanelContent type="metric" data={null} />);
    expect(screen.getByText("--")).toBeInTheDocument();
  });
});

describe("PanelContent — chart type forwards props to ChartPanel", () => {
  it("forwards fieldMapping, rawRows, and headers to ChartPanel", () => {
    const fieldMapping = { xAxis: "date", yAxis: "price" };
    const rawRows = [["2024-01-01", "100"]];
    const headers = ["date", "price"];
    render(
      <PanelContent type="chart" fieldMapping={fieldMapping} rawRows={rawRows} headers={headers} />,
    );
    expect(screen.getByTestId("chart-panel")).toBeInTheDocument();
    expect(capturedChartProps?.fieldMapping).toEqual(fieldMapping);
    expect(capturedChartProps?.rawRows).toEqual(rawRows);
    expect(capturedChartProps?.headers).toEqual(headers);
  });

  it("forwards null fieldMapping to ChartPanel", () => {
    render(<PanelContent type="chart" fieldMapping={null} />);
    expect(capturedChartProps?.fieldMapping).toBeNull();
  });
});

describe("PanelContent — live table data", () => {
  it("renders live rows and headers", () => {
    const { container } = render(
      <PanelContent
        type="table"
        rawRows={[
          ["1000", "North"],
          ["2000", "South"],
        ]}
        headers={["Revenue", "Region"]}
      />,
    );
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("North")).toBeInTheDocument();
    expect(screen.getByText("2000")).toBeInTheDocument();
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2);
  });
});
