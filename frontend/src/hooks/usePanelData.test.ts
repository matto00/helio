import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createElement } from "react";
import { Provider } from "react-redux";

import { sourcesReducer } from "../features/sources/sourcesSlice";
import { dataTypesReducer } from "../features/dataTypes/dataTypesSlice";
import { fetchSources } from "../features/sources/sourcesSlice";
import * as dataSourceService from "../services/dataSourceService";
import type { DataSource, DataType, Panel } from "../types/models";
import { usePanelData } from "./usePanelData";

jest.mock("../services/dataSourceService");

const mockFetchCsvPreview = dataSourceService.fetchCsvPreview as jest.MockedFunction<
  typeof dataSourceService.fetchCsvPreview
>;
const mockFetchRestPreview = dataSourceService.fetchRestPreview as jest.MockedFunction<
  typeof dataSourceService.fetchRestPreview
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
    ...overrides,
  };
}

const csvSource: DataSource = {
  id: "src-csv",
  name: "CSV Source",
  sourceType: "csv",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const restSource: DataSource = {
  id: "src-rest",
  name: "REST Source",
  sourceType: "rest_api",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const csvDataType: DataType = {
  id: "dt-csv",
  name: "CSV Type",
  sourceId: "src-csv",
  version: 1,
  fields: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const restDataType: DataType = {
  id: "dt-rest",
  name: "REST Type",
  sourceId: "src-rest",
  version: 1,
  fields: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function makeStore(
  sourcesStatus: "idle" | "loading" | "succeeded" | "failed" = "succeeded",
  sourceItems: DataSource[] = [csvSource, restSource],
) {
  const store = configureStore({
    reducer: {
      sources: sourcesReducer,
      dataTypes: dataTypesReducer,
    } as never,
  });

  if (sourcesStatus === "succeeded") {
    store.dispatch(fetchSources.fulfilled(sourceItems, "req", undefined));
  } else if (sourcesStatus === "idle") {
    // leave idle
  }

  return store;
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
    const { result } = renderHook(
      () => usePanelData(panel, [], { items: [], status: "succeeded" }),
      { wrapper: wrapper(store) },
    );
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.noData).toBe(false);
    expect(mockFetchCsvPreview).not.toHaveBeenCalled();
    expect(mockFetchRestPreview).not.toHaveBeenCalled();
  });

  it("fetches CSV preview and maps fieldMapping for a CSV-bound panel", async () => {
    mockFetchCsvPreview.mockResolvedValue({
      headers: ["revenue", "region"],
      rows: [["1000", "North"]],
    });

    const store = makeStore();
    const panel = makePanel({
      typeId: "dt-csv",
      fieldMapping: { value: "revenue", label: "region" },
    });

    const { result } = renderHook(
      () => usePanelData(panel, [csvDataType], { items: [csvSource], status: "succeeded" }),
      { wrapper: wrapper(store) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockFetchCsvPreview).toHaveBeenCalledWith("src-csv");
    expect(result.current.data).toEqual({ value: "1000", label: "North" });
    expect(result.current.rawRows).toEqual([["1000", "North"]]);
    expect(result.current.headers).toEqual(["revenue", "region"]);
    expect(result.current.error).toBeNull();
    expect(result.current.noData).toBe(false);
  });

  it("fetches REST preview and maps fieldMapping for a REST-bound panel", async () => {
    mockFetchRestPreview.mockResolvedValue({
      rows: [{ revenue: 2500, region: "South" }],
    });

    const store = makeStore();
    const panel = makePanel({
      typeId: "dt-rest",
      fieldMapping: { value: "revenue", label: "region" },
    });

    const { result } = renderHook(
      () => usePanelData(panel, [restDataType], { items: [restSource], status: "succeeded" }),
      { wrapper: wrapper(store) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockFetchRestPreview).toHaveBeenCalledWith("src-rest");
    expect(result.current.data).toEqual({ value: "2500", label: "South" });
    expect(result.current.error).toBeNull();
    expect(result.current.noData).toBe(false);
  });

  it("sets noData when preview returns empty rows", async () => {
    mockFetchCsvPreview.mockResolvedValue({ headers: [], rows: [] });

    const store = makeStore();
    const panel = makePanel({ typeId: "dt-csv", fieldMapping: { value: "revenue" } });

    const { result } = renderHook(
      () => usePanelData(panel, [csvDataType], { items: [csvSource], status: "succeeded" }),
      { wrapper: wrapper(store) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.noData).toBe(true);
    expect(result.current.data).toBeNull();
  });

  it("sets error when fetch throws", async () => {
    mockFetchCsvPreview.mockRejectedValue(new Error("Network error"));

    const store = makeStore();
    const panel = makePanel({ typeId: "dt-csv", fieldMapping: { value: "revenue" } });

    const { result } = renderHook(
      () => usePanelData(panel, [csvDataType], { items: [csvSource], status: "succeeded" }),
      { wrapper: wrapper(store) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe("Failed to load data.");
    expect(result.current.data).toBeNull();
  });

  it("dispatches fetchSources when sources status is idle and panel is bound", () => {
    const store = makeStore("idle");
    const dispatchSpy = jest.spyOn(store, "dispatch");

    const panel = makePanel({ typeId: "dt-csv", fieldMapping: { value: "revenue" } });

    renderHook(() => usePanelData(panel, [csvDataType], { items: [], status: "idle" }), {
      wrapper: wrapper(store),
    });

    expect(dispatchSpy).toHaveBeenCalled();
  });

  it("exposes a refresh callback that is a function", () => {
    const store = makeStore();
    const panel = makePanel({ typeId: null });
    const { result } = renderHook(
      () => usePanelData(panel, [], { items: [], status: "succeeded" }),
      { wrapper: wrapper(store) },
    );
    expect(typeof result.current.refresh).toBe("function");
  });

  it("refresh callback triggers a re-fetch for a bound panel", async () => {
    mockFetchCsvPreview.mockResolvedValue({
      headers: ["revenue", "region"],
      rows: [["1000", "North"]],
    });

    const store = makeStore();
    const panel = makePanel({
      typeId: "dt-csv",
      fieldMapping: { value: "revenue", label: "region" },
    });

    const { result } = renderHook(
      () => usePanelData(panel, [csvDataType], { items: [csvSource], status: "succeeded" }),
      { wrapper: wrapper(store) },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockFetchCsvPreview).toHaveBeenCalledTimes(1);

    // Calling refresh() should trigger another fetch
    act(() => {
      result.current.refresh();
    });

    // Wait for the second fetch to complete and data to be populated
    await waitFor(() => expect(mockFetchCsvPreview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ value: "1000", label: "North" });
  });

  it("refresh callback is stable across re-renders", () => {
    const store = makeStore();
    const panel = makePanel({ typeId: null });
    const { result, rerender } = renderHook(
      () => usePanelData(panel, [], { items: [], status: "succeeded" }),
      { wrapper: wrapper(store) },
    );

    const firstRefresh = result.current.refresh;
    rerender();
    expect(result.current.refresh).toBe(firstRefresh);
  });
});
