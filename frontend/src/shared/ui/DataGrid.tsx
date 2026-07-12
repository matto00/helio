import { useMemo, type ReactNode } from "react";

import "./DataGrid.css";

export interface ColumnDef {
  key: string;
  /** Column header text; defaults to `key` when omitted. */
  header?: string;
  /** Overrides the default cell formatter for this column. */
  render?: (row: Record<string, unknown>, value: unknown) => ReactNode;
  width?: string | number;
}

type DataGridVariant = "full" | "preview";
type DataGridDensity = "condensed" | "normal" | "spacious";

interface DataGridProps {
  rows: Record<string, unknown>[];
  /** Optional explicit columns; defaults to the union of keys across the first 50 rows. */
  columns?: ColumnDef[];
  variant: DataGridVariant;
  /**
   * Cell density — controls row padding and font size (line-height scales
   * proportionally with font size):
   * - `"condensed"` — `--space-1`/`--space-2` padding, `--text-xs` font.
   * - `"normal"` — `--space-2`/`--space-3` padding, `--text-sm` font.
   * - `"spacious"` — `--space-3`/`--space-4` padding, `--text-base` font.
   *
   * Defaults per `variant` when omitted: `preview` → `"condensed"`, `full` →
   * `"normal"`. Consumers should rely on this default rather than pass an
   * explicit `density` unless the surface has a documented reason to diverge
   * from its variant's default (e.g. a denser full-variant surface).
   */
  density?: DataGridDensity;
  /** Empty-state message shown instead of a table when `rows` is empty. */
  emptyText?: string;
  className?: string;
}

const DEFAULT_DENSITY: Record<DataGridVariant, DataGridDensity> = {
  preview: "condensed",
  full: "normal",
};

/** Union of keys across the first 50 rows, in first-seen order — matches
 * `PreviewTable`'s former column-derivation behavior. */
function deriveColumns(rows: Record<string, unknown>[]): ColumnDef[] {
  const seen = new Set<string>();
  for (const row of rows.slice(0, 50)) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  return Array.from(seen).map((key) => ({ key }));
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Canonical table-shaped data primitive. Renders `rows`/`columns` as a table
 * with shared empty-state, cell-formatting, and density behavior — replaces
 * the app's previously-duplicated per-surface table markup (see HEL-251). */
export function DataGrid({
  rows,
  columns,
  variant,
  density,
  emptyText = "No data to preview.",
  className,
}: DataGridProps) {
  const resolvedColumns = useMemo(() => columns ?? deriveColumns(rows), [rows, columns]);
  const resolvedDensity = density ?? DEFAULT_DENSITY[variant];

  if (rows.length === 0) {
    const emptyClasses = ["ui-data-grid__empty", className ?? null].filter(Boolean).join(" ");
    return <p className={emptyClasses}>{emptyText}</p>;
  }

  const rootClasses = [
    "ui-data-grid",
    `ui-data-grid--${variant}`,
    `ui-data-grid--${resolvedDensity}`,
    className ?? null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={rootClasses} role="region" aria-label="Data grid">
      <table className="ui-data-grid__table">
        <thead>
          <tr>
            {resolvedColumns.map((col) => (
              <th key={col.key} style={col.width !== undefined ? { width: col.width } : undefined}>
                {col.header ?? col.key}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {resolvedColumns.map((col) => {
                const value = row[col.key];
                return (
                  <td key={col.key}>{col.render ? col.render(row, value) : formatCell(value)}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
