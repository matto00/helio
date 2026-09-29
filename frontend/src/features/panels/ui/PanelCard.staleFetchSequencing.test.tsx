// HEL-1027 skeptic-final-1.md (round 1, REFUTE) change request 4 — reproduces Defect 2: a table
// Output with a PERSISTED `columnFilters` default, mounted fresh (mirroring `usePanelData`'s real
// mount-effect/StrictMode double-invoke behavior — `<React.StrictMode>`, not mocked away), where
// the STALE unfiltered mount fetch resolves AFTER the correct filtered one. The settled
// `total`/disclosure must match the server's FILTERED total, never an interleaved unfiltered
// fetch's total landing later and silently winning.

import { configureStore, type UnknownAction } from "@reduxjs/toolkit";
import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";

import { makeOutputPanel } from "../../../test/panelFixtures";
import { getOutputId } from "../state/panelNarrowing";
import { panelsReducer } from "../state/panelsSlice";
import { authReducer } from "../../auth/state/authSlice";
import { toastsReducer } from "../../toasts/state/toastsSlice";
import { usePanelData } from "../hooks/usePanelData";
import * as outputService from "../../pipelines/services/outputService";
import type { FetchOutputRowsResult } from "../../pipelines/services/outputService";
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// HEL-1027 skeptic-final-3.md CR1 (cycle 4) — `PanelCardBody` now resolves its own `output` via
// its own internal `useOutputMeta(outputId)` call (no longer an externally-supplied prop), so
// this harness no longer needs its own separate call — the SAME `mockGetOutputById` mock below
// backs whichever component calls it.
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
      chartAggregate={panelData.chartAggregate}
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

function makeFilteredTableOutput(): Output {
  return {
    id: "output-1",
    pipelineId: "pipeline-1",
    ownerId: "u1",
    name: "Rows",
    kind: "table",
    // A PERSISTED quick filter, matching HEL-1027's own live-reproduced scenario.
    config: { fieldMapping: {}, columnFilters: { quick: "t" } },
    schema: [{ name: "label", type: "string" }],
    createdAt: "",
    updatedAt: "",
  };
}

