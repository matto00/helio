import { useMemo, useState } from "react";

import type { ColumnDef } from "../../../../shared/ui/index";
import {
  useSortedRows,
  type SortColumn,
  type SortState,
} from "../../../../shared/ui/useSortedRows";
import type { TableColumnFilters } from "../../../pipelines/ui/outputEditor/outputConfigTypes";
import { isFiltering, rowMatchesFilters, type ColumnFormatters } from "./tableFilterPredicate";
import { resolveColumnFormatter } from "./columnFormatting";
import {
  UNSORTED_SENTINEL,
  deriveKeys,
  getSortValue,
  orderedColumns,
  sortFilterDisabledReason,
} from "./tableRendererModel";
import type { TableRendererProps } from "./tableRendererProps";

type UseTableRowsParams = Pick<
  TableRendererProps,
  | "paginationRows"
  | "rawRows"
  | "headers"
  | "schema"
  | "columnOrder"
  | "columnFormats"
  | "formatIntl"
  | "columnFilters"
  | "columnSort"
  | "onSortChange"
>;

export function useTableRows({
  paginationRows,
  rawRows,
  headers,
  schema,
  columnOrder,
  columnFormats,
  formatIntl,
  columnFilters,
  columnSort,
  onSortChange,
}: UseTableRowsParams) {
  // HEL-448 design D6a: ONE pre-branch normalization producing a single
  // `{ rows, columns }`, feeding ONE `useSortedRows` call — a per-branch
  // hook call violates rules-of-hooks (ESLint `react-hooks/rules-of-hooks`
  // is an ERROR under this repo's zero-warnings policy) since the
  // `paginationRows` and `rawRows` branches below derive DIFFERENT rows
  // (already-keyed records vs. positional arrays) and DIFFERENT columns.
  // HEL-1027 design.md D10 (task 4.7 RED-FIRST finding) — distinguishes "a real fetch has
  // landed, even with zero matching rows" (`paginationRows` is a real, possibly-empty array)
  // from "no pagination fetch has happened at all yet" (`null`/`undefined` — e.g. before
  // `usePanelData`'s own fetch resolves, a window `PanelContent`'s `isLoading` skeleton already
  // covers upstream). The OLD `.length > 0` check conflated these two: a genuine server-side
  // zero-match filtered result (this ticket) arrives as `paginationRows = []`, which that check
  // treated identically to "never fetched", silently falling through to the bare unstyled
  // skeleton (`TableRenderer.tsx`) instead of `DataGrid`'s own `emptyText`/`emptyAction` empty state — this is
  // the exact defect the D10 RED-FIRST proof (`PanelCard.filterEmptyState.test.tsx`) caught live.
  const usingPagination = paginationRows !== null && paginationRows !== undefined;
  const usingRaw = !usingPagination && Boolean(rawRows && rawRows.length > 0);

  const naturalKeys = useMemo(() => {
    if (usingPagination) {
      const rows = paginationRows as Record<string, unknown>[];
      if (rows.length > 0) return deriveKeys(rows);
      // Zero rows -- `deriveKeys` has nothing to infer column keys FROM (inferring a schema
      // from row data is a MISTAKES.md trap in the first place). Fall back to the Output's own
      // DECLARED schema (already resolved by the caller, no new fetch) so a zero-match filtered
      // grid still shows real column headers and per-column filter inputs, rather than a
      // columnless empty grid.
      return (schema ?? []).map((f) => f.name);
    }
    if (usingRaw) return headers ?? (rawRows as string[][])[0].map((_, i) => String(i + 1));
    return [];
  }, [usingPagination, usingRaw, paginationRows, headers, rawRows, schema]);

  const columns = useMemo<ColumnDef[]>(
    () => orderedColumns(naturalKeys, columnOrder),
    [naturalKeys, columnOrder],
  );

  // HEL-469 design D6b — ONE resolver per column, shared verbatim by the
  // render path (`formattedColumns` below, via `ColumnDef.render`) and the
  // filter path (`filteredRows`'s `rowMatchesFilters` call) so the two can
  // never silently diverge. A column with no entry in `columnFormats`
  // resolves to `formatCell` (via `resolveColumnFormatter`'s own fallback),
  // matching every existing (pre-HEL-469) column's behavior exactly.
  const formatters = useMemo<ColumnFormatters>(() => {
    const specs = columnFormats ?? {};
    const map: ColumnFormatters = {};
    for (const col of columns) {
      const spec = specs[col.key];
      if (spec) map[col.key] = resolveColumnFormatter(spec, formatIntl);
    }
    return map;
  }, [columns, columnFormats, formatIntl]);

  // HEL-469 design D3a (owner-ruled) — `DataGrid.tsx`'s `render` is the
  // ONLY consumer of a per-column format spec; `align` right-aligns
  // `number`/`currency` columns, header AND cell together. `sortColumns`
  // below reads `columns` (this array's UNFORMATTED source), never
  // `formattedColumns` — see D1/D1b.
  const formattedColumns = useMemo<ColumnDef[]>(() => {
    const specs = columnFormats ?? {};
    return columns.map((col) => {
      const spec = specs[col.key];
      const disabledReason = sortFilterDisabledReason(schema, col.key);
      const base: ColumnDef = spec
        ? {
            ...col,
            align:
              spec.type === "number" || spec.type === "currency" || spec.type === "duration"
                ? "right"
                : col.align,
            render: (_row: Record<string, unknown>, value: unknown) => formatters[col.key](value),
          }
        : col;
      return disabledReason ? { ...base, disabledReason } : base;
    });
  }, [columns, columnFormats, formatters, schema]);

  // The `rawRows` branch previously rebuilt this record array on every
  // render (inline in JSX below the early return) — memoized here too, or
  // it would defeat `useSortedRows`' `[rows, columns, sortState]` identity
  // memo on every render (cheap at panel row counts, but free to avoid).
  const normalizedRows = useMemo<Record<string, unknown>[]>(() => {
    if (usingPagination) return paginationRows as Record<string, unknown>[];
    if (usingRaw) {
      const keys = naturalKeys;
      return (rawRows as string[][]).map((row) =>
        Object.fromEntries(keys.map((key, i) => [key, row[i]])),
      );
    }
    return [];
  }, [usingPagination, usingRaw, paginationRows, rawRows, naturalKeys]);

  // HEL-451 design D1/D6a "Seeding note" (same rationale as `defaultSort`
  // below): seeded once from the persisted value, never re-derived when
  // `columnFilters` changes — correct only because `OutputPanelContent` withholds
  // this component behind a skeleton until `useOutputMeta` resolves.
  const [filters, setFilters] = useState<TableColumnFilters>(() => columnFilters ?? {});
  const filtering = isFiltering(filters);

  // HEL-451 design D3: filter BEFORE the existing `useSortedRows` call, in
  // the SAME single pipeline HEL-448 established — no second normalization,
  // no second hook call. `useMemo`-stable for the same reason
  // `normalizedRows` is: `useSortedRows` memoizes on
  // `[rows, columns, sortState]` by identity, and an unstable array defeats
  // it every render.
  const filteredRows = useMemo(
    () => normalizedRows.filter((row) => rowMatchesFilters(row, columns, filters, formatters)),
    [normalizedRows, columns, filters, formatters],
  );

  const sortColumns = useMemo<SortColumn<Record<string, unknown>, string>[]>(
    () => columns.map((col) => ({ key: col.key, getValue: (row) => getSortValue(row[col.key]) })),
    [columns],
  );

  // HEL-448 design D6a "Seeding note": seeding through `useSortedRows`'
  // `useState` initializer is correct ONLY because `OutputPanelContent` withholds
  // this component behind a skeleton until `useOutputMeta` resolves, so the
  // persisted value is present on first mount. `useSortedRows` has NO
  // reseed path — if that skeleton guard is ever relaxed, a later
  // `columnSort` prop change would silently stop applying.
  // Deliberately seeded once, never re-derived when `columnSort` changes —
  // see the comment above.
  const defaultSort = useMemo<SortState<string>>(
    () => columnSort ?? { key: UNSORTED_SENTINEL, direction: "asc" },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const { sortedRows, sortState, toggleSort } = useSortedRows(
    filteredRows,
    sortColumns,
    defaultSort,
  );

  // HEL-1027 design.md D4 (task 4.4) — bypasses the hook's own client-side reordering ONLY when a
  // real server round trip exists to have done it correctly instead: `usingPagination` (a table
  // fed paginated rows at all) AND `onSortChange` wired (the production `PanelCardBody` path,
  // which re-fetches server-sorted on every sort click). In that case the rows arriving in
  // `filteredRows` are ALREADY in the server's final order, and re-sorting them client-side would
  // risk exactly the masking bug the skeptic flagged (a local `toggleSort` cycling to a direction
  // the server was never asked for, silently disagreeing with what was actually fetched). Absent
  // `onSortChange` (`PanelDetailModal`/`PanelFullscreenOverlay`, which have no pagination/server
  // round trip at all — or a bare component test) keeps the ORIGINAL client-side resort exactly
  // as before this ticket, since there is no server response to trust instead.
  const displayRows = usingPagination && onSortChange != null ? filteredRows : sortedRows;

  return {
    usingPagination,
    usingRaw,
    columns,
    formattedColumns,
    normalizedRows,
    filters,
    setFilters,
    filtering,
    filteredRows,
    sortState,
    toggleSort,
    displayRows,
  };
}
