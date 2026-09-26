import { act, fireEvent, screen, within } from "@testing-library/react";

import { renderWithStore } from "../../../test/renderWithStore";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputById as getOutputByIdRequest } from "../../pipelines/services/outputService";
import { usePanelData } from "../hooks/usePanelData";
import { usePanelPolling } from "../hooks/usePanelPolling";
import { usePanelRunRefresh } from "../hooks/usePanelRunRefresh";
import type { Output } from "../../pipelines/types/output";
import { PanelCard } from "./PanelCard";

// HEL-588 tasks.md 6.5/6.6 — a dedicated file (mirrors PanelCard.inspect.test.tsx's own
// rationale) covering the cross-filter's effect at PanelCard's usePanelData call site: a sibling
// panel narrows, the originating panel never does, and an unmatched panel is unaffected.

// evaluation-3.md CR2 — same echarts mock as PanelCard.inspect.test.tsx, needed
// only by the "grid vs Fullscreen Inspect agreement" describe block below
// (harmless for the table/metric tests above, which never render ChartPanel).
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

const headers = ["quarter", "revenue"];
const rawRows = [
  ["Q1", "100"],
  ["Q1", "150"],
  ["Q2", "120"],
];

// evaluation-1.md CR1 — the SAME three rows, but in the keyed-record shape
// `usePanelData`'s real `fetchPanelPage(page: 0)` dispatch actually populates
// `paginationState[panelId].rows` with (native typed values, e.g. a number
// for revenue — not `usePanelData`'s own already-stringified `rawRows`).
// `TableRenderer` prefers THIS shape (via `paginationRows`) over `rawRows`
// whenever it's non-empty, which is what production always has by the time
// a panel renders (`usePanelData.ts` fetches page 0 unconditionally on
// mount) — a test that never seeds this masks exactly the live defect CR1
// fixes, since it only exercises the `rawRows` fallback branch that exists
// in production for a single frame before the first fetch resolves.
const paginationRows = [
  { quarter: "Q1", revenue: 100 },
  { quarter: "Q1", revenue: 150 },
  { quarter: "Q2", revenue: 120 },
];

