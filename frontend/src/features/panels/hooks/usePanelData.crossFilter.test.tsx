import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import { AxiosError, type AxiosResponse } from "axios";
import type { PropsWithChildren } from "react";
import { createElement } from "react";
import { Provider } from "react-redux";

import { fetchPanelPage, panelsReducer } from "../state/panelsSlice";
import * as outputService from "../../pipelines/services/outputService";
import { makeOutputPanel } from "../../../test/panelFixtures";
import {
  getCapabilitiesEntry,
  resetCapabilitiesStoreForTests,
} from "../state/filterCapabilitiesStore";
import type { PanelLastQuery, SelectionDescriptor } from "../types/panel";
import { usePanelData } from "./usePanelData";

// HEL-1191 design.md D9a-i/D9a-ii, tasks 5.5/5.7 — `usePanelData`'s replay of
// `paginationState[panel].lastQuery` (ops-less hosts) and its handling of an explicit
// `crossFilterEq`.

jest.mock("../../pipelines/services/outputService", () => ({
  ...jest.requireActual("../../pipelines/services/outputService"),
  getOutputRows: jest.fn(),
}));

const mockGetOutputRows = jest.mocked(outputService.getOutputRows);
const EQ = { column: "quarter", value: "Q1" };
const CROSS: SelectionDescriptor = {
  panelId: "origin",
  dimension: "quarter",
  value: "Q1",
  series: "",
};

function makeStore(opts: { lastQuery?: PanelLastQuery; crossFilter?: SelectionDescriptor | null }) {
  return configureStore({
    reducer: { panels: panelsReducer } as never,
    preloadedState: {
      panels: {
        items: [],
        loadedDashboardId: "d1",
        status: "succeeded",
        error: null,
        pendingPanelUpdates: {},
        lastSavedAt: null,
        interactionState: {},
        crossFilter: opts.crossFilter ?? null,
        paginationState: opts.lastQuery
          ? {
              p1: {
                currentPage: 0,
                hasMore: false,
                isLoadingMore: false,
                rows: [{ quarter: "Q1" }],
                materialized: true,
                total: 1,
                lastQuery: opts.lastQuery,
              },
            }
          : {},
        latestFetchRequestId: {},
      },
    } as never,
  });
}

function wrap(store: ReturnType<typeof makeStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(Provider, { store } as never, children);
  };
}

function axios400(): AxiosError {
  return new AxiosError("Bad Request", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 400,
    data: {},
  } as AxiosResponse);
}

const page = (items: Record<string, unknown>[] = [{ quarter: "Q1" }]) =>
  Promise.resolve({ items, total: items.length, offset: 0, limit: 200, materialized: true });

const panel = makeOutputPanel({ id: "p1", config: { outputId: "out-1" } });
const lastQuery = (over: Partial<PanelLastQuery> = {}): PanelLastQuery => ({
  outputId: "out-1",
  crossFilterEq: EQ,
  ...over,
});
const firstFilter = () => mockGetOutputRows.mock.calls[0]?.[4];

beforeEach(() => {
  jest.clearAllMocks();
  resetCapabilitiesStoreForTests();
  mockGetOutputRows.mockImplementation(() => page());
});

