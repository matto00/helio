import { DataGrid } from "../../../../shared/ui/index";
import type { ColumnDef } from "../../../../shared/ui/index";

interface TableRendererProps {
  rawRows?: string[][] | null;
  headers?: string[] | null;
  /** Rows from the paginated execute endpoint (keyed by column name). */
  paginationRows?: Record<string, unknown>[] | null;
  paginationHasMore?: boolean;
  paginationIsLoadingMore?: boolean;
  onLoadMore?: () => void;
}

export function TableRenderer({
  rawRows,
  headers,
  paginationRows,
  paginationHasMore,
  paginationIsLoadingMore,
  onLoadMore,
}: TableRendererProps) {
  // Prefer paginated rows when available (Task 3.7)
  if (paginationRows && paginationRows.length > 0) {
    return (
      <div className="panel-content panel-content--table">
        <DataGrid variant="full" rows={paginationRows} />
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
        <DataGrid variant="full" rows={rows} columns={columns} />
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
