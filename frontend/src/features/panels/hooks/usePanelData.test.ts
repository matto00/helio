import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createElement } from "react";
import { Provider } from "react-redux";

import { markDataTypeRowsStale, panelsReducer } from "../state/panelsSlice";
import * as dataTypeService from "../../dataTypes/services/dataTypeService";
import { makeMetricPanel } from "../../../test/panelFixtures";
import type { Panel } from "../types/panel";
import { usePanelData } from "./usePanelData";

jest.mock("../../dataTypes/services/dataTypeService");

const mockFetchDataTypeRows = dataTypeService.fetchDataTypeRows as jest.MockedFunction<
  typeof dataTypeService.fetchDataTypeRows
>;

function makeStore(panel?: Panel) {
  return configureStore({
    reducer: {
      panels: panelsReducer,
    } as never,
    preloadedState: panel
      ? ({
          panels: {
            items: [panel],
            loadedDashboardId: "d1",
            status: "succeeded",
            error: null,
            pendingPanelUpdates: {},
            lastSavedAt: null,
            paginationState: {},
          },
        } as never)
      : undefined,
  });
}

function wrapper(store: ReturnType<typeof makeStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(Provider, { store } as never, children);
  };
}

describe("usePanelData", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns empty result for unbound panel (empty dataTypeId)", () => {
    const store = makeStore();
    const panel = makeMetricPanel();
    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.noData).toBe(false);
    expect(mockFetchDataTypeRows).not.toHaveBeenCalled();
  });

  it("fetches DataType rows for a bound metric panel", async () => {
    mockFetchDataTypeRows.mockResolvedValue({
      rows: [{ revenue: "1000", region: "North" }],
      rowCount: 1,
    });

    const panel = makeMetricPanel({
      config: { dataTypeId: "dt-1", fieldMapping: { value: "revenue" } },
    });
    const store = makeStore(panel);

    renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    await waitFor(() => expect(mockFetchDataTypeRows).toHaveBeenCalledWith("dt-1"));
  });

  it("maps fieldMapping from rows", async () => {
    mockFetchDataTypeRows.mockResolvedValue({
      rows: [{ revenue: "1000", region: "North" }],
      rowCount: 1,
    });

    const panel = makeMetricPanel({
      config: { dataTypeId: "dt-1", fieldMapping: { value: "revenue", label: "region" } },
    });
    const store = makeStore(panel);

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual({ value: "1000", label: "North" });
    expect(result.current.rawRows).toEqual([["1000", "North"]]);
    expect(result.current.headers).toEqual(["revenue", "region"]);
    expect(result.current.error).toBeNull();
    expect(result.current.noData).toBe(false);
  });

  it("sets noData when DataType has no rows", async () => {
    mockFetchDataTypeRows.mockResolvedValue({ rows: [], rowCount: 0 });

    const panel = makeMetricPanel({
      config: { dataTypeId: "dt-1", fieldMapping: { value: "revenue" } },
    });
    const store = makeStore(panel);

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.noData).toBe(true);
    expect(result.current.data).toBeNull();
  });

  it("sets error when fetch fails", async () => {
    mockFetchDataTypeRows.mockRejectedValue(new Error("Network error"));

    const panel = makeMetricPanel({
      config: { dataTypeId: "dt-1", fieldMapping: { value: "revenue" } },
    });
    const store = makeStore(panel);

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    await waitFor(() => expect(result.current.error).toBe("Failed to load data."));
    expect(result.current.data).toBeNull();
  });

  it("exposes a refresh callback that is a function", () => {
    const store = makeStore();
    const panel = makeMetricPanel();
    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });
    expect(typeof result.current.refresh).toBe("function");
  });

  it("refresh callback triggers a re-fetch for a bound panel", async () => {
    mockFetchDataTypeRows.mockResolvedValue({
      rows: [{ revenue: "1000", region: "North" }],
      rowCount: 1,
    });

    const panel = makeMetricPanel({
      config: { dataTypeId: "dt-1", fieldMapping: { value: "revenue", label: "region" } },
    });
    const store = makeStore(panel);

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockFetchDataTypeRows).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(mockFetchDataTypeRows).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ value: "1000", label: "North" });
  });

  // HEL-242 — dispatching markDataTypeRowsStale for a bound panel's DataType
  // clears its pagination entry and triggers a fresh fetch on the next render
  // tick (bypassing the prevFetchKey dedupe guard).
  it("re-fetches after markDataTypeRowsStale is dispatched for the panel's DataType", async () => {
    mockFetchDataTypeRows
      .mockResolvedValueOnce({
        rows: [{ revenue: "1000", region: "North" }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ revenue: "2500", region: "North" }],
        rowCount: 1,
      });

    const panel = makeMetricPanel({
      config: { dataTypeId: "dt-1", fieldMapping: { value: "revenue", label: "region" } },
    });
    const store = makeStore(panel);

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    // First render fetches and populates rows; the dedupe key is now armed.
    await waitFor(() => expect(mockFetchDataTypeRows).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.data).toEqual({ value: "1000", label: "North" }));

    // Dispatch the stale-invalidation for this panel's DataType. The reducer
    // deletes the entry synchronously; React then runs the hook's effect, which
    // bypasses the dedupe guard (paginationEntry == null) and dispatches a
    // fresh fetchPanelPage — by the time act() returns, the entry has been
    // re-created in the `pending` state with isLoadingMore: true.
    act(() => {
      store.dispatch(markDataTypeRowsStale("dt-1"));
    });

    await waitFor(() => expect(mockFetchDataTypeRows).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.data).toEqual({ value: "2500", label: "North" }));
  });

  it("does NOT re-fetch when markDataTypeRowsStale targets a different DataType", async () => {
    mockFetchDataTypeRows.mockResolvedValue({
      rows: [{ revenue: "1000", region: "North" }],
      rowCount: 1,
    });

    const panel = makeMetricPanel({
      config: { dataTypeId: "dt-1", fieldMapping: { value: "revenue" } },
    });
    const store = makeStore(panel);

    renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });
    await waitFor(() => expect(mockFetchDataTypeRows).toHaveBeenCalledTimes(1));

    act(() => {
      store.dispatch(markDataTypeRowsStale("dt-other"));
    });

    // Pagination entry untouched; no second fetch dispatched.
    expect(store.getState().panels.paginationState[panel.id]).toBeDefined();
    // Give any pending effect a chance to run; the call count must stay 1.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetchDataTypeRows).toHaveBeenCalledTimes(1);
  });

  it("refresh callback is stable across re-renders", () => {
    const store = makeStore();
    const panel = makeMetricPanel();
    const { result, rerender } = renderHook(() => usePanelData(panel), {
      wrapper: wrapper(store),
    });

    const firstRefresh = result.current.refresh;
    rerender();
    expect(result.current.refresh).toBe(firstRefresh);
  });

  // ─── HEL-284: reference stability for memoized derivations ───────────────────
  // When the underlying rows array reference is unchanged (Redux returned the same
  // slice), usePanelData must return the same `headers`, `rawRows`, and `data`
  // references so that memoized children (React.memo'd PanelCardBody) bail out.

  it("headers reference is stable across re-renders when rows are unchanged", async () => {
    mockFetchDataTypeRows.mockResolvedValue({
      rows: [{ revenue: "1000", region: "North" }],
      rowCount: 1,
    });

    const panel = makeMetricPanel({
      config: { dataTypeId: "dt-1", fieldMapping: { value: "revenue", label: "region" } },
    });
    const store = makeStore(panel);

    const { result, rerender } = renderHook(() => usePanelData(panel), {
      wrapper: wrapper(store),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.headers).not.toBeNull();

    const headersRef = result.current.headers;
    rerender();
    expect(result.current.headers).toBe(headersRef);
  });

  it("rawRows reference is stable across re-renders when rows are unchanged", async () => {
    mockFetchDataTypeRows.mockResolvedValue({
      rows: [{ revenue: "1000", region: "North" }],
      rowCount: 1,
    });

    const panel = makeMetricPanel({
      config: { dataTypeId: "dt-1", fieldMapping: { value: "revenue", label: "region" } },
    });
    const store = makeStore(panel);

    const { result, rerender } = renderHook(() => usePanelData(panel), {
      wrapper: wrapper(store),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rawRows).not.toBeNull();

    const rawRowsRef = result.current.rawRows;
    rerender();
    expect(result.current.rawRows).toBe(rawRowsRef);
  });

  it("data reference is stable across re-renders when rows and fieldMapping are unchanged", async () => {
    mockFetchDataTypeRows.mockResolvedValue({
      rows: [{ revenue: "1000", region: "North" }],
      rowCount: 1,
    });

    const panel = makeMetricPanel({
      config: { dataTypeId: "dt-1", fieldMapping: { value: "revenue", label: "region" } },
    });
    const store = makeStore(panel);

    const { result, rerender } = renderHook(() => usePanelData(panel), {
      wrapper: wrapper(store),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).not.toBeNull();

    const dataRef = result.current.data;
    rerender();
    expect(result.current.data).toBe(dataRef);
  });
});
