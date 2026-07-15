import { render, screen } from "@testing-library/react";

import { PanelContent } from "./PanelContent";
import type { ChartPanelProps } from "./ChartPanel";
import {
  makeChartPanel,
  makeMetricPanel,
  makeTablePanel,
  makeTextPanel,
} from "../../../test/panelFixtures";

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
    const panel = makeChartPanel({ appearance });
    render(<PanelContent panel={panel} appearance={appearance} />);
    expect(capturedChartProps?.appearance).toEqual(appearance);
  });

  it("forwards panel.appearance when no appearance prop is provided", () => {
    const panel = makeChartPanel();
    render(<PanelContent panel={panel} />);
    expect(capturedChartProps?.appearance).toEqual(panel.appearance);
  });
});

describe("PanelContent — placeholder (unbound)", () => {
  it("renders the metric placeholder for type metric", () => {
    render(<PanelContent panel={makeMetricPanel()} />);
    expect(screen.getByText("--")).toBeInTheDocument();
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("renders an ECharts chart panel for type chart", () => {
    render(<PanelContent panel={makeChartPanel()} />);
    expect(screen.getByTestId("chart-panel")).toBeInTheDocument();
  });

  it("renders placeholder lines for type text", () => {
    const { container } = render(<PanelContent panel={makeTextPanel()} />);
    const lines = container.querySelectorAll(".panel-content__text-line");
    expect(lines.length).toBeGreaterThan(0);
  });

  it("renders a table element for type table", () => {
    const { container } = render(<PanelContent panel={makeTablePanel()} />);
    expect(container.querySelector("table")).toBeInTheDocument();
  });
});

describe("PanelContent — loading state", () => {
  it("shows a spinner and loading label", () => {
    render(<PanelContent panel={makeMetricPanel()} isLoading={true} />);
    expect(screen.getByLabelText("Loading data")).toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("does not render metric content while loading", () => {
    render(<PanelContent panel={makeMetricPanel()} isLoading={true} />);
    expect(screen.queryByText("--")).not.toBeInTheDocument();
  });
});

describe("PanelContent — error state", () => {
  it("shows the error message", () => {
    render(<PanelContent panel={makeMetricPanel()} error="Failed to load data." />);
    expect(screen.getByText("Failed to load data.")).toBeInTheDocument();
  });

  it("does not render metric content when there is an error", () => {
    render(<PanelContent panel={makeMetricPanel()} error="Failed to load data." />);
    expect(screen.queryByText("--")).not.toBeInTheDocument();
  });
});

describe("PanelContent — no-data state", () => {
  it("shows the no-data message", () => {
    render(<PanelContent panel={makeMetricPanel()} noData={true} />);
    expect(screen.getByText("No data available")).toBeInTheDocument();
  });
});

describe("PanelContent — live metric data", () => {
  it("displays value and label from data prop", () => {
    render(<PanelContent panel={makeMetricPanel()} data={{ value: "42", label: "Revenue" }} />);
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Revenue")).toBeInTheDocument();
  });

  it("falls back to placeholder when data is null", () => {
    render(<PanelContent panel={makeMetricPanel()} data={null} />);
    expect(screen.getByText("--")).toBeInTheDocument();
  });
});

describe("PanelContent — chart forwards all props to ChartPanel", () => {
  it("forwards fieldMapping, rawRows, and headers to ChartPanel", () => {
    const fieldMapping = { xAxis: "date", yAxis: "price" };
    const rawRows = [["2024-01-01", "100"]];
    const headers = ["date", "price"];
    const panel = makeChartPanel({ config: { fieldMapping } });
    render(<PanelContent panel={panel} rawRows={rawRows} headers={headers} />);
    expect(capturedChartProps?.fieldMapping).toEqual(fieldMapping);
    expect(capturedChartProps?.rawRows).toEqual(rawRows);
    expect(capturedChartProps?.headers).toEqual(headers);
  });

  it("forwards an empty fieldMapping object to ChartPanel for an unbound chart panel", () => {
    render(<PanelContent panel={makeChartPanel()} />);
    expect(capturedChartProps?.fieldMapping).toEqual({});
  });

  // HEL-301 — compact threads through to ChartPanel so the phone stack can
  // hide the legend / shrink axis labels (W5).
  it("forwards compact=true to ChartPanel", () => {
    render(<PanelContent panel={makeChartPanel()} compact />);
    expect(capturedChartProps?.compact).toBe(true);
  });

  it("leaves compact undefined for the desktop grid (no compact prop passed)", () => {
    render(<PanelContent panel={makeChartPanel()} />);
    expect(capturedChartProps?.compact).toBeUndefined();
  });
});

describe("PanelContent — live table data", () => {
  it("renders live rows and headers", () => {
    const { container } = render(
      <PanelContent
        panel={makeTablePanel()}
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

describe("PanelContent — TableContent sizing", () => {
  it("2.1 renders .panel-content--table container when data rows are provided", () => {
    const { container } = render(
      <PanelContent
        panel={makeTablePanel()}
        rawRows={[
          ["Alice", "30"],
          ["Bob", "25"],
        ]}
        headers={["Name", "Age"]}
      />,
    );
    expect(container.querySelector(".panel-content--table")).toBeInTheDocument();
  });

  it("2.2 renders placeholder table inside .panel-content--table when no data", () => {
    const { container } = render(<PanelContent panel={makeTablePanel()} />);
    const tableContainer = container.querySelector(".panel-content--table");
    expect(tableContainer).toBeInTheDocument();
    expect(tableContainer?.querySelector("table")).toBeInTheDocument();
  });

  it("2.3 renders correct number of <tr> rows for given rawRows", () => {
    const { container } = render(
      <PanelContent panel={makeTablePanel()} rawRows={[["A"], ["B"], ["C"]]} />,
    );
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(3);
  });

  it("2.4 renders column headers from headers prop when provided", () => {
    render(
      <PanelContent
        panel={makeTablePanel()}
        rawRows={[["val1", "val2"]]}
        headers={["Column A", "Column B"]}
      />,
    );
    expect(screen.getByText("Column A")).toBeInTheDocument();
    expect(screen.getByText("Column B")).toBeInTheDocument();
  });
});

describe("PanelContent — metric trend indicator", () => {
  it("renders trend indicator with --up class when trend starts with '+'", () => {
    const { container } = render(
      <PanelContent
        panel={makeMetricPanel()}
        data={{ value: "100", label: "Revenue", trend: "+3.2%" }}
      />,
    );
    const trend = container.querySelector(".panel-content__metric-trend");
    expect(trend).toBeInTheDocument();
    expect(trend).toHaveClass("panel-content__metric-trend--up");
    expect(trend).toHaveTextContent("+3.2%");
  });

  it("renders trend indicator with --down class when trend starts with '-'", () => {
    const { container } = render(
      <PanelContent
        panel={makeMetricPanel()}
        data={{ value: "100", label: "Revenue", trend: "-1.1%" }}
      />,
    );
    const trend = container.querySelector(".panel-content__metric-trend");
    expect(trend).toBeInTheDocument();
    expect(trend).toHaveClass("panel-content__metric-trend--down");
    expect(trend).toHaveTextContent("-1.1%");
  });

  it("renders trend indicator with --flat class for neutral trend string", () => {
    const { container } = render(
      <PanelContent
        panel={makeMetricPanel()}
        data={{ value: "100", label: "Revenue", trend: "0%" }}
      />,
    );
    const trend = container.querySelector(".panel-content__metric-trend");
    expect(trend).toBeInTheDocument();
    expect(trend).toHaveClass("panel-content__metric-trend--flat");
    expect(trend).toHaveTextContent("0%");
  });

  it("does not render trend indicator when data.trend is not present", () => {
    const { container } = render(
      <PanelContent panel={makeMetricPanel()} data={{ value: "100", label: "Revenue" }} />,
    );
    expect(container.querySelector(".panel-content__metric-trend")).not.toBeInTheDocument();
  });

  it("does not render trend indicator when panel is unbound (no data)", () => {
    const { container } = render(<PanelContent panel={makeMetricPanel()} />);
    expect(container.querySelector(".panel-content__metric-trend")).not.toBeInTheDocument();
  });
});

describe("PanelContent — live text data", () => {
  it("renders .panel-content__text-live element when text panel has live content", () => {
    const { container } = render(
      <PanelContent panel={makeTextPanel()} data={{ content: "Hello world" }} />,
    );
    expect(container.querySelector(".panel-content__text-live")).toBeInTheDocument();
  });

  it("text-live element displays the bound content", () => {
    const { container } = render(
      <PanelContent panel={makeTextPanel()} data={{ content: "Sample text" }} />,
    );
    const liveEl = container.querySelector(".panel-content__text-live");
    expect(liveEl).toBeInTheDocument();
    expect(liveEl).toHaveTextContent("Sample text");
  });

  // HEL-244 regression — an existing unbound Text panel (no dataTypeId, only
  // literal config.content) must render identically to before this change:
  // no `data` prop is passed (usePanelData returns null for unbound panels),
  // so TextRenderer falls back to config.content.
  it("renders literal config.content unchanged for an unbound Text panel (no data prop)", () => {
    const { container } = render(
      <PanelContent panel={makeTextPanel({ config: { content: "Static fallback text" } })} />,
    );
    const liveEl = container.querySelector(".panel-content__text-live");
    expect(liveEl).toBeInTheDocument();
    expect(liveEl).toHaveTextContent("Static fallback text");
  });

  it("bound data.content takes precedence over literal config.content when both are present", () => {
    const { container } = render(
      <PanelContent
        panel={makeTextPanel({ config: { content: "Stale literal" } })}
        data={{ content: "Fresh bound value" }}
      />,
    );
    const liveEl = container.querySelector(".panel-content__text-live");
    expect(liveEl).toHaveTextContent("Fresh bound value");
  });
});
