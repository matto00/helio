// HEL-1311 -- the heatmap / histogram slot pickers of the chart Output editor. The editor never
// edited a chart's `fieldMapping` before; these two types need it (a heatmap reads three columns, a
// histogram one numeric field), so they get labelled pickers. Numeric pickers list ONLY the columns
// the server reports as eligible for a chart `yAxis` (capabilities-at-node), never a client-side type
// guess, so the editor and the write path cannot disagree on "numeric".

import { Select, type SelectOption } from "../../../../shared/ui/index";
import type { ChartType } from "../../../../utils/chartAppearance";

export const NO_NUMERIC_COLUMNS_HINT =
  "No numeric columns here. Cast a column to a number in the pipeline to use it.";

interface SlotSpec {
  slot: "xAxis" | "series" | "yAxis";
  label: string;
  numeric: boolean;
  /** Accessible name when the visible label alone would read badly ("Histogram field"). */
  ariaLabel?: string;
}

const SLOTS: Partial<Record<ChartType, SlotSpec[]>> = {
  heatmap: [
    { slot: "xAxis", label: "Columns", numeric: false },
    { slot: "series", label: "Rows", numeric: false },
    { slot: "yAxis", label: "Value", numeric: true },
  ],
  histogram: [{ slot: "xAxis", label: "Field", numeric: true, ariaLabel: "Histogram field" }],
};

/** The options of a numeric picker: the eligible columns, plus a stored choice outside that list kept
 *  selectable and marked, so opening and saving an Output never silently rewrites it. */
export function numericSlotOptions(eligible: string[], stored: string | undefined): SelectOption[] {
  const options = eligible.map((name) => ({ value: name, label: name }));
  if (stored && !eligible.includes(stored)) {
    options.push({ value: stored, label: `${stored} (not numeric)` });
  }
  return options;
}

interface ChartSlotFieldsProps {
  chartType: ChartType;
  fieldMapping: Record<string, string>;
  onFieldChange: (slot: string, value: string) => void;
  /** Every column of the node (Columns / Rows pickers). */
  allColumns: SelectOption[];
  /** Columns the server reports eligible for a chart `yAxis` (numeric). */
  numericColumns: string[];
}

export function ChartSlotFields({
  chartType,
  fieldMapping,
  onFieldChange,
  allColumns,
  numericColumns,
}: ChartSlotFieldsProps) {
  const slots = SLOTS[chartType];
  if (!slots) return null;
  return (
    <div className="output-editor-sheet__data-section">
      <span className="output-editor-sheet__data-label">
        {chartType === "heatmap" ? "Heatmap fields" : "Histogram field"}
      </span>
      {slots.map(({ slot, label, numeric, ariaLabel }) => {
        const stored = fieldMapping[slot];
        const options = numeric ? numericSlotOptions(numericColumns, stored) : allColumns;
        const noNumeric = numeric && options.length === 0;
        const hintId = `output-chart-${slot}-hint`;
        return (
          <div key={slot} className="output-editor-sheet__mapping-row">
            <label className="output-editor-sheet__mapping-label" htmlFor={`output-chart-${slot}`}>
              {label}
            </label>
            <Select
              id={`output-chart-${slot}`}
              ariaLabel={ariaLabel ?? `${label} field`}
              ariaDescribedBy={noNumeric ? hintId : undefined}
              value={stored ?? ""}
              onChange={(v) => onFieldChange(slot, v)}
              placeholder="— None —"
              options={options}
              disabled={noNumeric}
            />
            {noNumeric && (
              <p id={hintId} className="output-editor-sheet__type-hint">
                {NO_NUMERIC_COLUMNS_HINT}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
