import { useMemo } from "react";

import "./PreviewTable.css";

interface PreviewTableProps {
  rows: Record<string, unknown>[];
  /** Optional explicit headers; defaults to the union of keys across the first ~50 rows. */
  headers?: string[];
  emptyText?: string;
}

export function PreviewTable({
  rows,
  headers,
  emptyText = "No data to preview.",
}: PreviewTableProps) {
  const resolvedHeaders = useMemo(() => {
    if (headers) return headers;
    const seen = new Set<string>();
    for (const row of rows.slice(0, 50)) {
      for (const key of Object.keys(row)) seen.add(key);
    }
    return Array.from(seen);
  }, [rows, headers]);

  if (rows.length === 0) {
    return <p className="preview-table__empty">{emptyText}</p>;
  }

  return (
    <div className="preview-table__wrapper" role="region" aria-label="Data preview">
      <table className="preview-table">
        <thead>
          <tr>
            {resolvedHeaders.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {resolvedHeaders.map((header) => (
                <td key={header}>{formatCell(row[header])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
