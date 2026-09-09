import { useEffect, useMemo, useRef, useState } from "react";

import "./TableRenderer.css";
import { DataGrid, Spinner, formatCell } from "../../../../shared/ui/index";
import type { ColumnDef } from "../../../../shared/ui/index";
import {
  useSortedRows,
  type SortColumn,
  type SortState,
  type SortValue,
} from "../../../../shared/ui/useSortedRows";
import { updateOutput } from "../../../pipelines/services/outputService";
import { useAppSelector } from "../../../../hooks/reduxHooks";
import type {
  TableColumnFilters,
  TableColumnFormats,
} from "../../../pipelines/ui/outputEditor/outputConfigTypes";
import {
  isFiltering,
  normalizeColumnFiltersForWrite,
  rowMatchesFilters,
  type ColumnFormatters,
} from "./tableFilterPredicate";
import { resolveColumnFormatter, type FormatIntlOptions } from "./columnFormatting";
import { LoadedScopeDisclosure } from "./LoadedScopeDisclosure";

interface TableRendererProps {
  /** Bound Output id — renamed from the pre-HEL-909 `panelId` (this always
   *  carried an Output id despite the name); now also the id `columnSort`
   *  persists against via `updateOutput`. */
  outputId: string;
  /** The Output's owner — used for the HEL-448 D7 pre-check (a
   *  shared-dashboard grantee can sort on screen, but their sort never
   *  writes back, since `updateOutput` is an RLS owner-only write). */
  ownerId?: string;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  /** Rows from the paginated execute endpoint (keyed by column name). */
  paginationRows?: Record<string, unknown>[] | null;
  paginationIsLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** HEL-451 design D4: branch-independent truncation signal from
   *  `usePanelData` (`paginationEntry.hasMore`) — the ONLY correct source
   *  for "is the loaded set truncated", on EITHER branch. Must NOT be
   *  re-derived locally as `usingPagination && paginationHasMore`; that was
   *  HEL-448's original (wrong) predicate, false in the panel detail modal
   *  regardless of real truncation. Defaults to `false` only when genuinely
   *  unknown (e.g. in tests that don't pass it). */
  rowsTruncated?: boolean;
  /** Visible-column order from the Output's `TableOutputConfig.columnOrder`;
   *  absent or empty → all columns in natural order. */
  columnOrder?: string[];
  /** Persisted sort from the Output's `TableOutputConfig.columnSort`;
   *  absent/`null` → renders the pipeline's own row order (see
   *  `UNSORTED_SENTINEL` below). */
  columnSort?: SortState<string> | null;
  /** Persisted filter state from the Output's `TableOutputConfig
   *  .columnFilters` (HEL-451 design D1); absent/`null` → no active filter. */
  columnFilters?: TableColumnFilters | null;
  /** Persisted per-column format specs from the Output's
   *  `TableOutputConfig.columnFormats` (HEL-469 design D1a); absent →
   *  every column renders unformatted, exactly as before this ticket. */
  columnFormats?: TableColumnFormats;
  /** TEST-ONLY (evaluation-1.md change request 1 / design D4/task 4.0): an
   *  EXPLICIT locale/timeZone override for `resolveColumnFormatter`, never
   *  passed by production code (see `PanelContent.tsx`, which does not set
   *  this prop) — production keeps `Intl`'s locale-aware runtime defaults.
   *  `TableRenderer.test.tsx` passes this explicitly for every assertion
   *  over rendered formatted text, so those tests are pinned the same way
   *  `columnFormatting.test.ts`'s direct formatter tests already are,
   *  rather than inheriting the host's locale (or mutating the `Intl`
   *  global, which design D4/task 4.0 rules out). */
  formatIntl?: FormatIntlOptions;
}

/** Matches `DataGrid.deriveColumns`'s natural/numeric collator so a column set
 *  like col_0, col_1, col_10 sorts numerically instead of lexically. HEL-127. */
const naturalKeyCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Union of keys across the first 50 rows, in natural-sorted order — matches
 *  `DataGrid.deriveColumns` so the natural (unordered) column set is identical
 *  whether or not `columnOrder` is applied. */
function deriveKeys(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows.slice(0, 50)) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  return Array.from(seen).sort((a, b) => naturalKeyCollator.compare(a, b));
}

/** Build the ordered/filtered `ColumnDef[]` per HEL-255 design D2: absent or
 *  empty `columnOrder` → all natural keys in order; non-empty → exactly the
 *  listed keys, in that order, intersected with the keys present in the data
 *  (stale keys are skipped, never rendered as empty columns). */
