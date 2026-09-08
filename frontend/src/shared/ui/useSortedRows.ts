import { useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

/** A column's raw sort value. `string | number` cover both plain fields and
 *  ISO-8601 date strings; `null`/`undefined` represent "no value" and always
 *  sort last regardless of direction — a missing "last run" must never look
 *  like the most recent one.
 *
 *  ISO-8601 date strings do NOT sort correctly as plain strings here: every
 *  date-typed column in this codebase feeds `java.time.Instant.toString()`
 *  straight off the wire, and `Instant.toString()` emits 0, 3, 6, or 9
 *  fractional-second digits depending on the value (trailing zero groups are
 *  dropped) -- e.g. `"...12:00:00Z"`, `"...12:00:00.123456Z"`,
 *  `"...12:00:00.900Z"`. A digit-run-numeric string compare (what
 *  `localeCompare(..., { numeric: true })` does) parses `123456` and `900`
 *  as bare integers and gets the order backwards. Detected via
 *  `ISO_DATE_PATTERN` below and compared as epoch milliseconds instead. */
export type SortValue = string | number | null | undefined;

/** Matches exactly the `Instant.toString()` shape every backend timestamp on
 *  the wire uses (`YYYY-MM-DDTHH:mm:ss[.fraction]Z`) -- deliberately strict
 *  so an ordinary text column (a name, a URL) is never misdetected as a
 *  date. */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export interface SortColumn<Row, Key extends string> {
  key: Key;
  /** Extracts this column's comparable value from a row. */
  getValue: (row: Row) => SortValue;
}

export interface SortState<Key extends string> {
  key: Key;
  direction: SortDirection;
}

function compareNonNull(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (
    typeof a === "string" &&
    typeof b === "string" &&
    ISO_DATE_PATTERN.test(a) &&
    ISO_DATE_PATTERN.test(b)
  ) {
    // Compare as actual instants (epoch milliseconds), not as strings -- see
    // `SortValue`'s doc comment on why `Instant.toString()`'s variable
    // fractional-digit count breaks a plain string/numeric compare here.
    return Date.parse(a) - Date.parse(b);
  }
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

/** Nulls sort last in BOTH directions, so the null check must happen OUTSIDE
 *  the direction sign flip — applying the sign to a null's sentinel result
 *  would put it first in a descending sort instead. */
function compareValues(a: SortValue, b: SortValue, direction: SortDirection): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  const sign = direction === "asc" ? 1 : -1;
  return sign * compareNonNull(a, b);
}

/**
 * Client-side sort over an already-fetched row array. Sorting itself never
 * touches the network — pages needing a correct FIRST paint still need the
 * backend's own default ordering (see repository `.sortBy` calls).
 *
 * `columns` is keyed by a caller-defined `Key` union so `<SortableTh>` and
 * this hook agree on valid column identifiers at the type level.
 */
export function useSortedRows<Row, Key extends string>(
  rows: Row[],
  columns: readonly SortColumn<Row, Key>[],
  defaultSort: SortState<Key>,
): {
  sortedRows: Row[];
  sortState: SortState<Key>;
  toggleSort: (key: Key) => void;
} {
  const [sortState, setSortState] = useState<SortState<Key>>(defaultSort);

  const sortedRows = useMemo(() => {
    const column = columns.find((c) => c.key === sortState.key);
    if (!column) return rows;
    // `.slice()` — never mutate the caller's array in place.
    return rows
      .slice()
      .sort((a, b) => compareValues(column.getValue(a), column.getValue(b), sortState.direction));
  }, [rows, columns, sortState]);

  function toggleSort(key: Key) {
    setSortState((prev) => {
      if (prev.key !== key) return { key, direction: "asc" };
      return { key, direction: prev.direction === "asc" ? "desc" : "asc" };
    });
  }

  return { sortedRows, sortState, toggleSort };
}
