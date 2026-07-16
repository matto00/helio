import { act, renderHook } from "@testing-library/react";

import { useTableDisplayState } from "./useTableDisplayState";
import type { TablePanel, TablePanelConfig } from "../../types/panel";

function tablePanel(config: Partial<TablePanelConfig>): TablePanel {
  return {
    id: "panel-1",
    dashboardId: "d-1",
    title: "Rows",
    meta: { createdBy: "u", createdAt: "", lastUpdated: "" },
    appearance: { background: "transparent", color: "inherit", transparency: 0 },
    type: "table",
    config: { dataTypeId: "dt1", fieldMapping: {}, ...config },
  };
}

describe("useTableDisplayState (HEL-255)", () => {
  it("seeds density + columns from config and starts clean", () => {
    const panel = tablePanel({ density: "spacious", columnOrder: ["b"] });
    const { result } = renderHook(() => useTableDisplayState(panel, ["a", "b"], "dt1"));

    expect(result.current.density).toBe("spacious");
    // columnOrder ["b"] → b visible first, a appended hidden.
    expect(result.current.columns).toEqual([
      { key: "b", visible: true },
      { key: "a", visible: false },
    ]);
    expect(result.current.dirty).toBe(false);
    expect(result.current.patch).toEqual({
      density: undefined,
      columnOrder: undefined,
      columnWidths: undefined,
    });
  });

  it("defaults to normal density with all columns visible in natural order when absent", () => {
    const panel = tablePanel({});
    const { result } = renderHook(() => useTableDisplayState(panel, ["a", "b", "c"], "dt1"));

    expect(result.current.density).toBe("normal");
    expect(result.current.columns).toEqual([
      { key: "a", visible: true },
      { key: "b", visible: true },
      { key: "c", visible: true },
    ]);
  });

  it("hides a column and reorders → patch.columnOrder is the visible keys in row order", () => {
    const panel = tablePanel({});
    const { result } = renderHook(() => useTableDisplayState(panel, ["a", "b", "c"], "dt1"));

    // Hide b, then move c above a → visible order ["c", "a"].
    act(() => result.current.toggleVisible("b"));
    act(() => result.current.moveUp(2));
    act(() => result.current.moveUp(1));

    expect(result.current.dirty).toBe(true);
    expect(result.current.patch.columnOrder).toEqual(["c", "a"]);
  });

  it("emits columnOrder null (default) when every field is visible in natural order", () => {
    // Stored a hidden column; re-showing it and restoring order returns to default.
    const panel = tablePanel({ columnOrder: ["a"] });
    const { result } = renderHook(() => useTableDisplayState(panel, ["a", "b"], "dt1"));

    act(() => result.current.toggleVisible("b")); // now a, b both visible in order

    expect(result.current.dirty).toBe(true);
    expect(result.current.patch.columnOrder).toBeNull();
  });

  it("changing density marks dirty and sets patch.density", () => {
    const panel = tablePanel({});
    const { result } = renderHook(() => useTableDisplayState(panel, ["a"], "dt1"));

    act(() => result.current.setDensity("condensed"));

    expect(result.current.dirty).toBe(true);
    expect(result.current.patch.density).toBe("condensed");
  });

  it("reports stored widths and requests a width reset via patch.columnWidths null", () => {
    const panel = tablePanel({ columnWidths: { a: 200 } });
    const { result } = renderHook(() => useTableDisplayState(panel, ["a"], "dt1"));

    expect(result.current.hasStoredWidths).toBe(true);
    expect(result.current.resetWidthsPending).toBe(false);

    act(() => result.current.requestResetWidths());

    expect(result.current.resetWidthsPending).toBe(true);
    expect(result.current.dirty).toBe(true);
    expect(result.current.patch.columnWidths).toBeNull();
  });

  it("reports no stored widths when columnWidths is empty/absent", () => {
    const { result } = renderHook(() => useTableDisplayState(tablePanel({}), ["a"], "dt1"));
    expect(result.current.hasStoredWidths).toBe(false);
  });

  it("reset() reverts density, columns, and a pending width reset", () => {
    const panel = tablePanel({ density: "spacious", columnWidths: { a: 200 } });
    const { result } = renderHook(() => useTableDisplayState(panel, ["a", "b"], "dt1"));

    act(() => result.current.setDensity("condensed"));
    act(() => result.current.toggleVisible("b"));
    act(() => result.current.requestResetWidths());
    expect(result.current.dirty).toBe(true);

    act(() => result.current.reset());

    expect(result.current.density).toBe("spacious");
    expect(result.current.resetWidthsPending).toBe(false);
    expect(result.current.columns).toEqual([
      { key: "a", visible: true },
      { key: "b", visible: true },
    ]);
    expect(result.current.dirty).toBe(false);
  });

  it("produces no columns when unbound (no field keys)", () => {
    const { result } = renderHook(() => useTableDisplayState(tablePanel({}), [], null));
    expect(result.current.columns).toEqual([]);
  });
});
