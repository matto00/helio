import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

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

/** Minimum column width (px) enforced by the drag-resize gesture. */
const MIN_COLUMN_WIDTH = 60;

/**
 * Default width (px) seeded onto any `"full"`-variant column that has
 * neither been resized nor given an explicit `ColumnDef.width` — required
 * once `table-layout: fixed` is engaged (see `DataGrid.css`): fixed layout
 * allocates column widths from the first row's declared widths only and
 * does not fall back to content measurement, so a column left without an
 * explicit width collapses toward ~0px as soon as any sibling column has
 * one (confirmed live in evaluation-1.md, cycle 1 — an untouched column
 * shrank to ~13px). Every `"full"`-variant column gets this fallback so
 * unresized columns render at a stable, reasonable width instead.
 */
const DEFAULT_COLUMN_WIDTH = 160;

/** Width (px) nudged per arrow-key press while a resize handle is focused —
 * the keyboard-operable equivalent of the drag gesture (DESIGN.md §8). */
const KEYBOARD_RESIZE_STEP = 10;

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
  /**
   * Applied column widths (px), keyed by column `key` — overrides a column's
   * `width`/derived width when present. Only consulted in the `"full"`
   * variant; ignored (along with `onColumnResize`) in `"preview"`.
   */
  columnWidths?: Record<string, number>;
  /**
   * Fired as the user drags a column's resize handle, reporting the live
   * width for that column. Only wired up in the `"full"` variant — `DataGrid`
   * itself does not persist anything; the caller owns storage. See HEL-253.
   */
  onColumnResize?: (key: string, width: number) => void;
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
  columnWidths,
  onColumnResize,
  emptyText = "No data to preview.",
  className,
}: DataGridProps) {
  const resolvedColumns = useMemo(() => columns ?? deriveColumns(rows), [rows, columns]);
  const resolvedDensity = density ?? DEFAULT_DENSITY[variant];
  const resizable = variant === "full";

  // Transient widths applied while a drag is in progress — `DataGrid` itself
  // does not persist anything (the caller owns storage, see HEL-253
  // design.md), but this keeps the drag visually responsive without waiting
  // on the caller to feed an updated `columnWidths` prop back on every tick.
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
  const dragStateRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const onColumnResizeRef = useRef(onColumnResize);
  useEffect(() => {
    onColumnResizeRef.current = onColumnResize;
  }, [onColumnResize]);

  // Drag gesture: mousedown on the handle starts tracking, mousemove reports
  // the live width, mouseup tears the listeners back down. `onMove`/`onEnd`
  // are created fresh per drag (a low-frequency event) rather than memoized
  // hooks, so neither needs to forward-reference the other.
  const handleResizeStart = useCallback(
    (key: string) => (e: ReactMouseEvent<HTMLSpanElement>) => {
      // Defense-in-depth (HEL-253 design.md): stop propagation before an
      // ancestor drag/resize listener (e.g. PanelGrid's card-level drag
      // handle) can ever see this mousedown.
      e.preventDefault();
      e.stopPropagation();
      const th = (e.currentTarget as HTMLElement).closest("th");
      const startWidth = th ? th.getBoundingClientRect().width : MIN_COLUMN_WIDTH;
      dragStateRef.current = { key, startX: e.clientX, startWidth };

      function onMove(moveEvent: MouseEvent) {
        const drag = dragStateRef.current;
        if (!drag) return;
        const delta = moveEvent.clientX - drag.startX;
        const nextWidth = Math.max(MIN_COLUMN_WIDTH, drag.startWidth + delta);
        setLiveWidths((prev) => ({ ...prev, [drag.key]: nextWidth }));
        onColumnResizeRef.current?.(drag.key, nextWidth);
      }

      function onEnd() {
        dragStateRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onEnd);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onEnd);
    },
    [],
  );

  const stopPointerPropagation = useCallback((e: ReactPointerEvent<HTMLSpanElement>) => {
    e.stopPropagation();
  }, []);

  // Keyboard-operable equivalent of the drag gesture above (DESIGN.md §8):
  // ArrowLeft/ArrowRight nudge the focused column's width by
  // `KEYBOARD_RESIZE_STEP`, clamped to the same `MIN_COLUMN_WIDTH` floor.
  const handleResizeKeyDown = useCallback(
    (key: string) => (e: ReactKeyboardEvent<HTMLSpanElement>) => {
      let delta = 0;
      if (e.key === "ArrowLeft") delta = -KEYBOARD_RESIZE_STEP;
      else if (e.key === "ArrowRight") delta = KEYBOARD_RESIZE_STEP;
      else return;
      e.preventDefault();
      e.stopPropagation();
      const th = (e.currentTarget as HTMLElement).closest("th");
      const currentWidth = th ? th.getBoundingClientRect().width : MIN_COLUMN_WIDTH;
      const nextWidth = Math.max(MIN_COLUMN_WIDTH, currentWidth + delta);
      setLiveWidths((prev) => ({ ...prev, [key]: nextWidth }));
      onColumnResizeRef.current?.(key, nextWidth);
    },
    [],
  );

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
            {resolvedColumns.map((col) => {
              const appliedWidth = resizable
                ? (liveWidths[col.key] ??
                  columnWidths?.[col.key] ??
                  col.width ??
                  DEFAULT_COLUMN_WIDTH)
                : col.width;
              return (
                <th
                  key={col.key}
                  style={appliedWidth !== undefined ? { width: appliedWidth } : undefined}
                >
                  {col.header ?? col.key}
                  {resizable && (
                    <span
                      className="ui-data-grid__resize-handle"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize column ${col.header ?? col.key}`}
                      tabIndex={0}
                      onMouseDown={handleResizeStart(col.key)}
                      onPointerDown={stopPointerPropagation}
                      onKeyDown={handleResizeKeyDown(col.key)}
                    />
                  )}
                </th>
              );
            })}
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
