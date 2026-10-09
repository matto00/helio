import { act, screen } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../pipelines/services/outputService";
import { usePanelData } from "../hooks/usePanelData";
import { usePanelPolling } from "../hooks/usePanelPolling";
import { usePanelRunRefresh } from "../hooks/usePanelRunRefresh";
import { defaultChartAppearance } from "../../../theme/appearance";
import type { PanelAppearance, PanelPaginationState } from "../types/panel";
import type { Output } from "../../pipelines/types/output";
import { PanelCard } from "./PanelCard";

// HEL-1351 design D2/D3/D7 — an aggregated chart Output on a dashboard card: it plots grouped values,
// its clicks select on the aggregation's groupBy, Inspect lists the clicked group's loaded RECORDS,
// and the panel-or-Output chart-type resolver drives render, click mapping and Inspect together.

type MockClickHandlers = Record<string, (params: unknown) => void>;
interface MockChartNode extends HTMLDivElement {
  __onEvents?: MockClickHandlers;
}
jest.mock("echarts-for-react/esm/core", () => ({
  __esModule: true,
  default: ({ option, onEvents }: { option: unknown; onEvents?: MockClickHandlers }) => (
    <div
      ref={(el) => {
        if (el) (el as MockChartNode).__onEvents = onEvents;
      }}
      data-testid="echarts"
      data-option={JSON.stringify(option)}
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

const getOutputByIdMock = jest.mocked(getOutputByIdRequest);

const headers = ["region", "amount", "ref"];
const records: Record<string, unknown>[] = [
  { region: "east", amount: 10, ref: "r-east-1" },
  { region: "east", amount: 5, ref: "r-east-2" },
  { region: "west", amount: 7, ref: "r-west-1" },
  { region: null, amount: 2, ref: "r-null-1" },
];
const rawRows = records.map((r) => Object.values(r).map((v) => (v == null ? "" : String(v))));

function makeOutput(config: Record<string, unknown>): Output {
  return {
    id: "output-1",
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Revenue",
    kind: "chart",
    config,
    schema: [],
    createdAt: "",
    updatedAt: "",
  };
}
const BAR_AGG = {
  chartType: "bar",
  fieldMapping: { xAxis: "region", yAxis: "amount" },
  aggregation: { groupBy: "region", agg: "sum", yField: "amount" },
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  });
  jest.clearAllMocks();
  jest.mocked(usePanelPolling).mockReturnValue(undefined);
  jest.mocked(usePanelRunRefresh).mockReturnValue(undefined);
  jest.mocked(usePanelData).mockReturnValue({
    data: null,
    rawRows,
    headers,
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
  getOutputByIdMock.mockResolvedValue(makeOutput(BAR_AGG));
});

function renderCard(appearance?: PanelAppearance) {
  const panel = makeOutputPanel({ title: "Revenue", ...(appearance ? { appearance } : {}) });
  const entry: PanelPaginationState = {
    currentPage: 0,
    hasMore: false,
    isLoadingMore: false,
    rows: records,
    materialized: true,
    total: records.length,
  };
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
    { panels: { items: [panel], paginationState: { [panel.id]: entry } } },
  );
}

interface OptionShape {
  xAxis?: { data?: unknown[] };
  series?: { type?: string; name?: string; data?: unknown[] }[];
}
function optionOf(el: HTMLElement): OptionShape {
  return JSON.parse(el.getAttribute("data-option") ?? "{}") as OptionShape;
}

describe("PanelCard aggregated chart Output (HEL-1351)", () => {
  it("plots one value per group, named <agg>(<yField>), as bars (the Output's type)", async () => {
    renderCard();
    const chart = await screen.findByTestId("echarts");
    const opt = optionOf(chart);
    expect(opt.xAxis?.data).toEqual(["east", "null", "west"]);
    expect(opt.series?.[0]).toMatchObject({ type: "bar", name: "sum(amount)", data: [15, 2, 7] });
  });

  it("an explicitly stored panel chartType wins over the Output's", async () => {
    renderCard({
      background: "#fff",
      color: "#000",
      transparency: 1,
      chart: { ...defaultChartAppearance, chartType: "line" },
    });
    const opt = optionOf(await screen.findByTestId("echarts"));
    expect(opt.series?.[0]?.type).toBe("line");
  });

  it("a click selects on the groupBy dimension and Inspect lists exactly that group's rows", async () => {
    renderCard();
    const chart = (await screen.findByTestId("echarts")) as MockChartNode;
    act(() => {
      chart.__onEvents?.click({ componentType: "series", name: "west", seriesName: "sum(amount)" });
    });
    expect(
      await screen.findByText("Showing rows for region: west / sum(amount)"),
    ).toBeInTheDocument();
    expect(screen.getByText("r-west-1")).toBeInTheDocument();
    expect(screen.queryByText("r-east-1")).not.toBeInTheDocument();
    expect(screen.queryByText("r-null-1")).not.toBeInTheDocument();
  });

  it("a click on the 'vs' overlay series still selects the primary series name", async () => {
    renderCard();
    const chart = (await screen.findByTestId("echarts")) as MockChartNode;
    act(() => {
      chart.__onEvents?.click({ componentType: "series", name: "east", seriesName: "vs 7d" });
    });
    expect(
      await screen.findByText("Showing rows for region: east / sum(amount)"),
    ).toBeInTheDocument();
    expect(screen.getByText("r-east-1")).toBeInTheDocument();
    expect(screen.getByText("r-east-2")).toBeInTheDocument();
  });

  it("the null group plots as 'null' but a click selects blank (HEL-1408 D10a) and Inspect lists its null-keyed record", async () => {
    renderCard();
    const chart = (await screen.findByTestId("echarts")) as MockChartNode;
    act(() => {
      chart.__onEvents?.click({ componentType: "series", name: "null", seriesName: "sum(amount)" });
    });
    // The blank selection header reads `region: ` (empty); whitespace collapses in the matcher.
    expect(await screen.findByText("Showing rows for region: / sum(amount)")).toBeInTheDocument();
    expect(screen.getByText("r-null-1")).toBeInTheDocument();
    expect(screen.queryByText("r-east-1")).not.toBeInTheDocument();
  });

  it("a panel whose stored type is scatter on an aggregated bar Output keeps xAxis keying", async () => {
    getOutputByIdMock.mockResolvedValue(
      makeOutput({ ...BAR_AGG, fieldMapping: { xAxis: "amount", yAxis: "amount" } }),
    );
    renderCard({
      background: "#fff",
      color: "#000",
      transparency: 1,
      chart: { ...defaultChartAppearance, chartType: "scatter" },
    });
    const chart = (await screen.findByTestId("echarts")) as MockChartNode;
    expect(optionOf(chart).series?.[0]?.type).toBe("scatter");
    act(() => {
      chart.__onEvents?.click({ componentType: "series", value: [10, 10] });
    });
    // fieldMapping.xAxis keying (`amount`), never the aggregation's groupBy (`region`).
    expect(await screen.findByText("Showing rows for amount: 10 / amount")).toBeInTheDocument();
    expect(screen.getByText("r-east-1")).toBeInTheDocument();
  });

  it("Inspect falls back to raw-row keying while no record rows are loaded (no empty Inspect)", async () => {
    jest.mocked(usePanelData).mockReturnValue({
      ...jest.mocked(usePanelData)(makeOutputPanel()),
      paginationRows: null,
    });
    renderCard();
    const chart = (await screen.findByTestId("echarts")) as MockChartNode;
    act(() => {
      chart.__onEvents?.click({ componentType: "series", name: "west", seriesName: "sum(amount)" });
    });
    await screen.findByText(/Showing rows for region: west/);
    expect(screen.getByText("r-west-1")).toBeInTheDocument();
  });
});
