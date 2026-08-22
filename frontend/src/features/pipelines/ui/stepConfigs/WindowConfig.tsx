// WindowConfig — partition + order + function editor for the "window"
// pipeline op (HEL-376). Partition-by rows mirror PivotConfig's index-field
// rows; order-by reuses SortConfig directly (identical {field, direction}
// shape) rather than re-implementing a second ordered-key-list editor. A
// function dropdown selects one of the six supported functions; the field
// dropdown (running_sum/lag/lead) and offset number input (lag/lead) render
// conditionally per design.md decision 4 — the rank family ignores `field`
// and `offset` entirely.

import type { ChangeEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

import type { SchemaField } from "../../types/pipelineStep";
import { Select, TextField } from "../../../../shared/ui/index";
import { SortConfig, type SortKey } from "./SortConfig";

export const WINDOW_FUNCTIONS = [
  "row_number",
  "rank",
  "dense_rank",
  "running_sum",
  "lag",
  "lead",
] as const;

export type WindowFunctionValue = (typeof WINDOW_FUNCTIONS)[number];

/** Functions that read a source `field` (the rank family ignores it). */
const FIELD_REQUIRED_FUNCTIONS: readonly WindowFunctionValue[] = ["running_sum", "lag", "lead"];

/** Functions that use `offset` (only lag/lead). */
const OFFSET_FUNCTIONS: readonly WindowFunctionValue[] = ["lag", "lead"];

const FUNCTION_OPTIONS = WINDOW_FUNCTIONS.map((fn) => ({ value: fn, label: fn }));

export interface WindowConfigValue {
  partitionBy: string[];
  orderBy: SortKey[];
  function: WindowFunctionValue;
  field: string;
  outputColumn: string;
  offset: number;
}

interface WindowConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: WindowConfigValue;
  /** Full schema fields from the analyze endpoint's inputSchema — partition-by field selectors. */
  analyzeSchema: SchemaField[];
  /** Column names derived from analyzeSchema — used for orderBy/field dropdowns. */
  analyzeColumns: string[];
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: WindowConfigValue) => void;
}

export function WindowConfig({
  config,
  analyzeSchema,
  analyzeColumns,
  onChange,
}: WindowConfigProps) {
  function emit(next: WindowConfigValue) {
    onChange(next);
  }

  // ── Partition-by handlers ────────────────────────────────────────────────

  function handleAddPartitionRow() {
    const defaultField = analyzeSchema.length > 0 ? analyzeSchema[0].name : "";
    emit({ ...config, partitionBy: [...config.partitionBy, defaultField] });
  }

  function handlePartitionFieldChange(rowIndex: number, name: string) {
    const partitionBy = config.partitionBy.map((f, i) => (i === rowIndex ? name : f));
    emit({ ...config, partitionBy });
  }

  function handleRemovePartitionRow(rowIndex: number) {
    const partitionBy = config.partitionBy.filter((_, i) => i !== rowIndex);
    emit({ ...config, partitionBy });
  }

  function handleFunctionChange(fn: string) {
    const next = WINDOW_FUNCTIONS.includes(fn as WindowFunctionValue)
      ? (fn as WindowFunctionValue)
      : "row_number";
    emit({ ...config, function: next });
  }

  function handleOutputColumnChange(e: ChangeEvent<HTMLInputElement>) {
    emit({ ...config, outputColumn: e.target.value });
  }

  function handleOffsetChange(e: ChangeEvent<HTMLInputElement>) {
    const parsed = parseInt(e.target.value, 10);
    if (!isNaN(parsed) && parsed > 0) {
      emit({ ...config, offset: parsed });
    }
  }

  const showField = FIELD_REQUIRED_FUNCTIONS.includes(config.function);
  const showOffset = OFFSET_FUNCTIONS.includes(config.function);

  return (
    <div className="pipeline-detail-page__aggregate-config">
      {/* ── Partition-by section ── */}
      <div className="pipeline-detail-page__aggregate-section">
        <span className="pipeline-detail-page__aggregate-section-label">
          Partition by (optional)
        </span>
        <p className="pipeline-detail-page__aggregate-section-description">
          Rows are grouped by these fields before the function is computed within each group. Leave
          empty to treat all rows as a single partition.
        </p>

        <div className="pipeline-detail-page__aggregate-groupby-rows">
          {config.partitionBy.map((name, rowIndex) => (
            <div key={rowIndex} className="pipeline-detail-page__aggregate-groupby-row">
              <Select
                ariaLabel={`Partition field ${rowIndex + 1}`}
                value={name}
                placeholder="— select field —"
                options={analyzeSchema.map((f) => ({ value: f.name, label: f.name }))}
                onChange={(next) => handlePartitionFieldChange(rowIndex, next)}
              />
              <button
                type="button"
                className="pipeline-detail-page__row-remove-btn"
                aria-label={`Remove partition field ${rowIndex + 1}`}
                onClick={() => handleRemovePartitionRow(rowIndex)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="pipeline-detail-page__filter-add-btn"
          onClick={handleAddPartitionRow}
        >
          + Add partition field
        </button>
      </div>

      {/* ── Order-by section (reuses SortConfig) ── */}
      <div className="pipeline-detail-page__aggregate-section">
        <span className="pipeline-detail-page__aggregate-section-label">Order by</span>
        <p className="pipeline-detail-page__aggregate-section-description">
          Rows within each partition are ordered by these keys before the function runs.
        </p>
        <SortConfig
          sortBy={config.orderBy}
          columns={analyzeColumns}
          onChange={(next) => emit({ ...config, orderBy: next.sortBy })}
        />
      </div>

      {/* ── Function / field / output section ── */}
      <div className="pipeline-detail-page__aggregate-section">
        <span className="pipeline-detail-page__aggregate-section-label">Function</span>

        <div className="pipeline-detail-page__compute-field">
          <span className="pipeline-detail-page__compute-label">Window function</span>
          <Select
            ariaLabel="Window function"
            value={config.function}
            options={FUNCTION_OPTIONS}
            onChange={handleFunctionChange}
          />
        </div>

        {showField && (
          <div className="pipeline-detail-page__compute-field">
            <span className="pipeline-detail-page__compute-label">Source field</span>
            <Select
              ariaLabel="Source field"
              value={config.field}
              placeholder="— select field —"
              options={analyzeColumns.map((col) => ({ value: col, label: col }))}
              onChange={(next) => emit({ ...config, field: next })}
            />
          </div>
        )}

        {showOffset && (
          <div className="pipeline-detail-page__compute-field">
            <label className="pipeline-detail-page__compute-label" htmlFor="window-offset-input">
              Offset
            </label>
            <TextField
              id="window-offset-input"
              type="number"
              min={1}
              value={config.offset}
              onChange={handleOffsetChange}
              aria-label="Offset"
            />
          </div>
        )}

        <div className="pipeline-detail-page__compute-field">
          <label className="pipeline-detail-page__compute-label" htmlFor="window-output-column">
            Output column
          </label>
          <TextField
            id="window-output-column"
            placeholder="e.g. rank_in_category"
            value={config.outputColumn}
            onChange={handleOutputColumnChange}
            aria-label="Output column"
          />
        </div>
      </div>
    </div>
  );
}
