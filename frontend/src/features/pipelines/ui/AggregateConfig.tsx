// AggregateConfig — config editor for the "aggregate" pipeline op.
// Renders a group-by section (field dropdown rows, add/remove) and an aggregations
// section (alias text input, fn dropdown, field dropdown, add/remove).
// Inline warning shown when an aggregation field references a name not in analyzeSchema.
// Follows the same props-driven pattern as FilterConfig / ComputeFieldConfig:
// the parent (StepCard) owns state and calls onChange with serialized config JSON.

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTriangleExclamation } from "@fortawesome/free-solid-svg-icons";

import type { SchemaField } from "../../../types/models";
import { Select, TextField } from "../../../shared/ui/index";

export interface AggregateGroupByField {
  name: string;
  type: string;
}

export interface AggregationRow {
  alias: string;
  fn: string;
  field: string;
}

export interface AggregateConfigValue {
  groupBy: AggregateGroupByField[];
  aggregations: AggregationRow[];
}

export const AGG_FNS = ["sum", "avg", "min", "max", "count"] as const;

interface AggregateConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: AggregateConfigValue;
  /** Full schema fields from the analyze endpoint's inputSchema — field selectors. */
  analyzeSchema: SchemaField[];
  /** Column names derived from analyzeSchema — used for the aggregation field dropdown. */
  analyzeColumns: string[];
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: AggregateConfigValue) => void;
}

export function AggregateConfig({
  config,
  analyzeSchema,
  analyzeColumns,
  onChange,
}: AggregateConfigProps) {
  function emit(next: AggregateConfigValue) {
    onChange(next);
  }

  // ── Group-by handlers ──────────────────────────────────────────────────────

  function handleAddGroupByRow() {
    const defaultField = analyzeSchema.length > 0 ? analyzeSchema[0] : { name: "", type: "string" };
    emit({
      ...config,
      groupBy: [...config.groupBy, { name: defaultField.name, type: defaultField.type }],
    });
  }

  function handleGroupByFieldChange(index: number, name: string) {
    const schemaField = analyzeSchema.find((f) => f.name === name);
    const type = schemaField?.type ?? "string";
    const groupBy = config.groupBy.map((g, i) => (i === index ? { name, type } : g));
    emit({ ...config, groupBy });
  }

  function handleRemoveGroupByRow(index: number) {
    const groupBy = config.groupBy.filter((_, i) => i !== index);
    emit({ ...config, groupBy });
  }

  // ── Aggregation handlers ───────────────────────────────────────────────────

  function handleAddAggregation() {
    const defaultField = analyzeColumns.length > 0 ? analyzeColumns[0] : "";
    emit({
      ...config,
      aggregations: [...config.aggregations, { alias: "", fn: "sum", field: defaultField }],
    });
  }

  function handleAggregationChange(index: number, updated: AggregationRow) {
    const aggregations = config.aggregations.map((a, i) => (i === index ? updated : a));
    emit({ ...config, aggregations });
  }

  function handleRemoveAggregation(index: number) {
    const aggregations = config.aggregations.filter((_, i) => i !== index);
    emit({ ...config, aggregations });
  }

  const analyzeFieldNames = new Set(analyzeColumns);

  return (
    <div className="pipeline-detail-page__aggregate-config">
      {/* ── Group-by section ── */}
      <div className="pipeline-detail-page__aggregate-section">
        <span className="pipeline-detail-page__aggregate-section-label">Group by</span>

        <div className="pipeline-detail-page__aggregate-groupby-rows">
          {config.groupBy.map((g, index) => (
            <div key={index} className="pipeline-detail-page__aggregate-groupby-row">
              <Select
                ariaLabel={`Group-by field ${index + 1}`}
                value={g.name}
                placeholder="— select field —"
                options={analyzeSchema.map((f) => ({ value: f.name, label: f.name }))}
                onChange={(next) => handleGroupByFieldChange(index, next)}
              />
              <button
                type="button"
                className="pipeline-detail-page__aggregate-remove-btn"
                aria-label={`Remove group-by field ${index + 1}`}
                onClick={() => handleRemoveGroupByRow(index)}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="pipeline-detail-page__aggregate-add-btn"
          onClick={handleAddGroupByRow}
        >
          + Add group-by field
        </button>
      </div>

      {/* ── Aggregations section ── */}
      <div className="pipeline-detail-page__aggregate-section">
        <span className="pipeline-detail-page__aggregate-section-label">Aggregations</span>

        <div className="pipeline-detail-page__aggregate-agg-rows">
          {config.aggregations.map((agg, index) => {
            const fieldMissing = agg.field !== "" && !analyzeFieldNames.has(agg.field);
            return (
              <div key={index} className="pipeline-detail-page__aggregate-agg-row">
                {/* Alias input */}
                <TextField
                  aria-label={`Alias for aggregation ${index + 1}`}
                  placeholder="alias"
                  value={agg.alias}
                  onChange={(e) =>
                    handleAggregationChange(index, { ...agg, alias: e.target.value })
                  }
                />

                {/* Function dropdown */}
                <Select
                  ariaLabel={`Function for aggregation ${index + 1}`}
                  value={agg.fn}
                  options={AGG_FNS.map((fn) => ({ value: fn, label: fn }))}
                  onChange={(next) => handleAggregationChange(index, { ...agg, fn: next })}
                />

                {/* Field dropdown */}
                <Select
                  ariaLabel={`Field for aggregation ${index + 1}`}
                  value={agg.field}
                  placeholder="— select field —"
                  options={analyzeSchema.map((f) => ({ value: f.name, label: f.name }))}
                  onChange={(next) => handleAggregationChange(index, { ...agg, field: next })}
                />

                {/* Remove button */}
                <button
                  type="button"
                  className="pipeline-detail-page__aggregate-remove-btn"
                  aria-label={`Remove aggregation ${index + 1}`}
                  onClick={() => handleRemoveAggregation(index)}
                >
                  ×
                </button>

                {/* Inline warning: field not found in inputSchema */}
                {fieldMissing && (
                  <span
                    className="pipeline-detail-page__aggregate-field-warning"
                    role="alert"
                    aria-label={`Warning: field "${agg.field}" not in schema`}
                  >
                    <FontAwesomeIcon icon={faTriangleExclamation} /> Field &quot;{agg.field}&quot;
                    not found in input schema
                  </span>
                )}
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="pipeline-detail-page__aggregate-add-btn"
          onClick={handleAddAggregation}
        >
          + Add aggregation
        </button>
      </div>
    </div>
  );
}
