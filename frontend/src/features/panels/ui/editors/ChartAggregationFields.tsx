// Chart's Aggregation sub-section (group-by field + value field + agg
// function). Extracted out of `BindingEditor` (HEL-243) to keep that file
// under the CONTRIBUTING.md file-size soft budget now that metric's
// Aggregation section has been replaced by `MetricValueEditor` — this is
// the chart-only half of what used to be one shared block.

import { Select, type SelectOption } from "../../../../shared/ui/index";
import type { AggFn } from "../../types/panel";

const AGG_FN_OPTIONS: { value: AggFn; label: string }[] = [
  { value: "count", label: "Count" },
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" },
];

interface ChartAggregationFieldsProps {
  fieldOptions: SelectOption[];
  groupByValue: string;
  onGroupByChange: (value: string) => void;
  valueFieldValue: string;
  onValueFieldChange: (value: string) => void;
  aggFnValue: string;
  onAggFnChange: (value: string) => void;
}

/** Presentational only — `BindingEditor` owns the save/dirty/reset plumbing
 *  (mirrors `MetricValueEditor`). */
export function ChartAggregationFields({
  fieldOptions,
  groupByValue,
  onGroupByChange,
  valueFieldValue,
  onValueFieldChange,
  aggFnValue,
  onAggFnChange,
}: ChartAggregationFieldsProps) {
  return (
    <div className="panel-detail-modal__data-section">
      <span className="panel-detail-modal__data-label">Aggregation</span>
      <div className="panel-detail-modal__mapping-row">
        <label className="panel-detail-modal__mapping-label" htmlFor="agg-group-by">
          Group by
        </label>
        <Select
          ariaLabel="Group by field"
          value={groupByValue}
          onChange={onGroupByChange}
          placeholder="— None —"
          options={fieldOptions}
        />
      </div>
      <div className="panel-detail-modal__mapping-row">
        <label className="panel-detail-modal__mapping-label" htmlFor="agg-field">
          Value field
        </label>
        <Select
          ariaLabel="Aggregation value field"
          value={valueFieldValue}
          onChange={onValueFieldChange}
          placeholder="— None —"
          options={fieldOptions}
        />
      </div>
      <div className="panel-detail-modal__mapping-row">
        <label className="panel-detail-modal__mapping-label" htmlFor="agg-fn">
          Function
        </label>
        <Select
          ariaLabel="Aggregation function"
          value={aggFnValue}
          onChange={onAggFnChange}
          placeholder="— None —"
          options={[{ value: "", label: "— None —" }, ...AGG_FN_OPTIONS]}
        />
      </div>
    </div>
  );
}
