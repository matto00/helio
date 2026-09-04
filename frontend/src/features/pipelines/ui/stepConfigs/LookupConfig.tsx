// LookupConfig — config editor for the "lookup" pipeline op (HEL-386), a
// constrained single-key left-join against a reference DataSource or lane
// node (HEL-912 design.md Decision 4). `sourceKey` is a Select sourced from
// analyzeSchema (the current step's input schema, which IS known).
// `lookupKey` and `columns` name fields on the reference source's schema,
// which isn't fetchable by id from the frontend today (see design.md
// Decision 11) — `lookupKey` is a free-text TextField and `columns` is a
// free-text add/remove row list mirroring UnpivotConfig.tsx's row-add UI
// shape, with TextField rows instead of Select rows.

import type { ChangeEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

import { Select, TextField } from "../../../../shared/ui/index";
import type { SchemaField, SecondaryInput } from "../../types/pipelineStep";
import type { Step } from "../../types/step";
import { SecondaryInputPicker } from "./SecondaryInputPicker";

export interface LookupConfigValue {
  secondary: SecondaryInput;
  sourceKey: string;
  lookupKey: string;
  columns: string[];
}

interface LookupConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: LookupConfigValue;
  /** Full schema fields from the analyze endpoint's inputSchema — sourceKey field selector. */
  analyzeSchema: SchemaField[];
  /** Every step in the pipeline — feeds the "other lane" option group. */
  allSteps: Step[];
  currentStepId: string;
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: LookupConfigValue) => void;
}

export function LookupConfig({
  config,
  analyzeSchema,
  allSteps,
  currentStepId,
  onChange,
}: LookupConfigProps) {
  function handleSecondaryChange(secondary: SecondaryInput) {
    onChange({ ...config, secondary });
  }

  function handleSourceKeyChange(sourceKey: string) {
    onChange({ ...config, sourceKey });
  }

  function handleLookupKeyChange(e: ChangeEvent<HTMLInputElement>) {
    onChange({ ...config, lookupKey: e.target.value });
  }

  function handleAddColumnRow() {
    onChange({ ...config, columns: [...config.columns, ""] });
  }

  function handleColumnChange(rowIndex: number, name: string) {
    const columns = config.columns.map((c, i) => (i === rowIndex ? name : c));
    onChange({ ...config, columns });
  }

  function handleRemoveColumnRow(rowIndex: number) {
    const columns = config.columns.filter((_, i) => i !== rowIndex);
    onChange({ ...config, columns });
  }

  return (
    <div className="pipeline-detail-page__union-config">
      <SecondaryInputPicker
        label="Reference source"
        value={config.secondary}
        allSteps={allSteps}
        currentStepId={currentStepId}
        onChange={handleSecondaryChange}
      />

      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Match on field</span>
        <Select
          ariaLabel="Match on field"
          value={config.sourceKey}
          placeholder="— select field —"
          options={analyzeSchema.map((f) => ({ value: f.name, label: f.name }))}
          onChange={handleSourceKeyChange}
        />
      </div>

      <div className="pipeline-detail-page__compute-field">
        <label className="pipeline-detail-page__compute-label" htmlFor="lookup-key">
          Reference match field
        </label>
        <TextField
          id="lookup-key"
          placeholder="e.g. code"
          value={config.lookupKey}
          onChange={handleLookupKeyChange}
          aria-label="Reference match field"
        />
      </div>

      <div className="pipeline-detail-page__aggregate-section">
        <span className="pipeline-detail-page__aggregate-section-label">Columns to bring in</span>
        <p className="pipeline-detail-page__aggregate-section-description">
          Only these reference-source field names are added to each row; unmatched rows get null for
          each.
        </p>

        <div className="pipeline-detail-page__aggregate-groupby-rows">
          {config.columns.map((name, rowIndex) => (
            <div key={rowIndex} className="pipeline-detail-page__aggregate-groupby-row">
              <TextField
                placeholder="e.g. label"
                value={name}
                onChange={(e) => handleColumnChange(rowIndex, e.target.value)}
                aria-label={`Column ${rowIndex + 1}`}
              />
              <button
                type="button"
                className="pipeline-detail-page__row-remove-btn"
                aria-label={`Remove column ${rowIndex + 1}`}
                onClick={() => handleRemoveColumnRow(rowIndex)}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          className="pipeline-detail-page__filter-add-btn"
          onClick={handleAddColumnRow}
        >
          + Add column
        </button>
      </div>
    </div>
  );
}
