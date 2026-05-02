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

describe("PanelContent — appearance forwarding", () => {
  it("forwards appearance prop to ChartPanel", () => {
    const appearance = {
      background: "transparent",
      color: "inherit",
      transparency: 0,
      chart: {
        seriesColors: ["#ff0000"],
        legend: { show: true, position: "top" as const },
        tooltip: { enabled: true },
        axisLabels: {
          x: { show: true, label: "X" },
          y: { show: true, label: "Y" },
        },
      },
    };
    render(<PanelContent type="chart" appearance={appearance} />);
    expect(capturedChartProps?.appearance).toEqual(appearance);
  });

  it("forwards undefined appearance when not provided", () => {
    render(<PanelContent type="chart" />);
    expect(capturedChartProps?.appearance).toBeUndefined();
  });
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

describe("PanelContent — chart forwards all props to ChartPanel", () => {
  it("forwards fieldMapping, rawRows, and headers to ChartPanel", () => {
    const fieldMapping = { xAxis: "date", yAxis: "price" };
    const rawRows = [["2024-01-01", "100"]];
    const headers = ["date", "price"];
    render(
      <PanelContent type="chart" fieldMapping={fieldMapping} rawRows={rawRows} headers={headers} />,
    );
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

describe("PanelContent — metric trend indicator", () => {
  it("renders trend indicator with --up class when trend starts with '+'", () => {
    const { container } = render(
      <PanelContent type="metric" data={{ value: "100", label: "Revenue", trend: "+3.2%" }} />,
    );
    const trend = container.querySelector(".panel-content__metric-trend");
    expect(trend).toBeInTheDocument();
    expect(trend).toHaveClass("panel-content__metric-trend--up");
    expect(trend).toHaveTextContent("+3.2%");
  });

  it("renders trend indicator with --down class when trend starts with '-'", () => {
    const { container } = render(
      <PanelContent type="metric" data={{ value: "100", label: "Revenue", trend: "-1.1%" }} />,
    );
    const trend = container.querySelector(".panel-content__metric-trend");
    expect(trend).toBeInTheDocument();
    expect(trend).toHaveClass("panel-content__metric-trend--down");
    expect(trend).toHaveTextContent("-1.1%");
  });

  it("renders trend indicator with --flat class for neutral trend string", () => {
    const { container } = render(
      <PanelContent type="metric" data={{ value: "100", label: "Revenue", trend: "0%" }} />,
    );
    const trend = container.querySelector(".panel-content__metric-trend");
    expect(trend).toBeInTheDocument();
    expect(trend).toHaveClass("panel-content__metric-trend--flat");
    expect(trend).toHaveTextContent("0%");
  });

  it("does not render trend indicator when data.trend is not present", () => {
    const { container } = render(
      <PanelContent type="metric" data={{ value: "100", label: "Revenue" }} />,
    );
    expect(container.querySelector(".panel-content__metric-trend")).not.toBeInTheDocument();
  });

  it("does not render trend indicator when panel is unbound (no data)", () => {
    const { container } = render(<PanelContent type="metric" />);
    expect(container.querySelector(".panel-content__metric-trend")).not.toBeInTheDocument();
  });
});

describe("PanelContent — live text data", () => {
  it("renders .panel-content__text-live element when text panel has live content", () => {
    const { container } = render(<PanelContent type="text" data={{ content: "Hello world" }} />);
    expect(container.querySelector(".panel-content__text-live")).toBeInTheDocument();
  });

  it("text-live element displays the bound content", () => {
    const { container } = render(<PanelContent type="text" data={{ content: "Sample text" }} />);
    const liveEl = container.querySelector(".panel-content__text-live");
    expect(liveEl).toBeInTheDocument();
    expect(liveEl).toHaveTextContent("Sample text");
  });
});
