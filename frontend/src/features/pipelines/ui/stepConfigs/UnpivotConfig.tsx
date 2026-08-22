// UnpivotConfig — config editor for the "unpivot" pipeline op (HEL-380), the
// inverse of "pivot". Renders two multi-select sections (idVars/valueVars —
// each mirrors PivotConfig's index-fields dropdown rows) plus two text
// inputs for varName/valueName pre-filled with their "variable"/"value"
// defaults (mirroring WindowConfig's TextField usage for outputColumn).
// Follows the same props-driven pattern as PivotConfig/WindowConfig: the
// parent (StepCard) owns state and calls onChange with the typed config.

import type { ChangeEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

import type { SchemaField } from "../../types/pipelineStep";
import { Select, TextField } from "../../../../shared/ui/index";

export interface UnpivotConfigValue {
  idVars: string[];
  valueVars: string[];
  varName: string;
  valueName: string;
}

interface UnpivotConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: UnpivotConfigValue;
  /** Full schema fields from the analyze endpoint's inputSchema — idVars/valueVars field selectors. */
  analyzeSchema: SchemaField[];
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: UnpivotConfigValue) => void;
}

export function UnpivotConfig({ config, analyzeSchema, onChange }: UnpivotConfigProps) {
  function emit(next: UnpivotConfigValue) {
    onChange(next);
  }

  // ── idVars handlers ─────────────────────────────────────────────────────

  function handleAddIdVarRow() {
    const defaultField = analyzeSchema.length > 0 ? analyzeSchema[0].name : "";
    emit({ ...config, idVars: [...config.idVars, defaultField] });
  }

  function handleIdVarFieldChange(rowIndex: number, name: string) {
    const idVars = config.idVars.map((f, i) => (i === rowIndex ? name : f));
    emit({ ...config, idVars });
  }

  function handleRemoveIdVarRow(rowIndex: number) {
    const idVars = config.idVars.filter((_, i) => i !== rowIndex);
    emit({ ...config, idVars });
  }

  // ── valueVars handlers ──────────────────────────────────────────────────

  function handleAddValueVarRow() {
    const defaultField = analyzeSchema.length > 0 ? analyzeSchema[0].name : "";
    emit({ ...config, valueVars: [...config.valueVars, defaultField] });
  }

  function handleValueVarFieldChange(rowIndex: number, name: string) {
    const valueVars = config.valueVars.map((f, i) => (i === rowIndex ? name : f));
    emit({ ...config, valueVars });
  }

  function handleRemoveValueVarRow(rowIndex: number) {
    const valueVars = config.valueVars.filter((_, i) => i !== rowIndex);
    emit({ ...config, valueVars });
  }

  function handleVarNameChange(e: ChangeEvent<HTMLInputElement>) {
    emit({ ...config, varName: e.target.value });
  }

  function handleValueNameChange(e: ChangeEvent<HTMLInputElement>) {
    emit({ ...config, valueName: e.target.value });
  }

  return (
    <div className="pipeline-detail-page__aggregate-config">
      {/* ── idVars section ── */}
      <div className="pipeline-detail-page__aggregate-section">
        <span className="pipeline-detail-page__aggregate-section-label">Id fields</span>
        <p className="pipeline-detail-page__aggregate-section-description">
          Id fields are carried unchanged onto every emitted row.
        </p>

        <div className="pipeline-detail-page__aggregate-groupby-rows">
          {config.idVars.map((name, rowIndex) => (
            <div key={rowIndex} className="pipeline-detail-page__aggregate-groupby-row">
              <Select
                ariaLabel={`Id field ${rowIndex + 1}`}
                value={name}
                placeholder="— select field —"
                options={analyzeSchema.map((f) => ({ value: f.name, label: f.name }))}
                onChange={(next) => handleIdVarFieldChange(rowIndex, next)}
              />
              <button
                type="button"
                className="pipeline-detail-page__row-remove-btn"
                aria-label={`Remove id field ${rowIndex + 1}`}
                onClick={() => handleRemoveIdVarRow(rowIndex)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="pipeline-detail-page__filter-add-btn"
          onClick={handleAddIdVarRow}
        >
          + Add id field
        </button>
      </div>

      {/* ── valueVars section ── */}
      <div className="pipeline-detail-page__aggregate-section">
        <span className="pipeline-detail-page__aggregate-section-label">Value fields</span>
        <p className="pipeline-detail-page__aggregate-section-description">
          Each value field becomes one output row per input row, holding that column&apos;s name and
          cell value.
        </p>

        <div className="pipeline-detail-page__aggregate-groupby-rows">
          {config.valueVars.map((name, rowIndex) => (
            <div key={rowIndex} className="pipeline-detail-page__aggregate-groupby-row">
              <Select
                ariaLabel={`Value field ${rowIndex + 1}`}
                value={name}
                placeholder="— select field —"
                options={analyzeSchema.map((f) => ({ value: f.name, label: f.name }))}
                onChange={(next) => handleValueVarFieldChange(rowIndex, next)}
              />
              <button
                type="button"
                className="pipeline-detail-page__row-remove-btn"
                aria-label={`Remove value field ${rowIndex + 1}`}
                onClick={() => handleRemoveValueVarRow(rowIndex)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="pipeline-detail-page__filter-add-btn"
          onClick={handleAddValueVarRow}
        >
          + Add value field
        </button>
      </div>

      {/* ── varName / valueName section ── */}
      <div className="pipeline-detail-page__aggregate-section">
        <span className="pipeline-detail-page__aggregate-section-label">Output columns</span>

        <div className="pipeline-detail-page__compute-field">
          <label className="pipeline-detail-page__compute-label" htmlFor="unpivot-var-name">
            Variable column
          </label>
          <TextField
            id="unpivot-var-name"
            placeholder="variable"
            value={config.varName}
            onChange={handleVarNameChange}
            aria-label="Variable column"
          />
        </div>

        <div className="pipeline-detail-page__compute-field">
          <label className="pipeline-detail-page__compute-label" htmlFor="unpivot-value-name">
            Value column
          </label>
          <TextField
            id="unpivot-value-name"
            placeholder="value"
            value={config.valueName}
            onChange={handleValueNameChange}
            aria-label="Value column"
          />
        </div>
      </div>
    </div>
  );
}
