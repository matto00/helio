import { configureStore } from "@reduxjs/toolkit";
import { renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { createElement } from "react";
import { Provider } from "react-redux";

import { panelsReducer, setCrossFilter } from "../state/panelsSlice";
import { makeOutputPanel } from "../../../test/panelFixtures";
import { useCrossFilteredPanelData } from "./useCrossFilteredPanelData";

function makeStore(crossFilter: Parameters<typeof setCrossFilter>[0] | null) {
  const store = configureStore({ reducer: { panels: panelsReducer } as never });
  if (crossFilter) store.dispatch(setCrossFilter(crossFilter));
  return store;
}

function wrapper(store: ReturnType<typeof makeStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(Provider, { store } as never, children);
  };
}

const headers = ["quarter", "revenue"];
const rawRows = [
  ["Q1", "100"],
  ["Q1", "150"],
  ["Q2", "120"],
];
const chartOutput = { kind: "chart", config: { fieldMapping: { xAxis: "quarter" } } };

describe("useCrossFilteredPanelData", () => {
  it("returns the original rawRows/headers (same reference) when no cross-filter is active", () => {
    const panel = makeOutputPanel({ id: "panel-1" });
    const { result } = renderHook(
      () => useCrossFilteredPanelData(panel, rawRows, headers, chartOutput),
      { wrapper: wrapper(makeStore(null)) },
    );

    expect(result.current.rawRows).toBe(rawRows);
    expect(result.current.isCrossFiltered).toBe(false);
  });

  it("narrows rawRows for a filterable sibling panel", () => {
    const panel = makeOutputPanel({ id: "panel-sibling" });
    const crossFilter = { panelId: "panel-origin", dimension: "quarter", value: "Q1", series: "" };
    const { result } = renderHook(
      () => useCrossFilteredPanelData(panel, rawRows, headers, chartOutput),
      { wrapper: wrapper(makeStore(crossFilter)) },
    );

    expect(result.current.rawRows).toEqual([
      ["Q1", "100"],
      ["Q1", "150"],
    ]);
    expect(result.current.isCrossFiltered).toBe(true);
    expect(result.current.loadedRowCount).toBe(3);
  });

  it("never narrows the originating panel's own rows", () => {
    const panel = makeOutputPanel({ id: "panel-origin" });
    const crossFilter = { panelId: "panel-origin", dimension: "quarter", value: "Q1", series: "" };
    const { result } = renderHook(
      () => useCrossFilteredPanelData(panel, rawRows, headers, chartOutput),
      { wrapper: wrapper(makeStore(crossFilter)) },
    );

    expect(result.current.rawRows).toBe(rawRows);
    expect(result.current.isCrossFiltered).toBe(false);
  });

  it("leaves a panel unaffected when its output kind doesn't map the dimension", () => {
    const panel = makeOutputPanel({ id: "panel-sibling" });
    const crossFilter = { panelId: "panel-origin", dimension: "quarter", value: "Q1", series: "" };
    const unrelatedOutput = { kind: "chart", config: { fieldMapping: { xAxis: "revenue" } } };
    const { result } = renderHook(
      () => useCrossFilteredPanelData(panel, rawRows, headers, unrelatedOutput),
      { wrapper: wrapper(makeStore(crossFilter)) },
    );

    expect(result.current.rawRows).toBe(rawRows);
    expect(result.current.isCrossFiltered).toBe(false);
  });

  // tasks.md 3.4 — a manual refresh/SSE fan-out refetch replaces `rawRows`
  // with a fresh array; the filter must re-derive from it, never hold onto a
  // stale filtered snapshot from before the refresh.
  it("re-derives the filtered rows when rawRows changes (simulating a refresh)", () => {
    const panel = makeOutputPanel({ id: "panel-sibling" });
    const crossFilter = { panelId: "panel-origin", dimension: "quarter", value: "Q1", series: "" };
    const store = makeStore(crossFilter);
    const { result, rerender } = renderHook(
      ({ rows }: { rows: string[][] }) =>
        useCrossFilteredPanelData(panel, rows, headers, chartOutput),
      { wrapper: wrapper(store), initialProps: { rows: rawRows } },
    );
    expect(result.current.rawRows).toHaveLength(2);

    const refreshedRows = [
      ["Q1", "100"],
      ["Q1", "150"],
      ["Q1", "200"],
    ];
    rerender({ rows: refreshedRows });

    expect(result.current.rawRows).toHaveLength(3);
    expect(result.current.loadedRowCount).toBe(3);
  });

  it("returns the original rawRows when the output metadata hasn't resolved yet (output: null)", () => {
    const panel = makeOutputPanel({ id: "panel-sibling" });
    const crossFilter = { panelId: "panel-origin", dimension: "quarter", value: "Q1", series: "" };
    const { result } = renderHook(() => useCrossFilteredPanelData(panel, rawRows, headers, null), {
      wrapper: wrapper(makeStore(crossFilter)),
    });

    expect(result.current.rawRows).toBe(rawRows);
    expect(result.current.isCrossFiltered).toBe(false);
  });
});
