import type { ReactNode } from "react";
import { useId } from "react";

import "./UsageCard.css";

export interface UsageTable {
  caption: string;
  headers: string[];
  rows: string[][];
}

interface UsageCardProps {
  title: string;
  /** A short, honest qualifier under the title (e.g. "New users only…"). */
  note?: string;
  /** The visual (chart / funnel bars). */
  children: ReactNode;
  /** Text alternative: the same numbers as an accessible table, behind a disclosure. */
  table: UsageTable;
}

/** One section of the usage page: heading, optional note, the visual, and the same data as a real
 *  table (DESIGN.md §8 — a canvas chart is never the only way to read the numbers). */
export function UsageCard({ title, note, children, table }: UsageCardProps) {
  const headingId = useId();
  return (
    <section className="usage-card" aria-labelledby={headingId}>
      <header className="usage-card__header">
        <h2 id={headingId} className="usage-card__title">
          {title}
        </h2>
        {note && <p className="usage-card__note">{note}</p>}
      </header>
      <div className="usage-card__visual">{children}</div>
      <details className="usage-card__details">
        <summary className="usage-card__summary">View as table</summary>
        <div className="usage-card__table-scroll">
          <table className="usage-card__table">
            <caption className="sr-only">{table.caption}</caption>
            <thead>
              <tr>
                {table.headers.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, i) =>
                    i === 0 ? (
                      <th key={table.headers[i]} scope="row">
                        {cell}
                      </th>
                    ) : (
                      <td key={table.headers[i]} className="mono">
                        {cell}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
