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
  paginationHasMore?: boolean;
  paginationIsLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** Visible-column order from the Output's `TableOutputConfig.columnOrder`;
   *  absent or empty → all columns in natural order. */
  columnOrder?: string[];
  /** Persisted sort from the Output's `TableOutputConfig.columnSort`;
   *  absent/`null` → renders the pipeline's own row order (see
   *  `UNSORTED_SENTINEL` below). */
  columnSort?: SortState<string> | null;
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
  // `formatCell` (not a bare `String(v)`) so the sort key matches the
  // rendered cell text — `String({})` collapses every object to the same
  // "[object Object]" tie, while `formatCell` JSON-stringifies it.
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

export function TableRenderer({
  outputId,
  ownerId,
  rawRows,
  headers,
  paginationRows,
  paginationHasMore,
  paginationIsLoadingMore,
  onLoadMore,
  columnOrder,
  columnSort,
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
    normalizedRows,
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

  if (usingPagination || usingRaw) {
    return (
      <div className="panel-content panel-content--table">
        <DataGrid
          variant="full"
          rows={sortedRows}
          columns={columns}
          columnWidths={widths}
          onColumnResize={handleColumnResize}
          sort={sortState.key === UNSORTED_SENTINEL ? null : sortState}
          onSort={handleSort}
        />
        {usingPagination && paginationHasMore && (
          <div className="panel-content__load-more">
            {/* HEL-448 design D9a — NOT part of the owner's sort-mechanism
                ruling; a delivery-coordinator addition pending owner
                confirmation, deliberately trivially removable. Never
                describe this as owner-approved. */}
            <p className="panel-content__truncation-note">Sort covers only the loaded rows.</p>
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
