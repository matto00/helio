import type { ColumnDef } from "../../../shared/ui/DataGrid";

/** Natural/numeric comparator for the leftover (undeclared) keys -- identical to the one
 *  `DataGrid.deriveColumns` uses, so keys the Output does not declare keep today's order. */
const naturalKeyCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The Output-derived inputs that order Inspect's columns (HEL-1394). */
export interface InspectColumnOrderHint {
  /** The Output's declared schema field names, in declared order. */
  schema: string[];
  /** The Output config's `columnOrder`, when set. NOTE: defensive -- the server only accepts
   *  `columnOrder` on table Outputs (`OutputConfigValidation`) and strips it from every other kind
   *  (V117), while Inspect exists only for chart Outputs, so for real data this is always empty and
   *  the schema order applies. Kept so the ruling (columnOrder, then schema) is honoured literally. */
  columnOrder?: string[];
  /** HEL-1705 H: the rows response's column order (the Output's schema names present, then other keys by code point). When
   *  present it replaces the schema-plus-natural-extras tail; `columnOrder` keys still lead. */
  columns?: string[];
}

/** HEL-1394 -- Inspect's column keys: present `columnOrder` keys (in order, deduped, non-string
 *  entries ignored), then present schema names not yet emitted (schema order), then every remaining
 *  row key natural-sorted. `columnOrder` only orders -- it never hides a column (Inspect lists the
 *  underlying rows), so no key in `rowKeys` is ever dropped. */
export function inspectColumnKeys(
  rowKeys: readonly string[],
  schemaNames: readonly string[],
  columnOrder?: readonly unknown[],
  columns?: readonly string[],
): string[] {
  const present = new Set(rowKeys);
  const out: string[] = [];
  const emitted = new Set<string>();
  const emit = (key: unknown) => {
    if (typeof key !== "string" || !present.has(key) || emitted.has(key)) return;
    emitted.add(key);
    out.push(key);
  };
  columnOrder?.forEach(emit);
  // The server's order for the rest (HEL-1705); without it the schema names, then a natural sort of what remains.
  if (columns !== undefined && columns.length > 0) columns.forEach(emit);
  else schemaNames.forEach(emit);
  const rest = rowKeys.filter((key) => !emitted.has(key));
  rest.sort((a, b) => naturalKeyCollator.compare(a, b));
  rest.forEach(emit);
  return out;
}

/** `ColumnDef`s for Inspect's grid over `rows`, or `undefined` when there is nothing to order
 *  (DataGrid then keeps its own derivation / empty state). Scans the first 50 rows, matching
 *  `DataGrid.deriveColumns`' window. */
export function inspectColumns(
  rows: Record<string, unknown>[],
  hint: InspectColumnOrderHint | undefined,
): ColumnDef[] | undefined {
  if (!hint || rows.length === 0) return undefined;
  const seen = new Set<string>();
  for (const row of rows.slice(0, 50)) for (const key of Object.keys(row)) seen.add(key);
  return inspectColumnKeys(Array.from(seen), hint.schema, hint.columnOrder, hint.columns).map(
    (key) => ({
      key,
    }),
  );
}
