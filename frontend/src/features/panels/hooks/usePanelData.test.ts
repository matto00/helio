import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createElement } from "react";
import { Provider } from "react-redux";

import { panelsReducer } from "../state/panelsSlice";
import * as outputService from "../../pipelines/services/outputService";
import { makeOutputPanel, makeTextPanel } from "../../../test/panelFixtures";
import type { Panel } from "../types/panel";
import { usePanelData } from "./usePanelData";

jest.mock("../../pipelines/services/outputService");

const mockGetOutputRows = outputService.getOutputRows as jest.MockedFunction<
  typeof outputService.getOutputRows
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

/** A manually-resolvable promise, for controlling exactly when a mocked
 *  `getOutputRows` call settles (HEL-579 tasks 1.2/1.4). */
function deferredRows() {
  let resolve!: (value: Awaited<ReturnType<typeof outputService.getOutputRows>>) => void;
  const promise = new Promise<Awaited<ReturnType<typeof outputService.getOutputRows>>>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("usePanelData", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns empty result for a non-output panel (no outputId)", () => {
    const store = makeStore();
    const panel = makeTextPanel({ id: "p1" });

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.rawRows).toBeNull();
    expect(result.current.headers).toBeNull();
    expect(mockGetOutputRows).not.toHaveBeenCalled();
  });

  it("fetches rows for an output-kind panel's bound Output", async () => {
    mockGetOutputRows.mockResolvedValue({
      items: [{ region: "west", amount: 10 }],
      total: 1,
      offset: 0,
      limit: 200,
      materialized: true,
    });
    const panel = makeOutputPanel({ id: "p1", config: { outputId: "out-1" } });
    const store = makeStore(panel);

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockGetOutputRows).toHaveBeenCalledWith("out-1", 0, 200);
    expect(result.current.rawRows).toEqual([["west", "10"]]);
    expect(result.current.headers).toEqual(["region", "amount"]);
    expect(result.current.noData).toBe(false);
    expect(result.current.chartAggregate).toBeNull();
  });

  it("reports noData when the Output has no rows", async () => {
    mockGetOutputRows.mockResolvedValue({
      items: [],
      total: 0,
      offset: 0,
      limit: 200,
      materialized: true,
    });
    const panel = makeOutputPanel({ id: "p1", config: { outputId: "out-1" } });
    const store = makeStore(panel);

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.noData).toBe(true);
  });

  it("surfaces a fetch error", async () => {
    mockGetOutputRows.mockRejectedValue(new Error("boom"));
    const panel = makeOutputPanel({ id: "p1", config: { outputId: "out-1" } });
    const store = makeStore(panel);

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    await waitFor(() => expect(result.current.error).not.toBeNull());
  });

  it("refresh() triggers a re-fetch", async () => {
    mockGetOutputRows.mockResolvedValue({
      items: [{ n: 1 }],
      total: 1,
      offset: 0,
      limit: 200,
      materialized: true,
    });
    const panel = makeOutputPanel({ id: "p1", config: { outputId: "out-1" } });
    const store = makeStore(panel);

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGetOutputRows).toHaveBeenCalledTimes(1);

    act(() => result.current.refresh());
    await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(2));
  });

  // HEL-579 design.md D2, tasks 1.1/1.2. The real race the guard closes is a
  // SECOND `refresh()` call arriving AFTER the first has already triggered
  // its effect/dispatch but BEFORE that fetch has resolved -- exactly what a
  // real double-click produces, since a fetch takes real (async) time. Two
  // synchronous `refresh()` calls in one `act()` would NOT exercise this:
  // React's automatic batching coalesces both `setRefreshToken` bumps into a
  // single render, so the dependent effect fires exactly once regardless of
  // whether the guard exists (a false red-first proof that would pass even
  // against the pre-guard code) -- see skeptic-design-2.md.
  describe("in-flight guard (design.md D2, task 1.2)", () => {
    it("a second refresh() while the first's fetch is still pending does not dispatch again; a third after it settles does", async () => {
      // Flush the initial mount fetch to completion first, so the counted
      // dispatch calls below unambiguously refer to refresh()-triggered
      // fetches only (design-gate skeptic round 3 non-blocking note).
      mockGetOutputRows.mockResolvedValueOnce({
        items: [{ n: 0 }],
        total: 1,
        offset: 0,
        limit: 200,
        materialized: true,
      });
      const panel = makeOutputPanel({ id: "p1", config: { outputId: "out-1" } });
      const store = makeStore(panel);

      const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(mockGetOutputRows).toHaveBeenCalledTimes(1);

      // First refresh-cycle fetch: leave it unresolved.
      const first = deferredRows();
      mockGetOutputRows.mockReturnValueOnce(first.promise);
      act(() => result.current.refresh());
      await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(2));

      // Second refresh() while the first fetch is still pending -- a no-op.
      act(() => result.current.refresh());
      expect(mockGetOutputRows).toHaveBeenCalledTimes(2);

      // Settle the pending fetch.
      await act(async () => {
        first.resolve({ items: [{ n: 1 }], total: 1, offset: 0, limit: 200, materialized: true });
        await Promise.resolve();
        await Promise.resolve();
      });
      await waitFor(() => expect(result.current.isRefreshing).toBe(false));

      // A third refresh() now DOES dispatch again -- the guard clears once
      // the fetch settles, not permanently.
      mockGetOutputRows.mockResolvedValueOnce({
        items: [{ n: 2 }],
        total: 1,
        offset: 0,
        limit: 200,
        materialized: true,
      });
      act(() => result.current.refresh());
      await waitFor(() => expect(mockGetOutputRows).toHaveBeenCalledTimes(3));
    });
  });

  // HEL-579 design.md D3, task 1.4.
  describe("isRefreshing (design.md D3, task 1.4)", () => {
    it("is true while a refresh fetch is pending and false once it resolves, independent of isLoading", async () => {
      mockGetOutputRows.mockResolvedValueOnce({
        items: [{ n: 0 }],
        total: 1,
        offset: 0,
        limit: 200,
        materialized: true,
      });
      const panel = makeOutputPanel({ id: "p1", config: { outputId: "out-1" } });
      const store = makeStore(panel);

      const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.isRefreshing).toBe(false);

      const pending = deferredRows();
      mockGetOutputRows.mockReturnValueOnce(pending.promise);
      act(() => result.current.refresh());

      await waitFor(() => expect(result.current.isRefreshing).toBe(true));
      // Refreshing already-loaded data must never re-trigger the full
      // skeleton (Context in design.md) -- isLoading stays false throughout.
      expect(result.current.isLoading).toBe(false);

      await act(async () => {
        pending.resolve({ items: [{ n: 1 }], total: 1, offset: 0, limit: 200, materialized: true });
        await Promise.resolve();
        await Promise.resolve();
      });
      await waitFor(() => expect(result.current.isRefreshing).toBe(false));
    });
  });
});
