// HEL-1351 design D2/D7 — the detail modal renders an aggregated chart Output grouped (it supplies the
// loaded record rows), uses the Output's chartType when the panel stores none, and its save payload
// never writes `appearance.chart` (so the inherited type is never frozen into the panel).

import { fireEvent, screen } from "@testing-library/react";

import { renderWithStore } from "../../../../test/renderWithStore";
import { makeOutputPanel } from "../../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../../pipelines/services/outputService";
import type { Output } from "../../../pipelines/types/output";
import { usePanelData } from "../../hooks/usePanelData";
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
}));

const records: Record<string, unknown>[] = [
  { region: "east", amount: 10 },
  { region: "east", amount: 5 },
  { region: "west", amount: 7 },
];
const output: Output = {
  id: "output-1",
  pipelineId: "pipe-1",
  ownerId: "u1",
  name: "Revenue",
  kind: "chart",
  config: {
    chartType: "bar",
    fieldMapping: { xAxis: "region", yAxis: "amount" },
    aggregation: { groupBy: "region", agg: "sum", yField: "amount" },
  },
  schema: [],
  createdAt: "",
  updatedAt: "",
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
  jest.mocked(getOutputByIdRequest).mockResolvedValue(output);
  jest.mocked(usePanelData).mockReturnValue({
    data: null,
    rawRows: [
      ["east", "10"],
      ["east", "5"],
      ["west", "7"],
    ],
    headers: ["region", "amount"],
    isLoading: false,
    error: null,
    errorKind: null,
    noData: false,
    neverMaterialized: false,
    paginationRows: records,
    rowsTruncated: false,
    refresh: jest.fn(),
    isRefreshing: false,
  });
});

describe("PanelDetailModal aggregated chart Output (HEL-1351)", () => {
  it("renders the grouped bars (the Output's type) for a panel with no stored chart type", async () => {
    const panel = makeOutputPanel({ id: "p1", title: "Revenue" });
    renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />, {
      panels: { items: [panel] },
    });
    const chart = await screen.findByTestId("echarts");
    const opt = JSON.parse(chart.getAttribute("data-option") ?? "{}") as {
      xAxis?: { data?: unknown[] };
      series?: { type?: string; name?: string; data?: unknown[] }[];
    };
    expect(opt.xAxis?.data).toEqual(["east", "west"]);
    expect(opt.series?.[0]).toMatchObject({ type: "bar", name: "sum(amount)", data: [15, 7] });
  });

  it("saving does not write appearance.chart", async () => {
    const panel = makeOutputPanel({ id: "p1", title: "Revenue" });
    const { store } = renderWithStore(<PanelDetailModal panel={panel} onClose={jest.fn()} />, {
      panels: { items: [panel] },
    });
    await screen.findByTestId("echarts");
    fireEvent.click(screen.getByRole("button", { name: "Edit panel" }));
    fireEvent.change(screen.getByLabelText("Panel title"), { target: { value: "Revenue v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save panel settings" }));

    const pending = store.getState().panels.pendingPanelUpdates["p1"];
    expect(pending).toBeDefined();
    expect(pending.appearance).toBeDefined();
    expect(pending.appearance).not.toHaveProperty("chart");
  });
});
