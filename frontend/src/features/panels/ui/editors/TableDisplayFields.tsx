// HEL-255 — Table display controls (cell density, column visibility +
// order, reset column widths) for the Output editor's Table kind fields.
// Purely presentational; state + save/dirty/reset plumbing now lives on the
// Output editor side (`useOutputTableColumns`), not on a panel — a table's
// display config belongs to the Output, not the placement (HEL-909).

import { Select, type SelectOption } from "../../../../shared/ui/index";
import type { TableColumnRow } from "../../../pipelines/ui/outputEditor/useOutputTableColumns";

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
      <div className="panel-detail-modal__data-section">
        <div className="panel-detail-modal__mapping-row">
          <label className="panel-detail-modal__mapping-label" htmlFor="table-density">
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
        <div className="panel-detail-modal__data-section">
          <span className="panel-detail-modal__data-label">Columns</span>
          <ul className="panel-detail-modal__column-list">
            {columns.map((column, index) => (
              <li key={column.key} className="panel-detail-modal__column-row">
                <label className="panel-detail-modal__column-visibility">
                  <input
                    type="checkbox"
                    checked={column.visible}
                    onChange={() => onToggleVisible(column.key)}
                  />
                  <span className="panel-detail-modal__column-key">{column.key}</span>
                </label>
                <div className="panel-detail-modal__column-move">
                  {showJumpControls && (
                    <button
                      type="button"
                      className="panel-detail-modal__column-move-btn"
                      aria-label={`Move ${column.key} to top`}
                      onClick={() => onMoveToTop(index)}
                      disabled={index === 0}
                    >
                      ⤒
                    </button>
                  )}
                  <button
                    type="button"
                    className="panel-detail-modal__column-move-btn"
                    aria-label={`Move ${column.key} up`}
                    onClick={() => onMoveUp(index)}
                    disabled={index === 0}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="panel-detail-modal__column-move-btn"
                    aria-label={`Move ${column.key} down`}
                    onClick={() => onMoveDown(index)}
                    disabled={index === columns.length - 1}
                  >
                    ↓
                  </button>
                  {showJumpControls && (
                    <button
                      type="button"
                      className="panel-detail-modal__column-move-btn"
                      aria-label={`Move ${column.key} to bottom`}
                      onClick={() => onMoveToBottom(index)}
                      disabled={index === columns.length - 1}
                    >
                      ⤓
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="panel-detail-modal__data-section">
        <button
          type="button"
          className="panel-detail-modal__reset-widths-btn"
          onClick={onResetWidths}
          disabled={!hasStoredWidths || resetWidthsPending}
        >
          {resetWidthsPending ? "Column widths will reset on save" : "Reset column widths"}
        </button>
      </div>
    </>
  );
}
