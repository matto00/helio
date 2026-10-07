// HEL-1326 — a metric panel under a server-applied viewer filter shows the metric over the FULL
// filtered set (returned with the page-0 rows response), not an aggregate of the loaded rows. Drives
// the real chain from a mocked rows response: getOutputRows -> fetchPanelPage -> panelsSlice ->
// PanelCardBody -> PanelContent -> MetricOutputPanel (no prop injection of the value).

import { configureStore, type UnknownAction } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter, useSearchParams } from "react-router-dom";

import { makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputId } from "../state/panelNarrowing";
import { panelsReducer } from "../state/panelsSlice";
import { authReducer } from "../../auth/state/authSlice";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import { usePanelData } from "../hooks/usePanelData";
import * as outputService from "../../pipelines/services/outputService";
import * as historyService from "../history/outputHistoryService";
import { resetHistoryCache } from "../history/outputHistoryCache";
import { resetComparisonStore } from "../history/metricComparisonStore";
import type { FilteredMetric } from "../../pipelines/services/outputService";
import type { Output } from "../../pipelines/types/output";
import { PanelCardBody } from "./PanelCard";
import type { Panel } from "../types/panel";

jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
  getOutputById: jest.fn(),
  getAssertionStatus: jest.fn(),
  getFilterCapabilities: jest.fn(),
  getDistinctValues: jest.fn(),
}));
jest.mock("../history/outputHistoryService", () => ({
  fetchOutputHistory: jest.fn(),
  fetchPublicOutputHistory: jest.fn(),
}));
jest.mock("../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../hooks/usePanelRunRefresh", () => ({ usePanelRunRefresh: jest.fn() }));
jest.mock("../services/pipelineRunFanout", () => ({
  subscribeToPipelineTerminal: jest.fn(() => jest.fn()),
}));

const mockGetOutputRows = jest.mocked(outputService.getOutputRows);
const mockGetOutputById = jest.mocked(outputService.getOutputById);
const mockGetAssertionStatus = jest.mocked(outputService.getAssertionStatus);
const mockGetCapabilities = jest.mocked(outputService.getFilterCapabilities);
const mockGetDistinct = jest.mocked(outputService.getDistinctValues);
const mockFetchHistory = jest.mocked(historyService.fetchOutputHistory);

const SUM_CONFIG = {
  fieldMapping: {},
  aggregation: { value: "amount", agg: "sum" },
  format: "integer",
};

function makeMetricOutput(config: Record<string, unknown>): Output {
  return {
    id: "output-1",
    pipelineId: "pipeline-1",
    ownerId: "u1",
    name: "Revenue",
    kind: "metric",
    config,
    schema: [{ name: "amount", type: "integer" }],
    createdAt: "",
    updatedAt: "",
  };
}

// The first 200 rows of the FILTERED set sum to 1700 (700 + 1000); the filtered set has 500 rows and
// sums to 4200 server-side.
const FILTERED_PAGE = [
  { amount: 700, region: "east" },
  { amount: 1000, region: "east" },
];

function Harness({ panel }: { panel: Panel }) {
  const outputId = getOutputId(panel);
  const panelData = usePanelData(panel);
  const [, setSearchParams] = useSearchParams();
  return (
    <>
      <button type="button" onClick={() => setSearchParams({}, { replace: true })}>
        clear viewer filter
      </button>
      <PanelCardBody
        panel={panel}
        frozen={false}
        outputId={outputId}
        data={panelData.data}
        rawRows={panelData.rawRows}
        headers={panelData.headers}
        isLoading={panelData.isLoading}
        error={panelData.error}
        errorKind={panelData.errorKind}
        noData={panelData.noData}
        neverMaterialized={panelData.neverMaterialized}
        rowsTruncated={panelData.rowsTruncated}
        refresh={panelData.refresh}
      />
    </>
  );
}

function renderPanel(panel: Panel, url: string) {
  const seed = panelsReducer(undefined, { type: "@@INIT" } as UnknownAction);
  const store = configureStore({
    reducer: { panels: panelsReducer, toasts: toastsReducer, auth: authReducer } as never,
    preloadedState: {
      panels: { ...seed, items: [panel] },
      toasts: { items: [] },
      auth: authReducer(undefined, { type: "@@INIT" } as UnknownAction),
    } as never,
  });
  render(
    <MemoryRouter initialEntries={[url]}>
      <Provider store={store}>
        <Harness panel={panel} />
      </Provider>
    </MemoryRouter>,
  );
  return store;
}

