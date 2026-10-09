// HEL-1378 -- the detail modal's initial chart state must not invent `chartType: "line"` for a panel
// that stores none (it would then outrank the bound Output's chartType in the editor's controls).

import { act, fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { makeOutputPanel } from "../../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../../pipelines/services/outputService";
import type { Output } from "../../../pipelines/types/output";
import { usePanelData } from "../../hooks/usePanelData";
import { defaultChartAppearance } from "../../../../theme/appearance";
import type { ChartAppearance } from "../../types/panel";
import { PanelDetailModal } from "./PanelDetailModal";

jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ option }: { option: unknown }) => (
    <div data-testid="echarts" data-option={JSON.stringify(option)} />
  ),
}));
jest.mock("../echartsCore", () => ({ __esModule: true, default: {} }));
jest.mock("../../hooks/usePanelData", () => ({ usePanelData: jest.fn() }));
jest.mock("../../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../../pipelines/services/outputService"),
  getOutputById: jest.fn(),
  getAssertionStatus: jest.fn(() => new Promise(() => {})),
  listOutputPanels: jest.fn(() => Promise.resolve([])),
  getDistinctValues: jest.fn(() => Promise.resolve({ values: [] })),
}));

// Wrap the real editor and capture the chartAppearance the modal hands it.
const mockCaptured: { chart?: ChartAppearance } = {};
jest.mock("../editors/AppearanceEditor", () => {
  const actual = jest.requireActual("../editors/AppearanceEditor");
  return {
    ...actual,
    AppearanceEditor: (props: { chartAppearance: ChartAppearance }) => {
      mockCaptured.chart = props.chartAppearance;
      return <actual.AppearanceEditor {...props} />;
    },
  };
});

const output: Output = {
  id: "output-1",
  pipelineId: "pipe-1",
  ownerId: "u1",
  name: "Revenue",
  kind: "chart",
  config: {
    chartType: "bar",
    fieldMapping: { xAxis: "region", yAxis: "amount" },
  },
  schema: [],
  createdAt: "",
  updatedAt: "",
};

beforeEach(() => {
  mockCaptured.chart = undefined;
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  jest.mocked(getOutputByIdRequest).mockResolvedValue(output);
  jest.mocked(usePanelData).mockReturnValue({
    data: null,
    rawRows: [["east", "10"]],
    headers: ["region", "amount"],
    isLoading: false,
    error: null,
    errorKind: null,
    noData: false,
    neverMaterialized: false,
    paginationRows: [{ region: "east", amount: 10 }],
    rowsTruncated: false,
    refresh: jest.fn(),
    isRefreshing: false,
  });
});

async function openEdit(panel: ReturnType<typeof makeOutputPanel>) {
  const rendered = renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />, {
    panels: { items: [panel] },
  });
  await screen.findByTestId("echarts");
  fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
  await act(async () => {}); // let the Output-meta / placements fetches settle
  return rendered;
}

describe("PanelDetailModal initial chart state (HEL-1378)", () => {
  it("carries no chartType when the panel stores none", async () => {
    await openEdit(makeOutputPanel({ id: "p1", title: "Revenue" }));
    expect(mockCaptured.chart).toBeDefined();
    expect(mockCaptured.chart).not.toHaveProperty("chartType");
  });

  it("passes a stored chartType through", async () => {
    const panel = makeOutputPanel({
      id: "p1",
      title: "Revenue",
      appearance: {
        background: "transparent",
        color: "inherit",
        transparency: 0,
        chart: { ...defaultChartAppearance, chartType: "pie" },
      },
    });
    await openEdit(panel);
    expect(mockCaptured.chart?.chartType).toBe("pie");
  });

  it("regression guard (not a red test): a title-only save writes no appearance.chart", async () => {
    const { store } = await openEdit(makeOutputPanel({ id: "p1", title: "Revenue" }));
    fireEvent.change(screen.getByLabelText("Panel title"), { target: { value: "Revenue v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));
    const pending = store.getState().panels.pendingPanelUpdates["p1"];
    expect(pending.appearance).toBeDefined();
    expect(pending.appearance).not.toHaveProperty("chart");
    expect(JSON.stringify(pending)).not.toContain("chartType");
  });
});
