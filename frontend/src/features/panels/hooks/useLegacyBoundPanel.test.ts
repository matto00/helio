import { configureStore } from "@reduxjs/toolkit";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createElement } from "react";
import { Provider } from "react-redux";

import { dataTypesReducer } from "../../dataTypes/state/dataTypesSlice";
import { makeMetricPanel } from "../../../test/panelFixtures";
import type { DataType } from "../../dataTypes/types/dataType";
import { useLegacyBoundPanel } from "./useLegacyBoundPanel";

// ── helpers ───────────────────────────────────────────────────────────────────

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
  it("returns false for unbound panel (empty dataTypeId)", () => {
    const store = makeStore([makeDataType({ sourceId: "src-1" })]);
    const panel = makeMetricPanel({ config: { dataTypeId: "" } });

    const { result } = renderHook(() => useLegacyBoundPanel(panel), {
      wrapper: wrapper(store),
    });

    expect(result.current).toBe(false);
  });

  it("returns true for a legacy DataType (sourceId is set)", () => {
    const store = makeStore([makeDataType({ id: "dt-1", sourceId: "src-1" })]);
    const panel = makeMetricPanel({ config: { dataTypeId: "dt-1" } });

    const { result } = renderHook(() => useLegacyBoundPanel(panel), {
      wrapper: wrapper(store),
    });

    expect(result.current).toBe(true);
  });

  it("returns false for a pipeline DataType (sourceId is null)", () => {
    const store = makeStore([makeDataType({ id: "dt-1", sourceId: null })]);
    const panel = makeMetricPanel({ config: { dataTypeId: "dt-1" } });

    const { result } = renderHook(() => useLegacyBoundPanel(panel), {
      wrapper: wrapper(store),
    });

    expect(result.current).toBe(false);
  });

  it("returns false when dataTypes state is empty", () => {
    const store = makeStore([]);
    const panel = makeMetricPanel({ config: { dataTypeId: "dt-1" } });

    const { result } = renderHook(() => useLegacyBoundPanel(panel), {
      wrapper: wrapper(store),
    });

    expect(result.current).toBe(false);
  });

  it("returns false when typeId does not match any DataType in the store", () => {
    const store = makeStore([makeDataType({ id: "dt-other", sourceId: "src-1" })]);
    const panel = makeMetricPanel({ config: { dataTypeId: "dt-1" } });

    const { result } = renderHook(() => useLegacyBoundPanel(panel), {
      wrapper: wrapper(store),
    });

    expect(result.current).toBe(false);
  });
});
