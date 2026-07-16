import { useCallback, useEffect, useRef, useState } from "react";

import { DataGrid } from "../../../../shared/ui/index";
import type { ColumnDef } from "../../../../shared/ui/index";
import type { TableDensity } from "../../types/panel";
import { useAppDispatch } from "../../../../hooks/reduxHooks";
import { updatePanelColumnWidths } from "../../state/panelsSlice";

/** Debounce window (ms) between the last column-resize event and the
 *  persisted PATCH — matches the hand-rolled ref+setTimeout debounce idiom
 *  used by `ComputedFieldForm.tsx`. HEL-253. */
const RESIZE_PERSIST_DEBOUNCE_MS = 400;

interface TableRendererProps {
  /** Panel id — required to persist column-width resizes. HEL-253. */
  panelId: string;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  /** Rows from the paginated execute endpoint (keyed by column name). */
  paginationRows?: Record<string, unknown>[] | null;
  paginationHasMore?: boolean;
  paginationIsLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** Persisted column widths loaded from `panel.config.columnWidths`. HEL-253. */
  columnWidths?: Record<string, number>;
  /** Persisted row density from `panel.config.density`; absent → DataGrid's
   *  full-variant default (normal). HEL-255. */
  density?: TableDensity;
  /** Persisted visible-column order from `panel.config.columnOrder`; absent or
   *  empty → all columns in natural order. HEL-255. */
  columnOrder?: string[];
}

/** Union of keys across the first 50 rows, in first-seen order — matches
 *  `DataGrid.deriveColumns` so the natural (unordered) column set is identical
 *  whether or not `columnOrder` is applied. */
function deriveKeys(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  for (const row of rows.slice(0, 50)) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  return Array.from(seen);
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

/** Content signature of the persisted widths (key-order independent) so the
 *  local width state re-seeds when the stored value actually changes — most
 *  importantly when a Reset clears it — rather than on every fresh object
 *  identity the parent hands down for the same content. HEL-255 design D6. */
function widthsSignature(widths?: Record<string, number>): string {
  if (!widths) return "";
  return Object.keys(widths)
    .sort()
    .map((key) => `${key}:${widths[key]}`)
    .join(",");
}

export function TableRenderer({
  panelId,
  rawRows,
  headers,
  paginationRows,
  paginationHasMore,
  paginationIsLoadingMore,
  onLoadMore,
  columnWidths,
  density,
  columnOrder,
}: TableRendererProps) {
  const dispatch = useAppDispatch();
  // Local, immediately-responsive width state — seeded from the persisted
  // config and updated synchronously on every drag tick so resizing feels
  // instant; the network PATCH is debounced separately below.
  const [widths, setWidths] = useState<Record<string, number>>(columnWidths ?? {});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reload local width state from the persisted config when this instance
  // starts rendering a different panel OR when the persisted widths' *content*
  // changes (e.g. a Reset clears them) — "adjusting state when a prop changes"
  // during render (not an effect) per React's guidance. Keying on the content
  // signature (not object identity) means an unchanged value re-handed down on
  // an unrelated re-render never clobbers an in-progress drag, while a genuine
  // external clear re-seeds immediately without a reload. HEL-255 design D6.
  const persistedSignature = widthsSignature(columnWidths);
  const [seed, setSeed] = useState({ panelId, signature: persistedSignature });
  if (seed.panelId !== panelId || seed.signature !== persistedSignature) {
    setSeed({ panelId, signature: persistedSignature });
    setWidths(columnWidths ?? {});
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleColumnResize = useCallback(
    (key: string, width: number) => {
      setWidths((prev) => {
        const next = { ...prev, [key]: width };
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          // Dispatch the thunk (not the raw service call) so its fulfilled
          // reducer syncs the persisted widths back into the stored panel —
          // otherwise `hasStoredWidths` (and the edit pane's Reset button)
          // would stay stale until a page reload. HEL-255.
          void dispatch(updatePanelColumnWidths({ panelId, columnWidths: next }));
        }, RESIZE_PERSIST_DEBOUNCE_MS);
        return next;
      });
    },
    [dispatch, panelId],
  );

  // Prefer paginated rows when available (Task 3.7)
  if (paginationRows && paginationRows.length > 0) {
    const columns = orderedColumns(deriveKeys(paginationRows), columnOrder);
    return (
      <div className="panel-content panel-content--table">
        <DataGrid
          variant="full"
          rows={paginationRows}
          columns={columns}
          density={density}
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
                  <span
                    className="panel-content__spinner panel-content__spinner--sm"
                    aria-hidden="true"
                  />
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
          density={density}
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
