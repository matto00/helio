import { act, renderHook } from "@testing-library/react";

import { useOutputTableColumns } from "./useOutputTableColumns";

describe("useOutputTableColumns", () => {
  it("seeds one visible row per field key in natural order when no columnOrder is stored", () => {
    const { result } = renderHook(() => useOutputTableColumns(["a", "b", "c"], undefined));
    expect(result.current.columns).toEqual([
      { key: "a", visible: true },
      { key: "b", visible: true },
      { key: "c", visible: true },
    ]);
    expect(result.current.columnOrder).toBeUndefined();
  });

  it("puts stored columnOrder's keys first as visible, then any remaining keys as hidden", () => {
    const { result } = renderHook(() => useOutputTableColumns(["a", "b", "c"], ["c", "a"]));
    expect(result.current.columns).toEqual([
      { key: "c", visible: true },
      { key: "a", visible: true },
      { key: "b", visible: false },
    ]);
  });

  it("toggleVisible flips one column's visibility", () => {
    const { result } = renderHook(() => useOutputTableColumns(["a", "b"], undefined));
    act(() => result.current.toggleVisible("a"));
    expect(result.current.columns.find((c) => c.key === "a")?.visible).toBe(false);
  });

  it("moveUp/moveDown reorder columns and columnOrder reflects the new visible order", () => {
    const { result } = renderHook(() => useOutputTableColumns(["a", "b"], undefined));
    act(() => result.current.moveDown(0));
    expect(result.current.columns.map((c) => c.key)).toEqual(["b", "a"]);
    expect(result.current.columnOrder).toEqual(["b", "a"]);
  });

  it("columnOrder is undefined once the visible order matches natural field order again", () => {
    const { result } = renderHook(() => useOutputTableColumns(["a", "b"], undefined));
    act(() => result.current.moveDown(0));
    act(() => result.current.moveUp(1));
    expect(result.current.columnOrder).toBeUndefined();
  });
});
