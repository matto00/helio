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
    const cols = Object.keys(paginationRows[0]);
    return (
      <div className="panel-content panel-content--table">
        <table className="panel-content__table">
          <thead>
            <tr>
              {cols.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginationRows.map((row, ri) => (
              <tr key={ri}>
                {cols.map((col) => (
                  <td key={col}>
                    {row[col] !== null && row[col] !== undefined ? String(row[col]) : ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
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
    return (
      <div className="panel-content panel-content--table">
        <table className="panel-content__table">
          <thead>
            <tr>
              {cols.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rawRows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
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