function orderedColumns(naturalKeys: string[], columnOrder?: string[]): ColumnDef[] {
  if (!columnOrder || columnOrder.length === 0) {
    return naturalKeys.map((key) => ({ key }));
  }
  const present = new Set(naturalKeys);
  return columnOrder.filter((key) => present.has(key)).map((key) => ({ key }));
}

/** Sentinel `defaultSort` key that matches no real column (HEL-448 design
 *  D2) — a `__helio_` prefix so it can never collide with an actual JSON
 *  column name. `useSortedRows`' `sortedRows` memo does `columns.find(c =>
 *  c.key === sortState.key)` and returns `rows` UNCHANGED when nothing
 *  matches (`useSortedRows.ts`), which is how a never-sorted panel renders
 *  the pipeline's own row order with every header at its neutral glyph.
 *  That passthrough is real but UNSPECIFIED behavior of the hook — load-
 *  bearing here in a way it isn't for the list tables, which always seed a
 *  real column. See `TableRenderer.test.tsx`'s mutation-failable guard for
 *  this dependency, and design.md D2 for why this deliberately deviates
 *  from DESIGN.md's (~458) "`defaultSort` should match the page's
 *  backend-driven default order" guidance: a panel table's columns are not
 *  known until runtime, so no real column can be nominated as a default. */
const UNSORTED_SENTINEL = "__helio_unsorted__";

/** HEL-448 design D3 — a value ADAPTER, not a comparator. `useSortedRows`'
 *  comparator (nulls-last in both directions, `Instant.toString()` parsed to
 *  epoch millis) is reused completely unchanged; this only coerces the
 *  panel's `unknown` cell values into `SortValue`'s domain, per value (not
 *  per column, so a mixed column degrades to a stable non-numeric ordering
 *  instead of an error).
 *
 *  Two DIFFERENT blank traps, both required: `Number("") === 0` would sort a
 *  blank as zero, and merely guarding against that while letting `""` pass
 *  through as a string is ALSO wrong — `useSortedRows`' blanks-last check
 *  keys on `null`/`undefined` only, so a passed-through `""` reaches
 *  `localeCompare` and sorts FIRST ascending
 *  (`"".localeCompare("-5", undefined, {numeric:true})` is `-1`). Mapping
 *  empty/whitespace-only strings to `null` routes them into the hook's
 *  blanks-last branch instead. */
function getSortValue(value: unknown): SortValue {
  if (value === null || value === undefined || typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const asNumber = Number(trimmed);
    // `Number("")` is `0`, already excluded above by the blank check; every
    // other non-numeric string (including ISO date strings) fails
    // `Number.isFinite` and falls through to the hook's own string/date
    // comparison path unchanged.
    if (Number.isFinite(asNumber)) return asNumber;
    return value;
  }
  // `formatCell` (not a bare `String(v)`), for a DIFFERENT reason than the
  // one previously stated here (HEL-469 design D1/task 3.2b — the old
  // rationale, "so the sort key matches the rendered cell text", became
  // FALSE the moment a column can carry a per-column format spec: the
  // rendered text is then `render(row, value)`, not `formatCell(value)`).
  // The real reason: sorting must NOT depend on display formatting, so the
  // object branch stays on a STABLE JSON sort key regardless of any format
  // spec on the column. `String({})` collapses every object to the same
  // "[object Object]" tie, while `formatCell` JSON-stringifies it, which is
  // why this branch uses `formatCell` and not a bare `String(v)` — but it is
  // NOT re-pointed at the per-column formatter, and must never be. See
  // design D1/D1b and `TableRenderer.test.tsx`'s mutation-failable sort
  // guard, which asserts this at the call site below, not here.
  return formatCell(value);
}

const PERSIST_DEBOUNCE_MS = 300;

/** HEL-448 skeptic final-1 CR1: `updateOutput` can reject for reasons this
 *  surface has no say over -- e.g. a legacy Output whose `fieldMapping`
 *  predates `OutputBindingSpec.Table` having no slots, which fails
 *  HEL-892's merged-config validation with a 400 on every write (4/53
 *  table Outputs in dev as of this writing), or a 403 if `canWrite`'s
 *  snapshot of ownership goes stale mid-session. Design D7 mandates that a
 *  persist failure degrade SILENTLY to session-local -- no toast, no error
 *  surface, the on-screen sort stays exactly as the user left it -- so this
 *  is a DELIBERATE swallow of a config-write rejection, not a missed catch.
 *  Both `updateOutput` call sites below route through this one function so
 *  neither can regress back to a bare unhandled `void updateOutput(...)`. */
