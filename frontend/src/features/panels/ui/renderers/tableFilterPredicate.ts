import { formatCell } from "../../../../shared/ui/index";
import type { ColumnDef } from "../../../../shared/ui/index";
import type { TableColumnFilters } from "../../../pipelines/ui/outputEditor/outputConfigTypes";

/** HEL-451 design D2 — the match source IS the rendered text (`formatCell`),
 *  reused rather than reimplemented, so a match is always visible in the
 *  cell that matched (including a map-classified column serialized to
 *  JSON). Case-insensitive contains, term trimmed; an empty/whitespace-only
 *  term matches everything (task 1.2). */
function cellMatches(value: unknown, term: string): boolean {
  const trimmed = term.trim();
  if (trimmed === "") return true;
  return formatCell(value).toLowerCase().includes(trimmed.toLowerCase());
}

/** Whether ANY filter term is currently active — drives the disclosure state
 *  machine (design D4) and the D5 filtered-empty markup branch. */
export function isFiltering(filters: TableColumnFilters | undefined): boolean {
  if (!filters) return false;
  const quick = filters.quick?.trim();
  if (quick) return true;
  return Object.values(filters.columns ?? {}).some((t) => t.trim() !== "");
}

/** Task 1.2: quick term matches when ANY visible column matches; per-column
 *  terms match only their own column and AND together; the quick term ANDs
 *  with them. An empty/whitespace-only term (quick or per-column) filters
 *  nothing, per `cellMatches` above. */
export function rowMatchesFilters(
  row: Record<string, unknown>,
  columns: ColumnDef[],
  filters: TableColumnFilters | undefined,
): boolean {
  if (!filters) return true;
  const quick = filters.quick ?? "";
  if (quick.trim() !== "" && !columns.some((col) => cellMatches(row[col.key], quick))) {
    return false;
  }
  const columnTerms = filters.columns ?? {};
  for (const col of columns) {
    const term = columnTerms[col.key];
    if (term && term.trim() !== "" && !cellMatches(row[col.key], term)) {
      return false;
    }
  }
  return true;
}

/** Normalizes empty/whitespace-only terms away (task 5.1) so a cleared
 *  filter never persists as `{ columns: { region: "" } }` — applied only at
 *  WRITE time; the rendered/local filter state keeps the raw value so the
 *  input doesn't visibly change under the user while typing. */
export function normalizeColumnFiltersForWrite(
  filters: TableColumnFilters,
): TableColumnFilters | null {
  const quick = filters.quick?.trim() ? filters.quick : undefined;
  const columns: Record<string, string> = {};
  for (const [key, term] of Object.entries(filters.columns ?? {})) {
    if (term.trim() !== "") columns[key] = term;
  }
  const hasColumns = Object.keys(columns).length > 0;
  if (!quick && !hasColumns) return null;
  return {
    ...(quick ? { quick } : {}),
    ...(hasColumns ? { columns } : {}),
  };
}
