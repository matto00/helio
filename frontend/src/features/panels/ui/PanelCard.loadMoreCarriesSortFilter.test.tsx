// HEL-1027 cycle-2 self-found finding (discovered while fixing skeptic-final-1.md's Defects 1/2):
// "Load more" (page > 0) must carry the SAME active sort/filter the current page-0 window was
// fetched under, or the appended page silently reverts to the raw/unfiltered default — a direct
// AC #2 ("no duplicated or dropped rows across pages") violation for a sorted/filtered table.

import { configureStore, type UnknownAction } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputId } from "../state/panelNarrowing";
import { panelsReducer } from "../state/panelsSlice";
import { authReducer } from "../../auth/state/authSlice";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import { usePanelData } from "../hooks/usePanelData";
import * as outputService from "../../pipelines/services/outputService";
import type { Output } from "../../pipelines/types/output";
import { PanelCardBody } from "./PanelCard";
import type { Panel } from "../types/panel";

jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
  getOutputById: jest.fn(),
  getAssertionStatus: jest.fn(),
}));
jest.mock("../hooks/usePanelPolling", () => ({ usePanelPolling: jest.fn() }));
jest.mock("../hooks/usePanelRunRefresh", () => ({ usePanelRunRefresh: jest.fn() }));

const mockGetOutputRows = outputService.getOutputRows as jest.MockedFunction<
  typeof outputService.getOutputRows
>;
const mockGetOutputById = outputService.getOutputById as jest.MockedFunction<
  typeof outputService.getOutputById
>;
const mockGetAssertionStatus = outputService.getAssertionStatus as jest.MockedFunction<
  typeof outputService.getAssertionStatus
>;

function makeTableOutput(): Output {
  return {
    id: "output-1",
    pipelineId: "pipeline-1",
    ownerId: "u1",
    name: "Rows",
    kind: "table",
    config: { fieldMapping: {} },
    schema: [{ name: "revenue", type: "integer" }],
    createdAt: "",
    updatedAt: "",
  };
}

// `PanelCardBody` resolves its own `useOutputMeta` internally as of skeptic-final-3.md CR1
// (cycle 4) — no longer an externally-supplied prop.
function Harness({ panel }: { panel: Panel }) {
  const outputId = getOutputId(panel);
  const panelData = usePanelData(panel);
  return (
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
  );
}

function makeStore(panel: Panel) {
  const seed = panelsReducer(undefined, { type: "@@INIT" } as UnknownAction);
  const authSeed = authReducer(undefined, { type: "@@INIT" } as UnknownAction);
  return configureStore({
    reducer: { panels: panelsReducer, toasts: toastsReducer, auth: authReducer } as never,
    preloadedState: {
      panels: { ...seed, items: [panel] },
      toasts: { items: [] },
      auth: authSeed,
    } as never,
  });
}

describe("PanelCard — 'Load more' carries the active sort/filter (HEL-1027 AC #2)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGetOutputById.mockResolvedValue(makeTableOutput());
    mockGetAssertionStatus.mockResolvedValue({
      outputId: "output-1",
      invalid: false,
      failedRuleCount: 0,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("a Load more click after sorting includes the SAME sort in its page>1 request", async () => {
    mockGetOutputRows.mockResolvedValue({
      items: Array.from({ length: 200 }, (_, i) => ({ revenue: i })),
      total: 250,
      offset: 0,
      limit: 200,
      materialized: true,
    });
    const panel = makeOutputPanel({ id: "panel-loadmore" });
    render(
      <MemoryRouter>
        <Provider store={makeStore(panel)}>
          <Harness panel={panel} />
        </Provider>
      </MemoryRouter>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await screen.findByRole("table");

    // Click the "revenue" column header to sort — triggers the debounced server refetch.
    const revenueHeader = screen
      .getAllByRole("columnheader")
      .find((h) => h.textContent?.includes("revenue"));
    fireEvent.click(revenueHeader!.querySelector("button")!);
    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    mockGetOutputRows.mockClear();
    mockGetOutputRows.mockResolvedValue({
      items: Array.from({ length: 50 }, (_, i) => ({ revenue: 200 + i })),
      total: 250,
      offset: 200,
      limit: 50,
      materialized: true,
    });

    const loadMoreBtn = screen.getByRole("button", { name: "Load more" });
    fireEvent.click(loadMoreBtn);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The "Load more" (page 1) request must carry the SAME sort the page-0 window used —
    // never a bare unsorted/unfiltered request.
    expect(mockGetOutputRows).toHaveBeenCalledWith(
      "output-1",
      50,
      50,
      { column: "revenue", direction: "asc" },
      undefined,
    );
  });
});
