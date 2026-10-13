import { formatCell } from "../../../../shared/ui/index";
import type { ColumnDef } from "../../../../shared/ui/index";
import type { SortValue } from "../../../../shared/ui/useSortedRows";
import { isStructuredFieldType, type OutputSchemaField } from "../../../pipelines/types/output";

/** HEL-1027 design.md D2/D3 (task 4.5) — `undefined` when `schema` itself is `undefined` (no
 *  information at all, never disable); otherwise names the column as ineligible when it's either
 *  absent from `schema` or present with a Content-category type. Mirrors the backend's
 *  `OutputRowsQuery.resolveSort`/`resolveFilter` eligibility check exactly (same two conditions),
 *  never inferred from row data — MISTAKES.md's row-0-inference trap. */
export function sortFilterDisabledReason(
  schema: OutputSchemaField[] | undefined,
  columnKey: string,
): string | undefined {
  if (schema === undefined) return undefined;
  const field = schema.find((f) => f.name === columnKey);
  if (!field) {
    return "This column isn't part of the Output's declared schema, so it can't be sorted or filtered.";
  }
  if (!isStructuredFieldType(field.type)) {
    return "This column's type doesn't support server-side sort or filter.";
  }
  return undefined;
}

/** Matches `DataGrid.deriveColumns`'s natural/numeric collator so a column set
 *  like col_0, col_1, col_10 sorts numerically instead of lexically. HEL-127. */
const naturalKeyCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Union of keys across the first 50 rows, in natural-sorted order — matches
 *  `DataGrid.deriveColumns` so the natural (unordered) column set is identical
 *  whether or not `columnOrder` is applied. */
export function deriveKeys(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows.slice(0, 50)) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  return Array.from(seen).sort((a, b) => naturalKeyCollator.compare(a, b));
}

/** HEL-465 design.md Decision 1 ownership split — mirrors `DataGrid`'s own
 *  internal `pinnedCount` helper, but computed independently here: `DataGrid`
 *  never sees `columnOrder`, so it cannot be the single source of this
 *  derivation. Number of leading `columns` entries present in `pinned`. */
export function leadingPinnedCount(columns: ColumnDef[], pinned: string[]): number {
  const pinnedSet = new Set(pinned);
  let count = 0;
  for (const col of columns) {
    if (!pinnedSet.has(col.key)) break;
    count += 1;
  }
  return count;
}

/** Build the ordered/filtered `ColumnDef[]` per HEL-255 design D2: absent or
 *  empty `columnOrder` → all natural keys in order; non-empty → exactly the
 *  listed keys, in that order, intersected with the keys present in the data
 *  (stale keys are skipped, never rendered as empty columns). */
export function orderedColumns(naturalKeys: string[], columnOrder?: string[]): ColumnDef[] {
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
export const UNSORTED_SENTINEL = "__helio_unsorted__";

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
export function getSortValue(value: unknown): SortValue {
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
  // guard, which asserts this at the call site (`useTableRows.ts`), not here.
  return formatCell(value);
}
