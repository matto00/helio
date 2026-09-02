import { useState } from "react";

import "./TableRenderer.css";
import { DataGrid, Spinner } from "../../../../shared/ui/index";
import type { ColumnDef } from "../../../../shared/ui/index";

interface TableRendererProps {
  /** Bound Output id — kept for interface parity with the pre-HEL-909 shape
   *  (was `panelId`); no longer used to persist column widths, since
   *  per-panel column-width/density persistence had no Output-config
   *  equivalent when this kind repointed onto the Output model. */
  panelId: string;
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

export function TableRenderer({
  rawRows,
  headers,
  paginationRows,
  paginationHasMore,
  paginationIsLoadingMore,
  onLoadMore,
  columnOrder,
}: TableRendererProps) {
  // Local-only column widths (no longer persisted — see the file's HEL-909
  // interface-parity note on `panelId`).
  const [widths, setWidths] = useState<Record<string, number>>({});

  const handleColumnResize = (key: string, width: number) => {
    setWidths((prev) => ({ ...prev, [key]: width }));
  };

  // Prefer paginated rows when available (Task 3.7)
  if (paginationRows && paginationRows.length > 0) {
    const columns = orderedColumns(deriveKeys(paginationRows), columnOrder);
    return (
      <div className="panel-content panel-content--table">
        <DataGrid
          variant="full"
          rows={paginationRows}
          columns={columns}
          columnWidths={widths}
          onColumnResize={handleColumnResize}
        />
        {paginationHasMore && (
          <div className="panel-content__load-more">
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

  if (rawRows && rawRows.length > 0) {
    const cols = headers ?? rawRows[0].map((_, i) => String(i + 1));
    const columns = orderedColumns(cols, columnOrder);
    const rows = rawRows.map((row) => Object.fromEntries(cols.map((key, i) => [key, row[i]])));
    return (
      <div className="panel-content panel-content--table">
        <DataGrid
          variant="full"
          rows={rows}
          columns={columns}
          columnWidths={widths}
          onColumnResize={handleColumnResize}
        />
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
