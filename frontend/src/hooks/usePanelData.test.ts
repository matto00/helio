import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createElement } from "react";
import { Provider } from "react-redux";

import { panelsReducer } from "../features/panels/panelsSlice";
import * as panelService from "../services/panelService";
import type { Panel } from "../types/models";
import { usePanelData } from "./usePanelData";

jest.mock("../services/panelService");

const mockFetchPanelExecutePage = panelService.fetchPanelExecutePage as jest.MockedFunction<
  typeof panelService.fetchPanelExecutePage
>;

const defaultMeta = {
  createdBy: "system",
  createdAt: "2026-01-01T00:00:00Z",
  lastUpdated: "2026-01-01T00:00:00Z",
};
const defaultAppearance = { background: "transparent", color: "#ffffff", transparency: 0 };

function makePanel(overrides: Partial<Panel> = {}): Panel {
  return {
    id: "p1",
    dashboardId: "d1",
    title: "Test",
    type: "metric",
    meta: defaultMeta,
    appearance: defaultAppearance,
    typeId: null,
    fieldMapping: null,
    refreshInterval: null,
    content: null,
    imageUrl: null,
    imageFit: null,
    dividerOrientation: null,
    dividerWeight: null,
    dividerColor: null,
    ...overrides,
  } as Panel;
}

function makeStore() {
  return configureStore({
    reducer: {
      panels: panelsReducer,
    } as never,
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

  it("returns empty result for unbound panel (no typeId)", () => {
    const store = makeStore();
    const panel = makePanel({ typeId: null });
    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.noData).toBe(false);
    expect(mockFetchPanelExecutePage).not.toHaveBeenCalled();
  });

  it("dispatches fetchPanelPage with pageSize 10 for metric panel", async () => {
    mockFetchPanelExecutePage.mockResolvedValue({
      page: 0,
      pageSize: 10,
      hasMore: false,
      columns: ["revenue", "region"],
      rows: [{ revenue: "1000", region: "North" }],
    });

    const store = makeStore();
    const panel = makePanel({ type: "metric", typeId: "dt-1", fieldMapping: { value: "revenue" } });

    renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    await waitFor(() => expect(mockFetchPanelExecutePage).toHaveBeenCalledWith("p1", 0, 10));
  });

  it("dispatches fetchPanelPage with pageSize 200 for chart panel", async () => {
    mockFetchPanelExecutePage.mockResolvedValue({
      page: 0,
      pageSize: 200,
      hasMore: false,
      columns: ["x", "y"],
      rows: [{ x: "1", y: "100" }],
    });

    const store = makeStore();
    const panel = makePanel({ type: "chart", typeId: "dt-1", fieldMapping: { x: "x", y: "y" } });

    renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    await waitFor(() => expect(mockFetchPanelExecutePage).toHaveBeenCalledWith("p1", 0, 200));
  });

  it("dispatches fetchPanelPage with pageSize 50 for table panel", async () => {
    mockFetchPanelExecutePage.mockResolvedValue({
      page: 0,
      pageSize: 50,
      hasMore: false,
      columns: [],
      rows: [],
    });

    const store = makeStore();
    const panel = makePanel({ type: "table", typeId: "dt-1", fieldMapping: {} });

    renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    await waitFor(() => expect(mockFetchPanelExecutePage).toHaveBeenCalledWith("p1", 0, 50));
  });

  it("maps fieldMapping from paginationEntry rows", async () => {
    mockFetchPanelExecutePage.mockResolvedValue({
      page: 0,
      pageSize: 10,
      hasMore: false,
      columns: ["revenue", "region"],
      rows: [{ revenue: "1000", region: "North" }],
    });

    const store = makeStore();
    const panel = makePanel({
      type: "metric",
      typeId: "dt-1",
      fieldMapping: { value: "revenue", label: "region" },
    });

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual({ value: "1000", label: "North" });
    expect(result.current.rawRows).toEqual([["1000", "North"]]);
    expect(result.current.headers).toEqual(["revenue", "region"]);
    expect(result.current.error).toBeNull();
    expect(result.current.noData).toBe(false);
  });

  it("sets noData when execute page returns empty rows", async () => {
    mockFetchPanelExecutePage.mockResolvedValue({
      page: 0,
      pageSize: 10,
      hasMore: false,
      columns: [],
      rows: [],
    });

    const store = makeStore();
    const panel = makePanel({ typeId: "dt-1", fieldMapping: { value: "revenue" } });

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.noData).toBe(true);
    expect(result.current.data).toBeNull();
  });

  it("sets error when fetchPanelPage fails", async () => {
    mockFetchPanelExecutePage.mockRejectedValue(new Error("Network error"));

    const store = makeStore();
    const panel = makePanel({ typeId: "dt-1", fieldMapping: { value: "revenue" } });

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    await waitFor(() => expect(result.current.error).toBe("Failed to load data."));
    expect(result.current.data).toBeNull();
  });

  it("exposes a refresh callback that is a function", () => {
    const store = makeStore();
    const panel = makePanel({ typeId: null });
    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });
    expect(typeof result.current.refresh).toBe("function");
  });

  it("refresh callback triggers a re-fetch for a bound panel", async () => {
    mockFetchPanelExecutePage.mockResolvedValue({
      page: 0,
      pageSize: 10,
      hasMore: false,
      columns: ["revenue", "region"],
      rows: [{ revenue: "1000", region: "North" }],
    });

    const store = makeStore();
    const panel = makePanel({
      typeId: "dt-1",
      fieldMapping: { value: "revenue", label: "region" },
    });

    const { result } = renderHook(() => usePanelData(panel), { wrapper: wrapper(store) });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockFetchPanelExecutePage).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(mockFetchPanelExecutePage).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ value: "1000", label: "North" });
  });

  it("refresh callback is stable across re-renders", () => {
    const store = makeStore();
    const panel = makePanel({ typeId: null });
    const { result, rerender } = renderHook(() => usePanelData(panel), {
      wrapper: wrapper(store),
    });

    const firstRefresh = result.current.refresh;
    rerender();
    expect(result.current.refresh).toBe(firstRefresh);
  });
});
