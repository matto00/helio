import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createElement } from "react";
import { Provider } from "react-redux";

import { panelsReducer } from "../features/panels/panelsSlice";
import * as dataTypeService from "../services/dataTypeService";
import { makeMetricPanel } from "../test/panelFixtures";
import type { Panel } from "../types/models";
import { usePanelData } from "./usePanelData";

jest.mock("../services/dataTypeService");

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
});
