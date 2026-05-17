// ComputeFieldConfig — config editor for the "compute" pipeline op.
// Renders an output field name input, an expression text input, and a read-only
// available-fields hint list derived from the per-step inputSchema.
// Follows the same props-driven pattern as CastFieldsConfig / FilterConfig:
// the parent (StepCard) owns state and calls onChange with the serialized config JSON.

import type { ChangeEvent } from "react";

import { TextField } from "../shared/ui/index";

export interface ComputeConfigValue {
  column: string;
  expression: string;
  type: string;
}

interface ComputeFieldConfigProps {
  /** Parsed config object for this compute step. */
  config: ComputeConfigValue;
  /** Column names from the analyze endpoint's inputSchema — shown as available-fields hints. */
  analyzeColumns: string[];
  /** Called with the typed config object on any field change (CS2c-3a). */
  onChange: (newConfig: ComputeConfigValue) => void;
}

export function ComputeFieldConfig({ config, analyzeColumns, onChange }: ComputeFieldConfigProps) {
  function emit(next: ComputeConfigValue) {
    onChange(next);
  }

  function handleColumnChange(e: ChangeEvent<HTMLInputElement>) {
    emit({ ...config, column: e.target.value });
  }

  function handleExpressionChange(e: ChangeEvent<HTMLInputElement>) {
    emit({ ...config, expression: e.target.value });
  }

  return (
    <div className="pipeline-detail-page__compute-config">
      <div className="pipeline-detail-page__compute-field">
        <label className="pipeline-detail-page__compute-label" htmlFor="compute-column">
          Output field name
        </label>
        <TextField
          id="compute-column"
          placeholder="e.g. revenue_per_user"
          value={config.column}
          onChange={handleColumnChange}
          onBlur={handleColumnChange}
          aria-label="Output field name"
        />
      </div>

      <div className="pipeline-detail-page__compute-field">
        <label className="pipeline-detail-page__compute-label" htmlFor="compute-expression">
          Expression
        </label>
        <TextField
          id="compute-expression"
          mono
          placeholder="e.g. revenue / users"
          value={config.expression}
          onChange={handleExpressionChange}
          onBlur={handleExpressionChange}
          aria-label="Expression"
        />
      </div>

      {analyzeColumns.length > 0 && (
        <div className="pipeline-detail-page__compute-fields-hint">
          <span className="pipeline-detail-page__compute-fields-hint-label">Available fields:</span>
          <ul
            className="pipeline-detail-page__compute-fields-hint-list"
            aria-label="Available fields"
          >
            {analyzeColumns.map((col) => (
              <li key={col} className="pipeline-detail-page__compute-fields-hint-item">
                {col}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
