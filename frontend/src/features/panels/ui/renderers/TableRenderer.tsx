import { useCallback, useEffect, useRef, useState } from "react";

import { DataGrid } from "../../../../shared/ui/index";
import type { ColumnDef } from "../../../../shared/ui/index";
import { updatePanelColumnWidths } from "../../services/panelService";

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
}: TableRendererProps) {
  // Local, immediately-responsive width state — seeded from the persisted
  // config and updated synchronously on every drag tick so resizing feels
  // instant; the network PATCH is debounced separately below.
  const [widths, setWidths] = useState<Record<string, number>>(columnWidths ?? {});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reload local width state from the persisted config when this instance
  // starts rendering a different panel — "adjusting state when a prop
  // changes" during render (not an effect) per React's guidance, since this
  // must not re-fire on every re-render the parent happens to cause with a
  // fresh `columnWidths` object identity for the *same* panel.
  const [loadedForPanelId, setLoadedForPanelId] = useState(panelId);
  if (panelId !== loadedForPanelId) {
    setLoadedForPanelId(panelId);
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
          void updatePanelColumnWidths(panelId, next);
        }, RESIZE_PERSIST_DEBOUNCE_MS);
        return next;
      });
    },
    [panelId],
  );

  // Prefer paginated rows when available (Task 3.7)
  if (paginationRows && paginationRows.length > 0) {
    return (
      <div className="panel-content panel-content--table">
        <DataGrid
          variant="full"
          rows={paginationRows}
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
    const columns: ColumnDef[] = cols.map((key) => ({ key }));
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
