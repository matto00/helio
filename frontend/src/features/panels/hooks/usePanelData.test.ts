import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createElement } from "react";
import { Provider } from "react-redux";

import { markDataTypeRowsStale, panelsReducer } from "../state/panelsSlice";
import * as dataTypeService from "../../dataTypes/services/dataTypeService";
import { makeChartPanel, makeMetricPanel, makeTextPanel } from "../../../test/panelFixtures";
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

  // ─── HEL-292: panel-level aggregation ────────────────────────────────────

  describe("metric aggregation", () => {
    it("renders the aggregate over all fetched rows instead of rows[0]", async () => {
      mockFetchDataTypeRows.mockResolvedValue({
        rows: [{ rating: 2 }, { rating: 4 }, { rating: 9 }],
        rowCount: 3,
      });

      const panel = makeMetricPanel({
        config: {
          dataTypeId: "dt-1",
          fieldMapping: { label: "rating" },
          aggregation: { value: "rating", agg: "avg" },
        },
      });
      const store = makeStore(panel);

      const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // avg(2, 4, 9) = 5 — computed over ALL rows, not rows[0].
      expect(result.current.data?.value).toBe("5");
      // label continues to read fieldMapping off the first row, unaffected.
      expect(result.current.data?.label).toBe("2");
    });

    it("no-aggregation path renders rows[0] as before", async () => {
      mockFetchDataTypeRows.mockResolvedValue({
        rows: [{ revenue: "1000" }, { revenue: "2000" }],
        rowCount: 2,
      });

      const panel = makeMetricPanel({
        config: { dataTypeId: "dt-1", fieldMapping: { value: "revenue" } },
      });
      const store = makeStore(panel);

      const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.data?.value).toBe("1000");
    });

    it("aggregates over a row count exceeding the metric default page size (10)", async () => {
      // Non-blocking suggestion from evaluation-1.md: prior fixtures (<=3 rows)
      // never exceeded the pre-existing metric default pageSize (10), so a
      // regression reverting the `pageSize = Number.MAX_SAFE_INTEGER` override
      // in usePanelData.ts (fetchPanelPage slices `rows.slice(start, start +
      // pageSize)`) would silently truncate to the first 10 rows and this test
      // would still fail loudly on the wrong sum, proving the override held.
      const rows = Array.from({ length: 15 }, (_, i) => ({ amount: i + 1 })); // 1..15
      mockFetchDataTypeRows.mockResolvedValue({ rows, rowCount: rows.length });

      const panel = makeMetricPanel({
        config: {
          dataTypeId: "dt-1",
          // A non-empty fieldMapping is required for `data` to compute at all
          // (see usePanelData.ts's `!fieldMappingKey` early-return) — `label`
          // is unaffected by aggregation and just proves the fetch happened.
          fieldMapping: { label: "amount" },
          aggregation: { value: "amount", agg: "sum" },
        },
      });
      const store = makeStore(panel);

      const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // sum(1..15) = 120 — only correct if all 15 rows landed in memory, not
      // just the first 10 (the pre-HEL-292 metric default page size).
      expect(result.current.data?.value).toBe("120");
    });

    // HEL-292 (cycle-3 regression, evaluation-2.md CR #2) — design.md
    // Decision 3: `metricAggregation` is independent of `fieldMapping`. A
    // metric panel may have an aggregation spec configured with NO field
    // mapping at all (`fieldMapping === {}`, so `fieldMappingKey === null`).
    // The `data` memo's early-return guard must not gate the aggregate
    // override on `fieldMappingKey` being present.
    it("renders the aggregate when fieldMapping is empty but a metricAggregation spec is set", async () => {
      mockFetchDataTypeRows.mockResolvedValue({
        rows: [{ profit: 0 }, { profit: 100 }, { profit: 20000 }],
        rowCount: 3,
      });

      const panel = makeMetricPanel({
        config: {
          dataTypeId: "dt-1",
          fieldMapping: {},
          aggregation: { value: "profit", agg: "avg" },
        },
      });
      const store = makeStore(panel);

      const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      // avg(0, 100, 20000) = 6700 — `data` must not be null, and the
      // aggregate must be reachable with no field-mapping slots set.
      expect(result.current.data).not.toBeNull();
      expect(result.current.data?.value).toBe("6700");
    });
  });

  // ─── HEL-293: metric literal label/unit override ─────────────────────────

  describe("metric literal label/unit", () => {
    it("literal label/unit override the fieldMapping-resolved value when both are present", async () => {
      mockFetchDataTypeRows.mockResolvedValue({
        rows: [{ revenue: "1000", region: "North" }],
        rowCount: 1,
      });

      const panel = makeMetricPanel({
        config: {
          dataTypeId: "dt-1",
          fieldMapping: { value: "revenue", label: "region", unit: "region" },
          label: "Total Revenue",
          unit: "USD",
        },
      });
      const store = makeStore(panel);

      const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.data?.value).toBe("1000");
      expect(result.current.data?.label).toBe("Total Revenue");
      expect(result.current.data?.unit).toBe("USD");
    });

    it("falls back to the fieldMapping-resolved value when no literal label/unit is set", async () => {
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

      expect(result.current.data?.value).toBe("1000");
      expect(result.current.data?.label).toBe("North");
    });
  });

  describe("chart aggregation (chartAggregate)", () => {
    it("groups typed rows by groupBy and computes one aggregate per group", async () => {
      mockFetchDataTypeRows.mockResolvedValue({
        rows: [
          { year: "2019", rating: 3 },
          { year: "2020", rating: 5 },
          { year: "2020", rating: 7 },
        ],
        rowCount: 3,
      });

      const panel = makeChartPanel({
        config: {
          dataTypeId: "dt-1",
          fieldMapping: {},
          aggregation: { groupBy: "year", agg: "avg", yField: "rating" },
        },
      });
      const store = makeStore(panel);

      const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.chartAggregate).toEqual({
        categories: ["2019", "2020"],
        values: [3, 6],
      });
    });

    it("count aggregation on a group with a real-null yField row excludes the null (not stringified '')", async () => {
      // The typed `rows` path (not `rawRows`) must carry the real `null`
      // through to `groupAndAggregate` so `count` can tell it apart from a
      // genuine empty-string cell — the case round-2 design review flagged.
      mockFetchDataTypeRows.mockResolvedValue({
        rows: [
          { year: "2020", title: "A" },
          { year: "2020", title: null },
          { year: "2020", title: "B" },
        ],
        rowCount: 3,
      });

      const panel = makeChartPanel({
        config: {
          dataTypeId: "dt-1",
          fieldMapping: {},
          aggregation: { groupBy: "year", agg: "count", yField: "title" },
        },
      });
      const store = makeStore(panel);

      const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.chartAggregate).toEqual({
        categories: ["2020"],
        values: [2],
      });
    });

    it("chartAggregate is null when the chart panel has no aggregation spec", async () => {
      mockFetchDataTypeRows.mockResolvedValue({
        rows: [{ year: "2020", rating: 5 }],
        rowCount: 1,
      });

      const panel = makeChartPanel({
        config: { dataTypeId: "dt-1", fieldMapping: { xAxis: "year", yAxis: "rating" } },
      });
      const store = makeStore(panel);

      const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.chartAggregate).toBeNull();
    });

    it("chartAggregate is null for a metric panel (chart-only field)", () => {
      const store = makeStore();
      const panel = makeMetricPanel();
      const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });
      expect(result.current.chartAggregate).toBeNull();
    });
  });

  // ─── HEL-244: Text panel joins the bound-capable panel set ───────────────

  describe("bound Text panel", () => {
    it("resolves data.content from the first row's mapped field", async () => {
      mockFetchDataTypeRows.mockResolvedValue({
        rows: [{ headline: "Breaking news" }],
        rowCount: 1,
      });

      const panel = makeTextPanel({
        config: { dataTypeId: "dt-1", fieldMapping: { content: "headline" } },
      });
      const store = makeStore(panel);

      const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.data).toEqual({ content: "Breaking news" });
      expect(mockFetchDataTypeRows).toHaveBeenCalledWith("dt-1");
    });

    it("returns empty result for an unbound Text panel (empty dataTypeId)", () => {
      const store = makeStore();
      const panel = makeTextPanel({ config: { content: "Static text" } });
      const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });
      expect(result.current.data).toBeNull();
      expect(mockFetchDataTypeRows).not.toHaveBeenCalled();
    });

    it("sets noData when the bound DataType has no rows", async () => {
      mockFetchDataTypeRows.mockResolvedValue({ rows: [], rowCount: 0 });

      const panel = makeTextPanel({
        config: { dataTypeId: "dt-1", fieldMapping: { content: "headline" } },
      });
      const store = makeStore(panel);

      const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.noData).toBe(true);
      expect(result.current.data).toBeNull();
    });
  });
});