describe("usePanelData — lastQuery replay (HEL-1191 D9a-i)", () => {
  it("a mount replays the recorded eq while it still equals the live cross-filter", async () => {
    const store = makeStore({ lastQuery: lastQuery(), crossFilter: CROSS });
    renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(1));

    expect(firstFilter()).toEqual({ ops: [{ column: "quarter", op: "eq", value: "Q1" }] });
    expect(store.getState().panels.paginationState.p1.lastQuery?.crossFilterEq).toEqual(EQ);
  });

  it("clear-while-unmounted: a recorded eq is dropped when the cross-filter was cleared", async () => {
    const store = makeStore({ lastQuery: lastQuery(), crossFilter: null });
    renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(1));

    expect(firstFilter()).toBeUndefined();
  });

  it("change-while-unmounted: a recorded eq is dropped when the live cross-filter value differs", async () => {
    const store = makeStore({ lastQuery: lastQuery(), crossFilter: { ...CROSS, value: "Q2" } });
    renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(1));

    expect(firstFilter()).toBeUndefined();
  });

  it("never replays the eq for the originating panel", async () => {
    const store = makeStore({
      lastQuery: lastQuery(),
      crossFilter: { ...CROSS, panelId: "p1" },
    });
    renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(1));

    expect(firstFilter()).toBeUndefined();
  });

  it("rebind: a lastQuery recorded for ANOTHER Output replays nothing", async () => {
    const store = makeStore({
      lastQuery: lastQuery({ outputId: "old-output", sort: { column: "a", direction: "asc" } }),
      crossFilter: CROSS,
    });
    renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(1));

    expect(firstFilter()).toBeUndefined();
    expect(mockGetOutputRows.mock.calls[0][3]).toBeUndefined();
  });

  it("a mount replays only the terms that outlive the component (control ops + eq), never the table's local sort/filter", async () => {
    const store = makeStore({
      crossFilter: CROSS,
      lastQuery: lastQuery({
        sort: { column: "idx", direction: "desc" },
        filter: {
          quick: "abc",
          columns: { idx: "3" },
          ops: [{ column: "region", op: "eq", value: "west" }],
        },
      }),
    });
    renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(1));

    expect(mockGetOutputRows.mock.calls[0][3]).toBeUndefined();
    expect(firstFilter()).toEqual({
      ops: [
        { column: "region", op: "eq", value: "west" },
        { column: "quarter", op: "eq", value: "Q1" },
      ],
    });
  });

  it("refresh() replays the FULL last query (sort, table filter, control ops and the eq)", async () => {
    const store = makeStore({ crossFilter: CROSS, lastQuery: lastQuery() });
    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });
    await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isRefreshing).toBe(false));

    // What `usePanelSortFilter` dispatches on a user sort/filter change.
    await act(async () => {
      await store.dispatch(
        fetchPanelPage({
          panelId: "p1",
          outputId: "out-1",
          page: 0,
          pageSize: 200,
          sort: { column: "idx", direction: "desc" },
          filter: { quick: "abc", ops: [{ column: "region", op: "eq", value: "west" }] },
          crossFilterEq: EQ,
        }),
      );
    });
    mockGetOutputRows.mockClear();

    act(() => result.current.refresh());
    await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(1));

    expect(mockGetOutputRows.mock.calls[0][3]).toEqual({ column: "idx", direction: "desc" });
    expect(mockGetOutputRows.mock.calls[0][4]).toEqual({
      quick: "abc",
      ops: [
        { column: "region", op: "eq", value: "west" },
        { column: "quarter", op: "eq", value: "Q1" },
      ],
    });
  });

  it("an explicit crossFilterEq takes precedence over a replay and joins the fetch key (change re-dispatches)", async () => {
    const store = makeStore({ crossFilter: CROSS, lastQuery: lastQuery() });
    const { rerender } = renderHook(
      ({ eq }: { eq: typeof EQ | null }) => usePanelData(panel, [], eq),
      { wrapper: wrap(store), initialProps: { eq: EQ as typeof EQ | null } },
    );
    await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(1));
    expect(firstFilter()).toEqual({ ops: [{ column: "quarter", op: "eq", value: "Q1" }] });

    rerender({ eq: { column: "quarter", value: "Q2" } });
    await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(2));
    expect(mockGetOutputRows.mock.calls[1][4]).toEqual({
      ops: [{ column: "quarter", op: "eq", value: "Q2" }],
    });

    rerender({ eq: null });
    await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(3));
    expect(mockGetOutputRows.mock.calls[2][4]).toBeUndefined();
  });
});

describe("usePanelData — cross-filter-eq-rejected (HEL-1191 D3a, mount/refresh class)", () => {
  it("ignores the code (no error state) and retries the replay WITHOUT the eq", async () => {
    mockGetOutputRows.mockImplementation((_id, _o, _l, _s, filter) =>
      (filter?.ops ?? []).some((o) => o.op === "eq") ? Promise.reject(axios400()) : page(),
    );
    const store = makeStore({ lastQuery: lastQuery(), crossFilter: CROSS });
    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });

    await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(2));
    expect(mockGetOutputRows.mock.calls[1][4]).toBeUndefined();
    await waitFor(() =>
      expect(store.getState().panels.paginationState.p1.isLoadingMore).toBe(false),
    );
    expect(result.current.error).toBeNull();
    expect(getCapabilitiesEntry("out-1")?.status).toBe("unavailable");
  });

  it("a genuine non-eq failure still surfaces as an error", async () => {
    mockGetOutputRows.mockRejectedValue(new Error("boom"));
    const store = makeStore({});
    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrap(store) });

    await waitFor(() => expect(result.current.error).not.toBeNull());
  });
});