describe("PanelCard/panelsSlice — stale-response sequencing (HEL-1027 skeptic-final-1.md CR4)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOutputById.mockResolvedValue(makeFilteredTableOutput());
    mockGetAssertionStatus.mockResolvedValue({
      outputId: "output-1",
      invalid: false,
      failedRuleCount: 0,
    });
  });

  it("settles on the server's FILTERED total even when React StrictMode's unfiltered mount-effect double-invoke resolves AFTER the correct filtered fetch", async () => {
    const unfilteredDeferreds: ReturnType<typeof deferred<FetchOutputRowsResult>>[] = [];
    let filteredDeferred: ReturnType<typeof deferred<FetchOutputRowsResult>> | null = null;

    mockGetOutputRows.mockImplementation((_outputId, _offset, _limit, _sort, filter) => {
      const d = deferred<FetchOutputRowsResult>();
      if (filter) {
        filteredDeferred = d;
      } else {
        unfilteredDeferreds.push(d);
      }
      return d.promise;
    });

    const panel = makeOutputPanel({ id: "panel-stale" });
    const store = makeStore(panel);
    render(
      <MemoryRouter>
        <StrictMode>
          <Provider store={store}>
            <Harness panel={panel} />
          </Provider>
        </StrictMode>
      </MemoryRouter>,
    );

    // Let `useOutputMeta` resolve and every mount-effect dispatch (StrictMode's unfiltered
    // double-invoke, plus `usePanelSortFilter`'s persisted-default-triggered filtered fetch) fire.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(filteredDeferred).not.toBeNull();
    expect(unfilteredDeferreds.length).toBeGreaterThanOrEqual(1);

    // The FAST, CORRECT server response (filtered) lands first...
    await act(async () => {
      filteredDeferred!.resolve({
        items: [{ label: "target1" }, { label: "target2" }, { label: "target3" }],
        total: 3,
        offset: 0,
        limit: 200,
        materialized: true,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // ...then the SLOW, STALE unfiltered response(s) land LAST — the exact out-of-order race
    // skeptic-final-1.md live-reproduced via a real page load.
    await act(async () => {
      for (const d of unfilteredDeferreds) {
        d.resolve({
          items: Array.from({ length: 60 }, (_, i) => ({ label: `row-${i}` })),
          total: 60,
          offset: 0,
          limit: 200,
          materialized: true,
        });
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    // The settled state must reflect the FILTERED total (3), never the stale unfiltered one (60)
    // that happened to resolve last.
    expect(store.getState().panels.paginationState["panel-stale"]?.total).toBe(3);
    expect(store.getState().panels.paginationState["panel-stale"]?.rows).toHaveLength(3);
    await screen.findByText("3 results.");
  });

  // HEL-1027 skeptic-final-2.md (round 2, REFUTE) CR3 — the test above resolves `getOutputById`
  // near-instantly (`mockResolvedValue`), unlike real network latency. This variant uses a
  // GENUINELY DEFERRED `getOutputById` (matching the already-deferred `getOutputRows` pattern),
  // so `usePanelData`'s own unfiltered mount-effect fetch(es) can fully SETTLE (not just dispatch)
  // BEFORE the Output's persisted config — and therefore the persisted-default correction — is
  // even known, modeling the real-world case where the metadata round trip is slower than the
  // rows round trip.
  it("still settles on the server's FILTERED total when useOutputMeta resolves AFTER usePanelData's own unfiltered fetch has already fully settled", async () => {
    const outputDeferred = deferred<Output>();
    mockGetOutputById.mockReturnValue(outputDeferred.promise);

    const unfilteredDeferreds: ReturnType<typeof deferred<FetchOutputRowsResult>>[] = [];
    let filteredDeferred: ReturnType<typeof deferred<FetchOutputRowsResult>> | null = null;
    mockGetOutputRows.mockImplementation((_outputId, _offset, _limit, _sort, filter) => {
      const d = deferred<FetchOutputRowsResult>();
      if (filter) {
        filteredDeferred = d;
      } else {
        unfilteredDeferreds.push(d);
      }
      return d.promise;
    });

    const panel = makeOutputPanel({ id: "panel-stale-2" });
    const store = makeStore(panel);
    render(
      <MemoryRouter>
        <StrictMode>
          <Provider store={store}>
            <Harness panel={panel} />
          </Provider>
        </StrictMode>
      </MemoryRouter>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(unfilteredDeferreds.length).toBeGreaterThanOrEqual(1);
    expect(filteredDeferred).toBeNull(); // output hasn't resolved yet -- no filtered request possible

    // The UNFILTERED fetch(es) fully settle FIRST -- output metadata is still unresolved.
    await act(async () => {
      for (const d of unfilteredDeferreds) {
        d.resolve({
          items: Array.from({ length: 60 }, (_, i) => ({ label: `row-${i}` })),
          total: 60,
          offset: 0,
          limit: 200,
          materialized: true,
        });
      }
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(store.getState().panels.paginationState["panel-stale-2"]?.total).toBe(60);

    // NOW the Output metadata (with its persisted filter default) finally resolves.
    await act(async () => {
      outputDeferred.resolve(makeFilteredTableOutput());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The persisted-default correction MUST have fired a filtered fetch by now.
    expect(filteredDeferred).not.toBeNull();
    await act(async () => {
      filteredDeferred!.resolve({
        items: [{ label: "target1" }, { label: "target2" }, { label: "target3" }],
        total: 3,
        offset: 0,
        limit: 200,
        materialized: true,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(store.getState().panels.paginationState["panel-stale-2"]?.total).toBe(3);
    expect(store.getState().panels.paginationState["panel-stale-2"]?.rows).toHaveLength(3);
    await screen.findByText("3 results.");
  });
});
