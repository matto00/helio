import { act, fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../pipelines/services/outputService";
import { usePanelData } from "../hooks/usePanelData";
import { usePanelPolling } from "../hooks/usePanelPolling";
import { usePanelRunRefresh } from "../hooks/usePanelRunRefresh";
import type { Output } from "../../pipelines/types/output";
import { PanelCard } from "./PanelCard";

// HEL-572 — a dedicated file (mirrors ChartPanel.click.test.tsx's own
// rationale) covering tasks.md 4.2 (grid click → inspect, listing exactly
// the matching rows) and 5.1 (ActionsMenu "Inspect" item), rather than
// growing the already-large PanelCard.test.tsx further.

type MockClickHandlers = Record<string, (params: unknown) => void>;
interface MockChartNode extends HTMLDivElement {
  __onEvents?: MockClickHandlers;
}

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ onEvents }: { option: unknown; onEvents?: MockClickHandlers }) => (
    <div
      ref={(el) => {
        if (el) (el as MockChartNode).__onEvents = onEvents;
      }}
      data-testid="echarts"
    />
  ),
}));
jest.mock("./echartsCore", () => ({ __esModule: true, default: {} }));

jest.mock("../hooks/usePanelData", () => ({ usePanelData: jest.fn() }));
jest.mock("../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../hooks/usePanelRunRefresh", () => ({ usePanelRunRefresh: jest.fn() }));
jest.mock("../../pipelines/services/outputService", () => ({
  getAssertionStatus: jest.fn(() => new Promise(() => {})),
  getOutputById: jest.fn(),
}));

const mockUsePanelData = jest.mocked(usePanelData);
const mockUsePanelPolling = jest.mocked(usePanelPolling);
const mockUsePanelRunRefresh = jest.mocked(usePanelRunRefresh);
const getOutputByIdMock = jest.mocked(getOutputByIdRequest);

const headers = ["quarter", "region", "revenue"];
const rawRows = [
  ["Q1", "East", "100"],
  ["Q1", "West", "150"],
  ["Q2", "East", "120"],
];

function makeChartOutput(overrides: Partial<Output> = {}): Output {
  return {
    id: "output-1",
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Revenue",
    kind: "chart",
    config: { fieldMapping: { xAxis: "quarter", yAxis: "revenue", series: "region" } },
    schema: [],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

// jsdom does not implement showModal/close natively — mirrors
// PanelFullscreenOverlay.test.tsx's own stub (needed here because
// PanelInspectView, unconditionally mounted once chart-eligible, wraps a
// real Modal).
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  });
  jest.clearAllMocks();
  mockUsePanelPolling.mockReturnValue(undefined);
  mockUsePanelRunRefresh.mockReturnValue(undefined);
  mockUsePanelData.mockReturnValue({
    data: null,
    rawRows,
    headers,
    isLoading: false,
    error: null,
    errorKind: null,
    noData: false,
    neverMaterialized: false,
    chartAggregate: null,
    rowsTruncated: false,
    refresh: jest.fn(),
    isRefreshing: false,
  });
  getOutputByIdMock.mockResolvedValue(makeChartOutput());
});

function renderChartPanelCard() {
  const panel = makeOutputPanel({ title: "Revenue" });
  return renderWithStore(
    <PanelCard
      panel={panel}
      theme="dark"
      isDragging={false}
      dashboardId="dashboard-1"
      isEditingTitle={false}
      editingTitle=""
      editingTitleError={null}
      isConfirmingDelete={false}
      onMouseDown={jest.fn()}
      onCardClick={jest.fn()}
      onStartEdit={jest.fn()}
      onTitleChange={jest.fn()}
      onTitleKeyDown={jest.fn()}
      onTitleBlur={jest.fn()}
      onRequestDelete={jest.fn()}
      onCancelDelete={jest.fn()}
      onDetail={jest.fn()}
    />,
  );
}

describe("PanelCard — HEL-572 tasks.md 4.2 (grid click → inspect)", () => {
  it("clicking a chart element opens the inspect view listing exactly the matching rows", async () => {
    renderChartPanelCard();
    const chart = (await screen.findByTestId("echarts")) as MockChartNode;

    act(() => {
      chart.__onEvents?.click({ componentType: "series", name: "Q1", seriesName: "West" });
    });

    expect(await screen.findByText("Showing rows for quarter: Q1 / West")).toBeInTheDocument();
    expect(screen.getByText("West")).toBeInTheDocument();
    expect(screen.queryByText("East")).not.toBeInTheDocument();
  });
});

describe("PanelCard — HEL-572 tasks.md 5.1 (ActionsMenu Inspect item)", () => {
  it("shows an Inspect item for a chart-eligible panel", async () => {
    renderChartPanelCard();
    await screen.findByTestId("echarts");
    fireEvent.click(screen.getByRole("button", { name: "Revenue panel actions" }));

    expect(screen.getByRole("menuitem", { name: "Inspect" })).toBeInTheDocument();
  });

  it("does NOT show an Inspect item for a non-chart-eligible panel (table output)", async () => {
    getOutputByIdMock.mockResolvedValue(makeChartOutput({ kind: "table", config: {} }));
    renderChartPanelCard();
    await screen.findByRole("button", { name: "Revenue panel actions" });
    fireEvent.click(screen.getByRole("button", { name: "Revenue panel actions" }));

    expect(screen.queryByRole("menuitem", { name: "Inspect" })).not.toBeInTheDocument();
  });

  it("opens the inspect view's empty state when nothing is selected yet", async () => {
    renderChartPanelCard();
    await screen.findByTestId("echarts");
    fireEvent.click(screen.getByRole("button", { name: "Revenue panel actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Inspect" }));

    expect(await screen.findByText("Nothing selected")).toBeInTheDocument();
  });

  it("opens the inspect view for the panel's current selection when one exists", async () => {
    renderChartPanelCard();
    const chart = (await screen.findByTestId("echarts")) as MockChartNode;
    act(() => {
      chart.__onEvents?.click({ componentType: "series", name: "Q2", seriesName: "East" });
    });
    await screen.findByText("Showing rows for quarter: Q2 / East");
    // spec.md — dismissing via Modal's own × button closes the view WITHOUT
    // clearing the selection (only the explicit "Clear selection" control
    // does); reopening via the ActionsMenu below must therefore still find
    // this same selection.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    fireEvent.click(screen.getByRole("button", { name: "Revenue panel actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Inspect" }));

    expect(await screen.findByText("Showing rows for quarter: Q2 / East")).toBeInTheDocument();
  });
});
