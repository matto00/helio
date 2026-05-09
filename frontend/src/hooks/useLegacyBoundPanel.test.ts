import { configureStore } from "@reduxjs/toolkit";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createElement } from "react";
import { Provider } from "react-redux";

import { dataTypesReducer } from "../features/dataTypes/dataTypesSlice";
import type { DataType, Panel } from "../types/models";
import { useLegacyBoundPanel } from "./useLegacyBoundPanel";

// ── helpers ───────────────────────────────────────────────────────────────────

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
    title: "Test Panel",
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

function makeDataType(overrides: Partial<DataType> = {}): DataType {
  return {
    id: "dt-1",
    name: "Revenue",
    sourceId: null,
    version: 1,
    fields: [],
    computedFields: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeStore(dataTypeItems: DataType[] = []) {
  return configureStore({
    reducer: { dataTypes: dataTypesReducer } as never,
    preloadedState: {
      dataTypes: { items: dataTypeItems, status: "succeeded", error: null },
    } as never,
  });
}

function wrapper(store: ReturnType<typeof makeStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(Provider, { store } as never, children);
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("useLegacyBoundPanel", () => {
  it("returns false for unbound panel (typeId null)", () => {
    const store = makeStore([makeDataType({ sourceId: "src-1" })]);
    const panel = makePanel({ typeId: null });

    const { result } = renderHook(() => useLegacyBoundPanel(panel), {
      wrapper: wrapper(store),
    });

    expect(result.current).toBe(false);
  });

  it("returns true for a legacy DataType (sourceId is set)", () => {
    const store = makeStore([makeDataType({ id: "dt-1", sourceId: "src-1" })]);
    const panel = makePanel({ typeId: "dt-1" });

    const { result } = renderHook(() => useLegacyBoundPanel(panel), {
      wrapper: wrapper(store),
    });

    expect(result.current).toBe(true);
  });

  it("returns false for a pipeline DataType (sourceId is null)", () => {
    const store = makeStore([makeDataType({ id: "dt-1", sourceId: null })]);
    const panel = makePanel({ typeId: "dt-1" });

    const { result } = renderHook(() => useLegacyBoundPanel(panel), {
      wrapper: wrapper(store),
    });

    expect(result.current).toBe(false);
  });

  it("returns false when dataTypes state is empty", () => {
    const store = makeStore([]);
    const panel = makePanel({ typeId: "dt-1" });

    const { result } = renderHook(() => useLegacyBoundPanel(panel), {
      wrapper: wrapper(store),
    });

    expect(result.current).toBe(false);
  });

  it("returns false when typeId does not match any DataType in the store", () => {
    const store = makeStore([makeDataType({ id: "dt-other", sourceId: "src-1" })]);
    const panel = makePanel({ typeId: "dt-1" });

    const { result } = renderHook(() => useLegacyBoundPanel(panel), {
      wrapper: wrapper(store),
    });

    expect(result.current).toBe(false);
  });
});