function makeTableOutput(overrides: Partial<Output> = {}): Output {
  return {
    id: "output-1",
    pipelineId: "pipe-1",
    ownerId: "u1",
    name: "Revenue",
    kind: "table",
    config: { fieldMapping: {}, columnOrder: ["quarter", "revenue"] },
    schema: [],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

beforeEach(() => {
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
});

function renderPanelCard(
  panelId: string,
  options: { seedPaginationRows?: Record<string, unknown>[] } = {},
) {
  const panel = makeOutputPanel({ id: panelId, title: "Revenue" });
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
    {
      panels: {
        items: [panel],
        crossFilter: { panelId: "origin-panel", dimension: "quarter", value: "Q1", series: "" },
        ...(options.seedPaginationRows
          ? {
              paginationState: {
                [panelId]: {
                  currentPage: 0,
                  hasMore: false,
                  isLoadingMore: false,
                  rows: options.seedPaginationRows,
                  materialized: true,
                },
              },
            }
          : {}),
      },
    },
  );
}

describe("PanelCard — HEL-588 cross-filter application (tasks.md 6.5)", () => {
  // evaluation-1.md CR1/CR2 — seeds `paginationState[panelId]` (what a real
  // `fetchPanelPage(page: 0)` dispatch produces) so this test exercises
  // `TableRenderer`'s REAL `paginationRows`-preferred branch, not the
  // `rawRows` fallback that only exists in production before the first
  // page-0 fetch resolves. Without this seed, this test previously passed
  // while the live app's Table grid never actually narrowed (only its
  // truncation disclosure, built from `rawRows`, did) — see
  // `PanelCard.tsx`'s `filteredPaginationRows` for the fix this test guards.
  it("narrows a sibling table panel to the matching subset", async () => {
    getOutputByIdMock.mockResolvedValue(makeTableOutput());
    renderPanelCard("panel-sibling", { seedPaginationRows: paginationRows });

    await screen.findByRole("table");
    expect(screen.getAllByText("Q1")).toHaveLength(2);
    expect(screen.queryByText("Q2")).not.toBeInTheDocument();
    expect(screen.queryByText("120")).not.toBeInTheDocument();
  });

  it("never narrows the originating panel's own data", async () => {
    getOutputByIdMock.mockResolvedValue(makeTableOutput());
    renderPanelCard("origin-panel", { seedPaginationRows: paginationRows });

    await screen.findByRole("table");
    expect(screen.getAllByText("Q1")).toHaveLength(2);
    expect(screen.getByText("Q2")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
  });

  it("leaves a panel unaffected when its field mapping doesn't reference the filter's dimension", async () => {
    // columnOrder omits "quarter" entirely — the table's own effective
    // displayed-column set never references the cross-filter's dimension.
    getOutputByIdMock.mockResolvedValue(makeTableOutput({ config: { columnOrder: ["revenue"] } }));
    renderPanelCard("panel-sibling", { seedPaginationRows: paginationRows });

    await screen.findByRole("table");
    // All three rows' revenue values are still present — nothing was narrowed.
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
  });
});

// HEL-588 tasks.md 6.6 — a metric/aggregating panel recomputes from the
// filtered subset (design.md D5: no new code needed — OutputPanelContent
// already derives fresh from whatever rawRows/headers it's given).
describe("PanelCard — HEL-588 metric panel recomputes over the filtered subset (tasks.md 6.6)", () => {
  function makeMetricOutput(): Output {
    return {
      id: "output-1",
      pipelineId: "pipe-1",
      ownerId: "u1",
      name: "Revenue total",
      kind: "metric",
      // `dimension` here is an arbitrary fieldMapping KEY — only the VALUE
      // ("quarter") matters to `isPanelFilterableByDimension` (Object.values).
      // ORDER matters for a DIFFERENT reason: `OutputPanelContent`'s metric
      // branch resolves its value column as `Object.values(fieldMapping)[0]`
      // (insertion order, not key name) — "value" must come FIRST or the
      // metric would compute its aggregate over "quarter" instead of
      // "revenue" (probe-confirmed: with "dimension" first this rendered
      // "0", since summing the non-numeric "quarter" column coerces to zero).
      config: {
        fieldMapping: { value: "revenue", dimension: "quarter" },
        aggregation: { value: "revenue", agg: "sum" },
      },
      schema: [],
      createdAt: "",
      updatedAt: "",
    };
  }

  it("a sibling metric panel's displayed value is the SUM over the filtered subset, not the full loaded set", async () => {
    getOutputByIdMock.mockResolvedValue(makeMetricOutput());
    renderPanelCard("panel-sibling");

    // Full-set sum would be 100 + 150 + 120 = 370; filtered (Q1 only) is 250.
    expect(await screen.findByText("250")).toBeInTheDocument();
    expect(screen.queryByText("370")).not.toBeInTheDocument();
  });

  it("the originating metric panel still shows the FULL sum, unfiltered", async () => {
    getOutputByIdMock.mockResolvedValue(makeMetricOutput());
    renderPanelCard("origin-panel");

    expect(await screen.findByText("370")).toBeInTheDocument();
  });
});

// skeptic-final-1.md CR1/CR2 — the Fullscreen overlay's D7 truncation
// disclosure must agree with the grid card's for the SAME panel/filter
// state: both derive `loadedCount` from the panel's TRUE total loaded row
// count, never the post-filter match count. A prior wiring passed the
// ALREADY cross-filtered rawRows/headers into `PanelFullscreenOverlay`,
// which left the rendered rows correct (idempotent re-filter) but corrupted
// `crossFilterLoadedRowCount` down to the match count — this test seeds
// `rowsTruncated: true` on a sibling panel and opens ITS Fullscreen overlay
// specifically, asserting the loaded-count denominator, not just the
// narrowed numerator (which `PanelFullscreenOverlay.test.tsx` alone cannot
// catch, since it never renders through `PanelCard`'s own wiring).
describe("PanelCard — HEL-588 Fullscreen disclosure agrees with the grid card (skeptic-final-1.md CR1/CR2)", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
  });

  it("the Fullscreen overlay's disclosure reports the panel's TRUE loaded row count, matching the grid card", async () => {
    getOutputByIdMock.mockResolvedValue(makeTableOutput());
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
      rowsTruncated: true,
      refresh: jest.fn(),
      isRefreshing: false,
    });
    renderPanelCard("panel-sibling", { seedPaginationRows: paginationRows });

    // Grid-context disclosure: 2 of the 3 loaded rows match "Q1".
    await screen.findByRole("table");
    expect(await screen.findByText("2 of 3 loaded rows match.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fullscreen Revenue" }));
    const fullscreenDialog = screen.getByRole("dialog", { name: "Revenue fullscreen" });

    // Fullscreen-context disclosure for the SAME panel/filter state must
    // read the SAME "2 of 3" — never "2 of 2" (the bug: the denominator
    // collapsing to the already-filtered match count).
    expect(
      await within(fullscreenDialog).findByText("2 of 3 loaded rows match."),
    ).toBeInTheDocument();
    expect(
      within(fullscreenDialog).queryByText("2 of 2 loaded rows match."),
    ).not.toBeInTheDocument();
  });
});

