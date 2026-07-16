// HEL-255 — Table panel display controls (cell density, column visibility +
// order, reset column widths) for the panel detail modal's edit pane. Purely
// presentational: all state + save/dirty/reset plumbing lives in
// `useTableDisplayState` (owned by `BindingEditor`), mirroring how
// `MetricValueEditor` / `ChartAggregationFields` are driven.

import { Select, type SelectOption } from "../../../../shared/ui/index";
import type { TableDensity } from "../../types/panel";
import type { TableColumnRow } from "./useTableDisplayState";

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
  hasStoredWidths,
  resetWidthsPending,
  onResetWidths,
}: TableDisplayFieldsProps) {
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
