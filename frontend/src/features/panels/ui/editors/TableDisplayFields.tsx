// HEL-255 — Table display controls (cell density, column visibility +
// order, reset column widths) for the Output editor's Table kind fields.
// Purely presentational; state + save/dirty/reset plumbing now lives on the
// Output editor side (`useOutputTableColumns`), not on a panel — a table's
// display config belongs to the Output, not the placement (HEL-909).
//
// HEL-944 — the reorder buttons now render through the shared `IconButton`
// primitive (DESIGN.md's ghost/secondary/danger recipe + built-in 44px
// mobile tap-target expander) instead of a bare `<button>`, and the Columns
// list sits in its own bounded container (`TableDisplayFields.css`) so a
// dynamic, variable-length collection reads as nested rather than as more
// inline form fields.

import { IconButton, Select, type SelectOption } from "../../../../shared/ui/index";
import type { TableColumnRow } from "../../../pipelines/ui/outputEditor/useOutputTableColumns";
import "./TableDisplayFields.css";

export type TableDensity = "condensed" | "normal" | "spacious";

const DENSITY_OPTIONS: SelectOption[] = [
  { value: "condensed", label: "Condensed" },
  { value: "normal", label: "Normal" },
  { value: "spacious", label: "Spacious" },
];

interface TableDisplayFieldsProps {
  density: TableDensity;
  onDensityChange: (density: TableDensity) => void;
  columns: TableColumnRow[];
  onToggleVisible: (key: string) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onMoveToTop: (index: number) => void;
  onMoveToBottom: (index: number) => void;
  hasStoredWidths: boolean;
  resetWidthsPending: boolean;
  onResetWidths: () => void;
}

function isTableDensity(value: string): value is TableDensity {
  return value === "condensed" || value === "normal" || value === "spacious";
}

export function TableDisplayFields({
  density,
  onDensityChange,
  columns,
  onToggleVisible,
  onMoveUp,
  onMoveDown,
  onMoveToTop,
  onMoveToBottom,
  hasStoredWidths,
  resetWidthsPending,
  onResetWidths,
}: TableDisplayFieldsProps) {
  // F-126 — single-step ↑/↓ alone takes many clicks to reach either end of a
  // wide data type's column list; only add the coarser jump-to-top/bottom
  // controls once the list is long enough for that to matter.
  const showJumpControls = columns.length > 8;
  return (
    <>
      <div className="table-display-fields__section">
        <div className="table-display-fields__row">
          <label className="table-display-fields__label" htmlFor="table-density">
            Cell density
          </label>
          <Select
            ariaLabel="Cell density"
            value={density}
            onChange={(value) => {
              if (isTableDensity(value)) onDensityChange(value);
            }}
            options={DENSITY_OPTIONS}
          />
        </div>
      </div>

      {columns.length > 0 && (
        <div className="table-display-fields__section">
          <span className="table-display-fields__label">Columns</span>
          <div className="table-display-fields__column-list-container">
            <ul className="table-display-fields__column-list">
              {columns.map((column, index) => (
                <li key={column.key} className="table-display-fields__column-row">
                  <label className="table-display-fields__column-visibility">
                    <input
                      type="checkbox"
                      checked={column.visible}
                      onChange={() => onToggleVisible(column.key)}
                    />
                    <span className="table-display-fields__column-key">{column.key}</span>
                  </label>
                  <div className="table-display-fields__column-move">
                    {showJumpControls && (
                      <IconButton
                        icon="⤒"
                        aria-label={`Move ${column.key} to top`}
                        variant="secondary"
                        size="sm"
                        onClick={() => onMoveToTop(index)}
                        disabled={index === 0}
                      />
                    )}
                    <IconButton
                      icon="↑"
                      aria-label={`Move ${column.key} up`}
                      variant="secondary"
                      size="sm"
                      onClick={() => onMoveUp(index)}
                      disabled={index === 0}
                    />
                    <IconButton
                      icon="↓"
                      aria-label={`Move ${column.key} down`}
                      variant="secondary"
                      size="sm"
                      onClick={() => onMoveDown(index)}
                      disabled={index === columns.length - 1}
                    />
                    {showJumpControls && (
                      <IconButton
                        icon="⤓"
                        aria-label={`Move ${column.key} to bottom`}
                        variant="secondary"
                        size="sm"
                        onClick={() => onMoveToBottom(index)}
                        disabled={index === columns.length - 1}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="table-display-fields__section">
        <button
          type="button"
          className="table-display-fields__reset-widths-btn"
          onClick={onResetWidths}
          disabled={!hasStoredWidths || resetWidthsPending}
        >
          {resetWidthsPending ? "Column widths will reset on save" : "Reset column widths"}
        </button>
      </div>
    </>
  );
}
