// Metric's unified Value control (HEL-243 design.md Decision 1). Replaces
// the old "Field mapping: Value" row + separate "Aggregation" section with
// one field selector + one Reduce selector so `fieldMapping.value` and
// `aggregation` can never both be set by user action: "None (first row)"
// writes `fieldMapping.value`; any other reduce function writes
// `aggregation` (see `panel-viz-aggregation` capability).

import { Select, type SelectOption } from "../../../../shared/ui/index";

export const REDUCE_OPTIONS: SelectOption[] = [
  { value: "", label: "None (first row)" },
  { value: "count", label: "Count" },
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
];

interface MetricValueEditorProps {
  fieldOptions: SelectOption[];
  fieldValue: string;
  onFieldChange: (value: string) => void;
  /** `""` = "None (first row)"; else one of the reduce function values. */
  reduceValue: string;
  onReduceChange: (value: string) => void;
}

/** Presentational only — `BindingEditor` owns the save/dirty/reset plumbing
 *  and decides whether the current field/reduce pair writes to
 *  `fieldMapping.value` or `aggregation` (see design.md Decision 1). */
export function MetricValueEditor({
  fieldOptions,
  fieldValue,
  onFieldChange,
  reduceValue,
  onReduceChange,
}: MetricValueEditorProps) {
  return (
    <div className="panel-detail-modal__data-section">
      <span className="panel-detail-modal__data-label">Value</span>
      <div className="panel-detail-modal__mapping-row">
        <label className="panel-detail-modal__mapping-label" htmlFor="metric-value-field">
          Field
        </label>
        <Select
          ariaLabel="Value field"
          value={fieldValue}
          onChange={onFieldChange}
          placeholder="— None —"
          options={fieldOptions}
        />
      </div>
      <div className="panel-detail-modal__mapping-row">
        <label className="panel-detail-modal__mapping-label" htmlFor="metric-value-reduce">
          Reduce
        </label>
        <Select
          ariaLabel="Reduce function"
          value={reduceValue}
          onChange={onReduceChange}
          options={REDUCE_OPTIONS}
        />
      </div>
      {/* F-120 — "None (first row)" silently reads only the bound DataType's
          first row; on a multi-row type that's very likely not the intended
          total. Surface the risk instead of leaving it a silent default. */}
      {fieldValue !== "" && reduceValue === "" && (
        <p className="panel-detail-modal__field-hint">
          Shows only the first row&apos;s value. If this field can return more than one row, pick
          Sum, Average, or another Reduce function to avoid a misleading total.
        </p>
      )}
    </div>
  );
}