/** A faithful server: the filtered response carries `metric` only when a filter was sent. */
function serverRows(metric: FilteredMetric) {
  mockGetOutputRows.mockImplementation(async (_id, _offset, _limit, _sort, filter) =>
    filter?.ops?.length
      ? { items: FILTERED_PAGE, total: 500, offset: 0, limit: 200, materialized: true, metric }
      : {
          items: [...FILTERED_PAGE, { amount: 300, region: "west" }],
          total: 900,
          offset: 0,
          limit: 200,
          materialized: true,
        },
  );
}

const CONTROL = { id: "c1", kind: "dropdown" as const, column: "region", label: "Region" };
const panelWithControl = () => makeOutputPanel({ id: "panel-1", config: { controls: [CONTROL] } });

beforeEach(() => {
  jest.clearAllMocks();
  resetHistoryCache();
  resetComparisonStore();
  mockGetOutputById.mockResolvedValue(makeMetricOutput(SUM_CONFIG));
  mockGetAssertionStatus.mockResolvedValue({
    outputId: "output-1",
    invalid: false,
    failedRuleCount: 0,
  });
  mockGetCapabilities.mockResolvedValue({
    columns: [{ column: "region", operators: ["eq", "in"], controlKinds: ["dropdown"] }],
  });
  mockGetDistinct.mockResolvedValue({ column: "region", values: [] });
  // No history yet, so the only possible headline sources are the loaded rows and the filtered metric.
  mockFetchHistory.mockResolvedValue({
    compare: null,
    current: null,
    baseline: null,
    delta: null,
    pct: null,
    availableFrom: null,
    sparkline: [],
    points: [],
  });
});

describe("PanelCard metric headline under a viewer filter (HEL-1326)", () => {
  it("shows the full-filtered-set metric from the rows response, not the loaded rows' sum (RED on main: shows 1,700)", async () => {
    serverRows({ field: "amount", agg: "sum", value: 4200 });
    renderPanel(panelWithControl(), "/?p.panel-1.c1=east");

    expect(await screen.findByText("4,200")).toBeInTheDocument();
    expect(screen.queryByText("1,700")).toBeNull();
    // The filter really was sent with the request (this is the server-applied filter path).
    const filterArgs = mockGetOutputRows.mock.calls.map((c) => c[4]?.ops);
    expect(filterArgs).toContainEqual([{ column: "region", op: "eq", value: "east" }]);
  });

  it("GUARD: with no `metric` in the response (older server) the loaded-rows value stands", async () => {
    mockGetOutputRows.mockResolvedValue({
      items: FILTERED_PAGE,
      total: 500,
      offset: 0,
      limit: 200,
      materialized: true,
    });
    renderPanel(panelWithControl(), "/?p.panel-1.c1=east");
    expect(await screen.findByText("1,700")).toBeInTheDocument();
  });

  it("ignores a filtered metric computed from a different field/agg than the current config", async () => {
    serverRows({ field: "amount", agg: "avg", value: 8 });
    renderPanel(panelWithControl(), "/?p.panel-1.c1=east");
    expect(await screen.findByText("1,700")).toBeInTheDocument();
    expect(screen.queryByText("8")).toBeNull();
  });

  it("drops the filtered value once the filter is cleared (the next page-0 response carries no metric)", async () => {
    serverRows({ field: "amount", agg: "sum", value: 4200 });
    const store = renderPanel(panelWithControl(), "/?p.panel-1.c1=east");
    expect(await screen.findByText("4,200")).toBeInTheDocument();
    expect(store.getState().panels.paginationState["panel-1"].metric).toEqual({
      field: "amount",
      agg: "sum",
      value: 4200,
    });

    fireEvent.click(screen.getByRole("button", { name: "clear viewer filter" }));
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(store.getState().panels.paginationState["panel-1"].metric).toBeUndefined(),
    );
    await waitFor(() => expect(screen.queryByText("4,200")).toBeNull());
  });

  it("shows no value for a metric whose only mapping is a label (RED on main: it aggregated the label column)", async () => {
    mockGetOutputById.mockResolvedValue(
      makeMetricOutput({ fieldMapping: { label: "region" }, format: "integer" }),
    );
    mockGetOutputRows.mockResolvedValue({
      items: [{ amount: 700, region: "east" }],
      total: 1,
      offset: 0,
      limit: 200,
      materialized: true,
    });
    renderPanel(makeOutputPanel({ id: "panel-1" }), "/");
    expect(await screen.findByText("--")).toBeInTheDocument();
    expect(screen.queryByText("east")).toBeNull();
  });
});
