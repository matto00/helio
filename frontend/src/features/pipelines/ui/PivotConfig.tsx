// PivotConfig — config editor for the "pivot" pipeline op (HEL-375).
// Renders an index-fields section (dropdown rows, add/remove — mirrors
// AggregateConfig's groupBy rows) plus single-field dropdowns for `column`
// and `values`, and an `agg` dropdown seeded with a pivot-local
// PIVOT_AGG_FNS constant (design.md Planner Notes — not AggregateConfig's
// AGG_FNS, which lacks `first`).
// Follows the same props-driven pattern as AggregateConfig / DateBucketConfig:
// the parent (StepCard) owns state and calls onChange with the typed config.

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

import type { SchemaField } from "../types/pipelineStep";
import { Select } from "../../../shared/ui/index";

export interface PivotConfigValue {
  index: string[];
  column: string;
  values: string;
  agg: "sum" | "count" | "avg" | "min" | "max" | "first";
}

export const PIVOT_AGG_FNS = ["sum", "count", "avg", "min", "max", "first"] as const;

interface PivotConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: PivotConfigValue;
  /** Full schema fields from the analyze endpoint's inputSchema — index field selectors. */
  analyzeSchema: SchemaField[];
  /** Column names derived from analyzeSchema — used for the column/values dropdowns. */
  analyzeColumns: string[];
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: PivotConfigValue) => void;
}

export function PivotConfig({ config, analyzeSchema, analyzeColumns, onChange }: PivotConfigProps) {
  function emit(next: PivotConfigValue) {
    onChange(next);
  }

  // ── Index-field handlers ────────────────────────────────────────────────────

  function handleAddIndexRow() {
    const defaultField = analyzeSchema.length > 0 ? analyzeSchema[0].name : "";
    emit({ ...config, index: [...config.index, defaultField] });
  }

  function handleIndexFieldChange(rowIndex: number, name: string) {
    const index = config.index.map((f, i) => (i === rowIndex ? name : f));
    emit({ ...config, index });
  }

  function handleRemoveIndexRow(rowIndex: number) {
    const index = config.index.filter((_, i) => i !== rowIndex);
    emit({ ...config, index });
  }

  return (
    <div className="pipeline-detail-page__aggregate-config">
      {/* ── Index section ── */}
      <div className="pipeline-detail-page__aggregate-section">
        <span className="pipeline-detail-page__aggregate-section-label">Index (group by)</span>
        <p className="pipeline-detail-page__aggregate-section-description">
          Index fields define the partition keys. Each unique combination becomes one output row.
        </p>

        <div className="pipeline-detail-page__aggregate-groupby-rows">
          {config.index.map((name, rowIndex) => (
            <div key={rowIndex} className="pipeline-detail-page__aggregate-groupby-row">
              <Select
                ariaLabel={`Index field ${rowIndex + 1}`}
                value={name}
                placeholder="— select field —"
                options={analyzeSchema.map((f) => ({ value: f.name, label: f.name }))}
                onChange={(next) => handleIndexFieldChange(rowIndex, next)}
              />
              <button
                type="button"
                className="pipeline-detail-page__row-remove-btn"
                aria-label={`Remove index field ${rowIndex + 1}`}
                onClick={() => handleRemoveIndexRow(rowIndex)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="pipeline-detail-page__filter-add-btn"
          onClick={handleAddIndexRow}
        >
          + Add index field
        </button>
      </div>

      {/* ── Column / values / agg section ── */}
      <div className="pipeline-detail-page__aggregate-section">
        <span className="pipeline-detail-page__aggregate-section-label">Pivot</span>
        <p className="pipeline-detail-page__aggregate-section-description">
          Each distinct value of the pivot column becomes a new output column, holding the
          aggregated value.
        </p>

        <div className="pipeline-detail-page__compute-field">
          <span className="pipeline-detail-page__compute-label">Pivot column</span>
          <Select
            ariaLabel="Pivot column"
            value={config.column}
            placeholder="— select field —"
            options={analyzeColumns.map((col) => ({ value: col, label: col }))}
            onChange={(next) => emit({ ...config, column: next })}
          />
        </div>

        <div className="pipeline-detail-page__compute-field">
          <span className="pipeline-detail-page__compute-label">Values field</span>
          <Select
            ariaLabel="Values field"
            value={config.values}
            placeholder="— select field —"
            options={analyzeColumns.map((col) => ({ value: col, label: col }))}
            onChange={(next) => emit({ ...config, values: next })}
          />
        </div>

        <div className="pipeline-detail-page__compute-field">
          <span className="pipeline-detail-page__compute-label">Aggregation</span>
          <Select
            ariaLabel="Pivot aggregation function"
            value={config.agg}
            options={PIVOT_AGG_FNS.map((fn) => ({ value: fn, label: fn }))}
            onChange={(next) => emit({ ...config, agg: next as PivotConfigValue["agg"] })}
          />
        </div>
      </div>
    </div>
  );
}
