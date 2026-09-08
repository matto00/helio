import { renderHook, act } from "@testing-library/react";

import { useSortedRows, type SortColumn } from "./useSortedRows";

interface Row {
  id: string;
  name: string;
  updatedAt: string | null;
  count: number | null;
}

const nameColumn: SortColumn<Row, "name" | "updatedAt" | "count"> = {
  key: "name",
  getValue: (r) => r.name,
};
const updatedAtColumn: SortColumn<Row, "name" | "updatedAt" | "count"> = {
  key: "updatedAt",
  getValue: (r) => r.updatedAt,
};
const countColumn: SortColumn<Row, "name" | "updatedAt" | "count"> = {
  key: "count",
  getValue: (r) => r.count,
};
const columns = [nameColumn, updatedAtColumn, countColumn];

describe("useSortedRows", () => {
  it("sorts nulls last in ascending order", () => {
    const rows: Row[] = [
      { id: "1", name: "a", updatedAt: null, count: 5 },
      { id: "2", name: "b", updatedAt: "2024-01-01T00:00:00Z", count: null },
      { id: "3", name: "c", updatedAt: "2023-01-01T00:00:00Z", count: null },
    ];
    const { result } = renderHook(() =>
      useSortedRows(rows, columns, { key: "updatedAt", direction: "asc" }),
    );
    expect(result.current.sortedRows.map((r) => r.id)).toEqual(["3", "2", "1"]);
  });

  it("sorts nulls last in descending order too", () => {
    const rows: Row[] = [
      { id: "1", name: "a", updatedAt: null, count: 5 },
      { id: "2", name: "b", updatedAt: "2024-01-01T00:00:00Z", count: null },
      { id: "3", name: "c", updatedAt: "2023-01-01T00:00:00Z", count: null },
    ];
    const { result } = renderHook(() =>
      useSortedRows(rows, columns, { key: "updatedAt", direction: "desc" }),
    );
    // A null "last run" must never occupy the top of a descending sort.
    expect(result.current.sortedRows.map((r) => r.id)).toEqual(["2", "3", "1"]);
  });

  it("orders ISO date strings chronologically, not lexically-by-accident", () => {
    const rows: Row[] = [
      { id: "1", name: "a", updatedAt: "2024-03-01T00:00:00Z", count: null },
      { id: "2", name: "b", updatedAt: "2024-01-15T00:00:00Z", count: null },
      { id: "3", name: "c", updatedAt: "2024-02-01T00:00:00Z", count: null },
    ];
    const { result } = renderHook(() =>
      useSortedRows(rows, columns, { key: "updatedAt", direction: "desc" }),
    );
    expect(result.current.sortedRows.map((r) => r.id)).toEqual(["1", "3", "2"]);
  });

  it("orders varying-fractional-second Instant.toString() timestamps as real instants, not by digit-run string comparison", () => {
    // HEL-1022 adversarial review finding 2: `java.time.Instant.toString()`
    // emits 0/3/6/9 fractional digits depending on the value (trailing
    // zero groups dropped) -- a numeric-digit-run string compare parses
    // "123456" and "900" as bare integers and gets 900 < 123456, exactly
    // backwards versus the real instants (900ms < 123.456ms is false; 900ms
    // is LATER than 123.456ms into the same second).
    const exactSecond: Row = {
      id: "exact",
      name: "x",
      updatedAt: "2024-01-01T12:00:00Z",
      count: null,
    };
    const micro: Row = {
      id: "micro",
      name: "x",
      updatedAt: "2024-01-01T12:00:00.123456Z",
      count: null,
    };
    const ms900: Row = {
      id: "ms900",
      name: "x",
      updatedAt: "2024-01-01T12:00:00.900Z",
      count: null,
    };

    const { result } = renderHook(() =>
      useSortedRows([exactSecond, micro, ms900], columns, { key: "updatedAt", direction: "desc" }),
    );
    expect(result.current.sortedRows.map((r) => r.id)).toEqual(["ms900", "micro", "exact"]);
  });

  it("toggleSort flips asc/desc on repeated clicks of the same column, and resets to asc on a new column", () => {
    const rows: Row[] = [
      { id: "1", name: "b", updatedAt: null, count: null },
      { id: "2", name: "a", updatedAt: null, count: null },
    ];
    const { result } = renderHook(() =>
      useSortedRows(rows, columns, { key: "name", direction: "asc" }),
    );

    expect(result.current.sortState).toEqual({ key: "name", direction: "asc" });
    expect(result.current.sortedRows.map((r) => r.id)).toEqual(["2", "1"]);

    act(() => result.current.toggleSort("name"));
    expect(result.current.sortState).toEqual({ key: "name", direction: "desc" });
    expect(result.current.sortedRows.map((r) => r.id)).toEqual(["1", "2"]);

    act(() => result.current.toggleSort("count"));
    expect(result.current.sortState).toEqual({ key: "count", direction: "asc" });
  });
});
