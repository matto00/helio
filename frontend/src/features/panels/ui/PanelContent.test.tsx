import { fireEvent, render, screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { PanelContent } from "./PanelContent";
import type { ChartPanelProps } from "./ChartPanel";
import { makeOutputPanel, makeTextPanel } from "../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../pipelines/services/outputService";
import type { Output } from "../../pipelines/types/output";

let capturedChartProps: ChartPanelProps | null = null;

jest.mock("./ChartPanel", () => ({
  ChartPanel: (props: ChartPanelProps) => {
    capturedChartProps = props;
    return <div data-testid="chart-panel" />;
  },
}));

jest.mock("../../pipelines/services/outputService", () => ({
  getOutputById: jest.fn(),
}));

const getOutputByIdMock = jest.mocked(getOutputByIdRequest);

beforeEach(() => {
  capturedChartProps = null;
  getOutputByIdMock.mockReset();
});

function makeOutput(overrides: Partial<Output> = {}): Output {
  return {
    id: "output-1",
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Test Output",
    kind: "metric",
    config: {},
    schema: [],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

// HEL-512 — `ChartPanel` is now a `React.lazy` target inside `ChartRenderer` (design.md Decision
// 1); even with the `./ChartPanel` mock above resolving immediately, it mounts asynchronously
// behind a `Suspense` boundary. HEL-909 additionally means an output-kind panel's renderer choice
// (metric/chart/table/etc.) itself resolves asynchronously (`useOutputMeta`'s `GET
// /api/outputs/:id` fetch) — every assertion below awaits `screen.findByTestId(...)` or an
// equivalent async query rather than asserting synchronously.
describe("PanelContent — appearance forwarding", () => {
  it("forwards appearance prop to ChartPanel", async () => {
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
    getOutputByIdMock.mockResolvedValue(makeOutput({ kind: "chart" }));
    const panel = makeOutputPanel({ appearance });
    render(<PanelContent panel={panel} appearance={appearance} />);
    await screen.findByTestId("chart-panel");
    expect(capturedChartProps?.appearance).toEqual(appearance);
  });

  it("forwards panel.appearance when no appearance prop is provided", async () => {
    getOutputByIdMock.mockResolvedValue(makeOutput({ kind: "chart" }));
    const panel = makeOutputPanel();
    render(<PanelContent panel={panel} />);
    await screen.findByTestId("chart-panel");
    expect(capturedChartProps?.appearance).toEqual(panel.appearance);
  });
});

describe("PanelContent — output kind dispatch", () => {
  it("renders the metric placeholder for output kind metric", async () => {
    getOutputByIdMock.mockResolvedValue(makeOutput({ kind: "metric" }));
    render(<PanelContent panel={makeOutputPanel()} />);
    expect(await screen.findByText("--")).toBeInTheDocument();
  });

  it("renders an ECharts chart panel for output kind chart", async () => {
    getOutputByIdMock.mockResolvedValue(makeOutput({ kind: "chart" }));
    render(<PanelContent panel={makeOutputPanel()} />);
    expect(await screen.findByTestId("chart-panel")).toBeInTheDocument();
  });

  it("renders a table element for output kind table", async () => {
    getOutputByIdMock.mockResolvedValue(makeOutput({ kind: "table" }));
    const { container } = renderWithStore(
      <PanelContent panel={makeOutputPanel()} rawRows={[["1"]]} headers={["value"]} />,
    );
    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(container.querySelector("table")).toBeInTheDocument();
  });

  it("renders placeholder lines for type text (dashboard-native, not an output fetch)", () => {
    const { container } = render(<PanelContent panel={makeTextPanel()} />);
    const lines = container.querySelectorAll(".panel-content__text-line");
    expect(lines.length).toBeGreaterThan(0);
  });
});

describe("PanelContent — loading state", () => {
  it("shows a kind-agnostic body skeleton (HEL-528 design.md D6), not a spinner", () => {
    const { container } = render(<PanelContent panel={makeOutputPanel()} isLoading={true} />);
    expect(screen.getByLabelText("Loading data")).toBeInTheDocument();
    expect(container.querySelector(".panel-body-skeleton")).toBeInTheDocument();
    expect(container.querySelector(".ui-skeleton")).toBeInTheDocument();
    expect(container.querySelector(".ui-spinner")).not.toBeInTheDocument();
  });

  it("does not render metric content while loading", () => {
    render(<PanelContent panel={makeOutputPanel()} isLoading={true} />);
    expect(screen.queryByText("--")).not.toBeInTheDocument();
  });
});

describe("PanelContent — error state", () => {
  it("shows the error message", () => {
    render(<PanelContent panel={makeOutputPanel()} error="Failed to load data." />);
    expect(screen.getByText("Failed to load data.")).toBeInTheDocument();
  });

  it("does not render metric content when there is an error", () => {
    render(<PanelContent panel={makeOutputPanel()} error="Failed to load data." />);
    expect(screen.queryByText("--")).not.toBeInTheDocument();
  });
});

// HEL-539 — the error state now renders InlineError variant="banner", with
// its own role="alert" (announced=false), Retry action, and kind-based icon.
describe("PanelContent — error state retry wiring (HEL-539)", () => {
  it("carries a single role=alert (announced=false, not doubled by the wrapper's own role)", () => {
    render(<PanelContent panel={makeOutputPanel()} error="Failed to load data." />);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("renders a Retry action invoking onRetry when errorKind is error (or unset)", () => {
    const onRetry = jest.fn();
    render(
      <PanelContent panel={makeOutputPanel()} error="Failed to load data." onRetry={onRetry} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders no Retry action for a forbidden/not-found errorKind, even with onRetry passed", () => {
    const onRetry = jest.fn();
    render(
      <PanelContent
        panel={makeOutputPanel()}
        error="You don't have access to this panel's data."
        errorKind="forbidden"
        onRetry={onRetry}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it('retryVariant="icon-only" renders the compact icon-only Retry control', () => {
    const onRetry = jest.fn();
    render(
      <PanelContent
        panel={makeOutputPanel()}
        error="Failed to load data."
        onRetry={onRetry}
        retryVariant="icon-only"
      />,
    );
    const retryBtn = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("PanelContent — no-data state", () => {
  it("shows the no-data message", () => {
    render(<PanelContent panel={makeOutputPanel()} noData={true} />);
    expect(screen.getByText("No data available")).toBeInTheDocument();
  });
});

describe("PanelContent — chart forwards all props to ChartPanel", () => {
  it("forwards fieldMapping, rawRows, and headers to ChartPanel", async () => {
    const fieldMapping = { xAxis: "date", yAxis: "price" };
    const rawRows = [["2024-01-01", "100"]];
    const headers = ["date", "price"];
    getOutputByIdMock.mockResolvedValue(makeOutput({ kind: "chart", config: { fieldMapping } }));
    render(<PanelContent panel={makeOutputPanel()} rawRows={rawRows} headers={headers} />);
    await screen.findByTestId("chart-panel");
    expect(capturedChartProps?.fieldMapping).toEqual(fieldMapping);
    expect(capturedChartProps?.rawRows).toEqual(rawRows);
    expect(capturedChartProps?.headers).toEqual(headers);
  });

  it("forwards an empty fieldMapping object to ChartPanel when the Output config has none", async () => {
    getOutputByIdMock.mockResolvedValue(makeOutput({ kind: "chart" }));
    render(<PanelContent panel={makeOutputPanel()} />);
    await screen.findByTestId("chart-panel");
    expect(capturedChartProps?.fieldMapping).toEqual({});
  });

  // HEL-301 — compact threads through to ChartPanel so the phone stack can
  // hide the legend / shrink axis labels (W5).
  it("forwards compact=true to ChartPanel", async () => {
    getOutputByIdMock.mockResolvedValue(makeOutput({ kind: "chart" }));
    render(<PanelContent panel={makeOutputPanel()} compact />);
    await screen.findByTestId("chart-panel");
    expect(capturedChartProps?.compact).toBe(true);
  });

  it("leaves compact undefined for the desktop grid (no compact prop passed)", async () => {
    getOutputByIdMock.mockResolvedValue(makeOutput({ kind: "chart" }));
    render(<PanelContent panel={makeOutputPanel()} />);
    await screen.findByTestId("chart-panel");
    expect(capturedChartProps?.compact).toBeUndefined();
  });
});

// HEL-323 — the chart annotation may be static (`config.annotation`) or bound
// (`data.annotation`); with the Output model, the static Output-config
// annotation always wins per PanelContent's literal-wins resolution.
describe("PanelContent — chart annotation resolution (HEL-323)", () => {
  it("renders the static config.annotation when set", async () => {
    getOutputByIdMock.mockResolvedValue(
      makeOutput({ kind: "chart", config: { annotation: "Fixed note" } }),
    );
    const { container } = render(<PanelContent panel={makeOutputPanel()} />);
    await screen.findByTestId("chart-panel");
    expect(container.querySelector(".chart-panel__annotation")).toHaveTextContent("Fixed note");
  });

  it("renders no annotation element when none is set", async () => {
    getOutputByIdMock.mockResolvedValue(makeOutput({ kind: "chart" }));
    const { container } = render(<PanelContent panel={makeOutputPanel()} />);
    await screen.findByTestId("chart-panel");
    expect(container.querySelector(".chart-panel__annotation")).not.toBeInTheDocument();
  });
});

describe("PanelContent — live table data", () => {
  it("renders live rows and headers", async () => {
    getOutputByIdMock.mockResolvedValue(makeOutput({ kind: "table" }));
    const { container } = renderWithStore(
      <PanelContent
        panel={makeOutputPanel()}
        rawRows={[
          ["1000", "North"],
          ["2000", "South"],
        ]}
        headers={["Revenue", "Region"]}
      />,
    );
    expect(await screen.findByText("Revenue")).toBeInTheDocument();
    expect(screen.getByText("North")).toBeInTheDocument();
    expect(screen.getByText("2000")).toBeInTheDocument();
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(2);
  });
});

// HEL-909: the metric trend indicator (`MetricRenderer`'s `data.trend`) has
// no surviving Output-config source — `MetricOutputConfig` carries no
// `trend` field and `OutputPanelContent` computes its metric `data` from
// the fetched Output's config + rows, never from a passed-through `data`
// prop. A genuine capability drop, not a rename — the prior describe block
// asserting trend rendering via a directly-passed `data` prop tested a path
// no output-kind panel can reach any more; deleted rather than rewritten.

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

  it("renders literal config.content unchanged for a Text panel (no data prop)", () => {
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