function persistColumnSort(outputId: string, sort: SortState<string>): void {
  void updateOutput(outputId, { config: { columnSort: sort } }).catch(() => {
    // Intentionally silent -- see the function doc comment above.
  });
}

/** HEL-451 design D6 — same minimal-patch, deliberate-swallow shape as
 *  `persistColumnSort` above (design D6 reuses D6/D7's persistence path
 *  exactly); `filters` is already normalized (empty terms stripped, or the
 *  whole value collapsed to `null`) by the caller before this is invoked. */
function persistColumnFilters(outputId: string, filters: TableColumnFilters | null): void {
  void updateOutput(outputId, { config: { columnFilters: filters } }).catch(() => {
    // Intentionally silent -- see persistColumnSort's doc comment above.
  });
}

export function TableRenderer({
  outputId,
  ownerId,
  rawRows,
  headers,
  paginationRows,
  paginationIsLoadingMore,
  onLoadMore,
  rowsTruncated = false,
  columnOrder,
  columnSort,
  columnFilters,
  columnFormats,
  formatIntl,
}: TableRendererProps) {
  // Local-only column widths (no longer persisted — see the file's HEL-909
  // interface-parity note, now folded into the `outputId` doc comment).
  const [widths, setWidths] = useState<Record<string, number>>({});

  const handleColumnResize = (key: string, width: number) => {
    setWidths((prev) => ({ ...prev, [key]: width }));
  };

  // HEL-448 design D7: pre-check, never attempt-then-swallow-403. A
  // grantee's sort stays session-local, silently — no toast, no disabled
  // control.
  const currentUserId = useAppSelector((state) => state.auth.currentUser?.id ?? null);
  const canWrite = ownerId != null && currentUserId != null && ownerId === currentUserId;

  // HEL-448 design D6a: ONE pre-branch normalization producing a single
  // `{ rows, columns }`, feeding ONE `useSortedRows` call — a per-branch
  // hook call violates rules-of-hooks (ESLint `react-hooks/rules-of-hooks`
  // is an ERROR under this repo's zero-warnings policy) since the
  // `paginationRows` and `rawRows` branches below derive DIFFERENT rows
  // (already-keyed records vs. positional arrays) and DIFFERENT columns.
  const usingPagination = Boolean(paginationRows && paginationRows.length > 0);
  const usingRaw = !usingPagination && Boolean(rawRows && rawRows.length > 0);

  const naturalKeys = useMemo(() => {
    if (usingPagination) return deriveKeys(paginationRows as Record<string, unknown>[]);
    if (usingRaw) return headers ?? (rawRows as string[][])[0].map((_, i) => String(i + 1));
    return [];
  }, [usingPagination, usingRaw, paginationRows, headers, rawRows]);

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
      if (!spec) return col;
      const formatter = formatters[col.key];
      return {
        ...col,
        align: spec.type === "number" || spec.type === "currency" ? "right" : col.align,
        render: (_row: Record<string, unknown>, value: unknown) => formatter(value),
      };
    });
  }, [columns, columnFormats, formatters]);

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
  // `columnFilters` changes — correct only because `PanelContent` withholds
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
  // `useState` initializer is correct ONLY because `PanelContent` withholds
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

  // HEL-448 design D6: the debounced PATCH MUST flush (not cancel) on
  // unmount — closing the panel detail modal unmounts this component, which
  // is exactly the path the "sort persists across detail-modal open/close"
  // AC exercises. A cancelling `clearTimeout`-on-cleanup would turn that AC
  // into a race the user loses whenever they close the modal inside the
  // debounce window.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSortRef = useRef<SortState<string> | null>(null);

  // HEL-451 design D6: same flush-not-cancel contract as the sort timer
  // above, kept as an INDEPENDENT timer/ref pair — a filter edit and a sort
  // click can each be mid-debounce at the same time, and each must flush
  // its own pending write on unmount regardless of the other's state.
  // `undefined` means "no pending filter write"; `null` is a real pending
  // write that CLEARS the persisted filter (design D1's normalize-to-null).
  const filterPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFiltersRef = useRef<TableColumnFilters | null | undefined>(undefined);

  // Flush uses refs, not state, so it always sees the latest pending write
  // regardless of this effect's own dependency array.
  useEffect(() => {
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        if (pendingSortRef.current) {
          persistColumnSort(outputId, pendingSortRef.current);
        }
      }
      if (filterPersistTimerRef.current) {
        clearTimeout(filterPersistTimerRef.current);
        if (pendingFiltersRef.current !== undefined) {
          persistColumnFilters(outputId, pendingFiltersRef.current);
        }
      }
    };
  }, [outputId]);

  // The persist fires from THIS handler (a real user activation) — never
  // from an effect observing `sortState`, which would also fire on mount
  // with the sentinel and PATCH it into every table Output a user merely
  // views (design D6). The asc/desc math below mirrors `useSortedRows`'
  // own `toggleSort` reducer exactly, because `toggleSort`'s state update is
  // async — `sortState` in this closure is still the PRE-toggle value, so
  // the PATCH body is computed independently rather than read back.
  function handleSort(key: string) {
    toggleSort(key);
    if (key === UNSORTED_SENTINEL || !canWrite) return;
    const next: SortState<string> =
      sortState.key !== key
        ? { key, direction: "asc" }
        : { key, direction: sortState.direction === "asc" ? "desc" : "asc" };
    pendingSortRef.current = next;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      // Minimal patch — NEVER spread `output.config` here (design D6):
      // `useOutputMeta` is a per-mount snapshot never refreshed after a
      // write, so spreading it would re-send a stale `fieldMapping`/
      // `columnOrder` and turn every sort click into a lost update. The
      // backend's `mergeConfig` preserves untouched keys on its own.
      persistColumnSort(outputId, next);
    }, PERSIST_DEBOUNCE_MS);
  }

  // HEL-451 design D6/task 5: rows filter IMMEDIATELY from local state
  // (`filters`, above) — only the PATCH is debounced, so persistence
  // latency never makes typing feel laggy (design D6, task 5.4). Real user
  // edit only — never fired from an effect on mount, for the same reason
  // `handleSort`'s persist fires from a handler rather than an effect.
  function handleFilterChange(next: TableColumnFilters) {
    setFilters(next);
    if (!canWrite) return;
    const normalized = normalizeColumnFiltersForWrite(next);
    pendingFiltersRef.current = normalized;
    if (filterPersistTimerRef.current) clearTimeout(filterPersistTimerRef.current);
    filterPersistTimerRef.current = setTimeout(() => {
      filterPersistTimerRef.current = null;
      // Minimal patch — NEVER spread `output.config` (design D6, same
      // rationale as `handleSort`'s PATCH above).
      persistColumnFilters(outputId, normalized);
    }, PERSIST_DEBOUNCE_MS);
  }

  function handleClearFilters() {
    handleFilterChange({});
  }

  // HEL-451 design D4/4.1 — the five-state disclosure matrix, computed from
  // `rowsTruncated` (task 4.0's branch-independent signal) and `filtering`.
  // The two EMPTY states are handled entirely by `DataGrid`'s D5 empty-state
  // slot below (`emptyText`/`emptyAction`, passed once here); `LoadedScope
  // Disclosure` covers the three non-empty states. This division is a
  // CONTRACT `TableRenderer` relies on: `DataGrid` renders the zero-match
  // explanation UNCONDITIONALLY whenever `isEmpty` is true, regardless of
  // its OWN internal filter-chrome expand/collapse state (D10-11) — that
  // internal detail changes ONLY the explanation's presentation (full text
  // vs. a line-clamped compact form), never whether it renders at all. An
  // earlier revision broke this by also gating the message on `DataGrid`'s
  // collapse state, silently reintroducing "a filter matching nothing
  // renders as a confident wrong answer" exactly when a short panel
  // auto-collapsed. If `DataGrid` ever needs `TableRenderer` to branch on
  // its expand state for this, that is a contract change to state HERE,
  // not a silent assumption to lose track of again.
  const isEmpty = sortedRows.length === 0;

  // HEL-451 skeptic CR5 — 4.0g NAMED BOOLEANS, corrected. Task 4.0g's
  // original formula (`showSortNote = rowsTruncated && !filtering`) predates
  // this ticket's OWN filter-scoped message and is WRONG once it exists:
  // design D4b's filter-disclosure table requires the scoped "N of M loaded
  // rows match." note to render whenever `filtering && rowsTruncated`, WITH
  // OR WITHOUT `onLoadMore` (the panel detail modal never has one) — the
  // literal old formula would silently drop that note in the modal, which
  // is the exact confidently-wrong-answer state this design exists to
  // prevent. `showLoadedScopeNote` generalizes "show a note" to every
  // `rowsTruncated` state (`LoadedScopeDisclosure` picks the WORDING from
  // `filtering` internally, per the 4.0f supersession) rather than only the
  // un-filtered one. Amended in design.md D4b/tasks.md 4.0g in the same
  // commit as this fix.
  // `|| filtering`: the THIRD message state this note covers is
  // `filtering && !rowsTruncated` (an unqualified, complete-answer match
  // count) — task 4.3 requires the disclosure to disappear ENTIRELY only
  // when neither is true (nothing loaded-scope-relevant to say).
  const showLoadedScopeNote = rowsTruncated || filtering;
  const showLoadMoreBtn = rowsTruncated && onLoadMore != null;
  // The wrapper is STILL derived from its children, per 4.0g's own
  // discipline — not simplified to `rowsTruncated` alone, even though that
  // is what it evaluates to today, because `showLoadedScopeNote` and
  // `showLoadMoreBtn` are independently the two things that can make this
  // wrapper non-empty and a future third child should extend this OR, not
  // replace it.
  const showTruncationWrapper = !isEmpty && (showLoadedScopeNote || showLoadMoreBtn);

  const emptyText = !filtering
    ? undefined
    : rowsTruncated
      ? showLoadMoreBtn
        ? `No rows match your filter in the ${normalizedRows.length} rows loaded so far. More rows may match — load more to widen the search.`
        : `No rows match your filter in the ${normalizedRows.length} rows loaded so far. More rows may match.`
      : "No rows match your filter.";

  const emptyAction = !filtering ? undefined : (
    <div className="panel-content__filter-empty-actions">
      <button
        type="button"
        className="panel-content__clear-filters-btn"
        onClick={handleClearFilters}
      >
        Clear filters
      </button>
      {/* HEL-451 design D4: the detail modal has no `onLoadMore` at all, so
          the sharpest (truncated-empty) state cannot offer this action
          there — text-without-action, never an undefined-prop button
          (task 4.0a). */}
      {showLoadMoreBtn && (
        <button
          className="panel-content__load-more-btn"
          onClick={onLoadMore}
          disabled={paginationIsLoadingMore}
          aria-busy={paginationIsLoadingMore}
        >
          {paginationIsLoadingMore ? (
            <>
              <Spinner size="sm" />
              Loading...
            </>
          ) : (
            "Load more"
          )}
        </button>
      )}
    </div>
  );

  if (usingPagination || usingRaw) {
    return (
      <div className="panel-content panel-content--table">
        <DataGrid
          variant="full"
          rows={sortedRows}
          columns={formattedColumns}
          columnWidths={widths}
          onColumnResize={handleColumnResize}
          sort={sortState.key === UNSORTED_SENTINEL ? null : sortState}
          onSort={handleSort}
          filters={filters}
          onFilterChange={handleFilterChange}
          emptyText={emptyText}
          emptyAction={emptyAction}
        />
        {/* HEL-451 skeptic CR7 — ONE render site for every non-empty
            disclosure state (previously split: the unqualified-count case
            rendered ABOVE the grid, the truncated cases BELOW it, so the
            same message jumped position depending on `rowsTruncated`). */}
        {showTruncationWrapper && (
          <div className="panel-content__disclosure">
            {/* HEL-448 design D9a / HEL-451 design D4b, D4c, D10a — see
                LoadedScopeDisclosure.tsx's file-level comment: CONFIRMED by
                the owner, kept behind one removal seam as good structure,
                not as a placeholder pending approval. */}
            <LoadedScopeDisclosure
              rowsTruncated={rowsTruncated}
              filtering={filtering}
              matchCount={sortedRows.length}
              loadedCount={normalizedRows.length}
            />
            {/* `rowsTruncated &&` is kept even though the dashboard grid
                cannot currently reach the `rawRows` branch (design D4b: both
                `rawRows`/`paginationRows` derive from one `paginationEntry
                .rows`, so one being non-empty implies the other is too) —
                this gate stays CORRECT if that derivation is ever decoupled,
                and `PanelCard.tsx` passes `onLoadMore` UNCONDITIONALLY, so
                `onLoadMore != null` alone would render a live button on
                every FULLY-LOADED dashboard panel. Do not "simplify" this
                away. */}
            {showLoadMoreBtn && (
              <button
                className="panel-content__load-more-btn"
                onClick={onLoadMore}
                disabled={paginationIsLoadingMore}
                aria-busy={paginationIsLoadingMore}
              >
                {paginationIsLoadingMore ? (
                  <>
                    <Spinner size="sm" />
                    Loading...
                  </>
                ) : (
                  "Load more"
                )}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="panel-content panel-content--table">
      <table className="panel-content__table" aria-hidden="true">
        <thead>
          <tr>
            <th />
            <th />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td />
            <td />
          </tr>
          <tr>
            <td />
            <td />
          </tr>
          <tr>
            <td />
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