// evaluation-3.md CR1/CR2 — the grid-context and Fullscreen-nested
// `PanelInspectView` mounts must show the SAME row content for the identical
// click selection while a cross-filter is active, using a DIMENSION-MISMATCH
// panel (per evaluation-3.md's own repro rationale: a same-dimension panel
// masks this exact bug, since the cross-filter's own narrowing and the
// click-selection's narrowing would coincide either way).
describe("PanelCard — HEL-588 grid vs Fullscreen Inspect agree on row content (evaluation-3.md CR1/CR2)", () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = jest.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    HTMLDialogElement.prototype.close = jest.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    });
  });

  // Plotted by "region", filterable by "quarter" via an unrelated
  // fieldMapping slot — no correlation between the two columns, so the
  // dashboard's quarter=Q1 cross-filter and a region=West click selection
  // narrow to DIFFERENT, overlapping-but-not-identical subsets: this is what
  // makes "Fullscreen silently uses the wrong (unfiltered) rows" visible.
  function makeChartOutput(): Output {
    return {
      id: "output-1",
      pipelineId: "pipe-1",
      ownerId: "u1",
      name: "Revenue",
      kind: "chart",
      config: {
        chartType: "line",
        fieldMapping: { xAxis: "region", yAxis: "revenue", annotation: "quarter" },
      },
      schema: [],
      createdAt: "",
      updatedAt: "",
    };
  }

  const chartHeaders = ["region", "revenue", "quarter"];
  const chartRawRows = [
    ["East", "100", "Q1"],
    ["West", "105", "Q1"],
    ["East", "200", "Q2"],
    ["West", "205", "Q2"],
    ["East", "300", "Q3"],
    ["West", "305", "Q3"],
    ["East", "400", "Q4"],
    ["West", "405", "Q4"],
  ];

  it("Fullscreen's nested Inspect shows the SAME narrowed row as the grid card's, not every quarter", async () => {
    getOutputByIdMock.mockResolvedValue(makeChartOutput());
    mockUsePanelData.mockReturnValue({
      data: null,
      rawRows: chartRawRows,
      headers: chartHeaders,
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
    // crossFilter dimension="quarter", value="Q1" (renderPanelCard's default).
    renderPanelCard("panel-sibling");

    // --- Grid-context: click "West" on the chart, open Inspect, assert exactly 1 row.
    const gridChart = (await screen.findAllByTestId("echarts"))[0] as MockChartNode;
    fireEvent.click(screen.getByRole("button", { name: "Revenue panel actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Inspect" }));
    const gridInspect = screen.getByRole("dialog", { name: "Inspect Revenue" });
    // Nothing selected yet — click the chart now that Inspect is mounted.
    // `act(...)` (not a bare call) flushes Modal's `[open]` effect
    // synchronously — without it, `showModal()` never actually runs in this
    // test environment, matching PanelCard.inspect.test.tsx's own pattern.
    act(() => {
      gridChart.__onEvents?.click({ componentType: "series", name: "West" });
    });

    await within(gridInspect).findByText("Showing rows for region: West");
    expect(within(gridInspect).getByText("105")).toBeInTheDocument();
    expect(within(gridInspect).queryByText("205")).not.toBeInTheDocument();
    expect(within(gridInspect).queryByText("305")).not.toBeInTheDocument();
    expect(within(gridInspect).queryByText("405")).not.toBeInTheDocument();

    // --- Fullscreen: open it, click its OWN chart instance for the same "West" point.
    // (The grid Inspect is left open — jsdom has no real dialog-stacking to
    // worry about, and every query below is scoped `within(fullscreenDialog)`
    // so it can never accidentally match the grid's own still-open Inspect.)
    fireEvent.click(screen.getByRole("button", { name: "Fullscreen Revenue" }));
    const fullscreenDialog = screen.getByRole("dialog", { name: "Revenue fullscreen" });
    // Fullscreen's OWN `OutputPanelContent` resolves its Output via a SECOND,
    // independent `useOutputMeta` fetch (the established HEL-572/HEL-579
    // "second fetch is fine" precedent) — `findByTestId` waits out that
    // resolve tick rather than assuming it's already settled.
    const fullscreenChart = (await within(fullscreenDialog).findByTestId(
      "echarts",
    )) as MockChartNode;
    act(() => {
      fullscreenChart.__onEvents?.click({ componentType: "series", name: "West" });
    });

    const fullscreenInspect = within(fullscreenDialog).getByRole("dialog", {
      name: "Inspect Revenue",
    });
    await within(fullscreenInspect).findByText("Showing rows for region: West");

    // THE regression this test guards: Fullscreen's nested Inspect must show
    // the SAME single Q1/West row — never all 4 quarters' West rows (the bug:
    // a shared, un-filtered rawRows/headers prop feeding both PanelContent
    // and the nested Inspect).
    expect(within(fullscreenInspect).getByText("105")).toBeInTheDocument();
    expect(within(fullscreenInspect).queryByText("205")).not.toBeInTheDocument();
    expect(within(fullscreenInspect).queryByText("305")).not.toBeInTheDocument();
    expect(within(fullscreenInspect).queryByText("405")).not.toBeInTheDocument();
  });
});
