// StringOpsConfig — operation dropdown + per-operation field editor for the
// "stringops" pipeline op (HEL-389). The operation dropdown reveals only the
// params that operation uses (design.md/spec.md scenario "Switching operation
// reveals only the relevant params"): `field` + `outputColumn` for
// trim/upper/lower; `field` + `separator` + `index` + `outputColumn` for
// split; `field` + `pattern` + `outputColumn` for extractRegex; `fields`
// (multi-select, reusing FillNullConfig's checkbox-list pattern) +
// `separator` + `outputColumn` for concat. Mirrors WindowConfig's
// conditional-field-reveal pattern per the ticket's op-wiring checklist.

import type { ChangeEvent } from "react";

import type { SchemaField } from "../types/pipelineStep";
import { Select, TextField } from "../../../shared/ui/index";

export const STRING_OPS_OPERATIONS = [
  "trim",
  "upper",
  "lower",
  "split",
  "extractRegex",
  "concat",
] as const;

export type StringOpsOperationValue = (typeof STRING_OPS_OPERATIONS)[number];

const OPERATION_OPTIONS = STRING_OPS_OPERATIONS.map((op) => ({ value: op, label: op }));

/** Operations that read a single source `field` (concat reads `fields` instead). */
const SINGLE_FIELD_OPERATIONS: readonly StringOpsOperationValue[] = [
  "trim",
  "upper",
  "lower",
  "split",
  "extractRegex",
];

export interface StringOpsConfigValue {
  operation: StringOpsOperationValue;
  field: string;
  outputColumn: string;
  pattern: string;
  separator: string;
  index: number;
  fields: string[];
}

interface StringOpsConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: StringOpsConfigValue;
  /** Full schema fields from the analyze endpoint's inputSchema — field selectors. */
  analyzeSchema: SchemaField[];
  /** Column names derived from analyzeSchema — used by the concat fields checklist. */
  analyzeColumns: string[];
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: StringOpsConfigValue) => void;
}

export function StringOpsConfig({
  config,
  analyzeSchema,
  analyzeColumns,
  onChange,
}: StringOpsConfigProps) {
  function emit(next: StringOpsConfigValue) {
    onChange(next);
  }

  function handleOperationChange(op: string) {
    const next = STRING_OPS_OPERATIONS.includes(op as StringOpsOperationValue)
      ? (op as StringOpsOperationValue)
      : "trim";
    emit({ ...config, operation: next });
  }

  function handleFieldChange(field: string) {
    emit({ ...config, field });
  }

  function handleOutputColumnChange(e: ChangeEvent<HTMLInputElement>) {
    emit({ ...config, outputColumn: e.target.value });
  }

  function handlePatternChange(e: ChangeEvent<HTMLInputElement>) {
    emit({ ...config, pattern: e.target.value });
  }

  function handleSeparatorChange(e: ChangeEvent<HTMLInputElement>) {
    emit({ ...config, separator: e.target.value });
  }

  function handleIndexChange(e: ChangeEvent<HTMLInputElement>) {
    const parsed = parseInt(e.target.value, 10);
    if (!isNaN(parsed)) {
      emit({ ...config, index: parsed });
    }
  }

  function handleFieldsToggle(field: string, checked: boolean) {
    const fields = checked ? [...config.fields, field] : config.fields.filter((f) => f !== field);
    emit({ ...config, fields });
  }

  const isSingleField = SINGLE_FIELD_OPERATIONS.includes(config.operation);
  const isConcat = config.operation === "concat";
  const showSeparator = config.operation === "split" || isConcat;
  const showIndex = config.operation === "split";
  const showPattern = config.operation === "extractRegex";

  return (
    <div className="pipeline-detail-page__aggregate-config">
      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Operation</span>
        <Select
          ariaLabel="Operation"
          value={config.operation}
          options={OPERATION_OPTIONS}
          onChange={handleOperationChange}
        />
      </div>

      {isSingleField && (
        <div className="pipeline-detail-page__compute-field">
          <span className="pipeline-detail-page__compute-label">Source field</span>
          <Select
            ariaLabel="Source field"
            value={config.field}
            placeholder="— select a field —"
            options={analyzeSchema.map((f) => ({ value: f.name, label: f.name }))}
            onChange={handleFieldChange}
          />
        </div>
      )}

      {isConcat && (
        <div className="pipeline-detail-page__compute-field">
          <span className="pipeline-detail-page__compute-label">Fields</span>
          {analyzeColumns.length === 0 ? (
            <ul
              className="pipeline-detail-page__select-fields-list"
              role="list"
              aria-label="Available fields"
            />
          ) : (
            <ul className="pipeline-detail-page__select-fields-list" role="list">
              {analyzeColumns.map((col) => (
                <li key={col} className="pipeline-detail-page__select-fields-item">
                  <label className="pipeline-detail-page__select-fields-label">
                    <input
                      type="checkbox"
                      className="pipeline-detail-page__select-fields-checkbox"
                      checked={config.fields.includes(col)}
                      onChange={(e) => {
                        handleFieldsToggle(col, e.target.checked);
                      }}
                    />
                    {col}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showPattern && (
        <div className="pipeline-detail-page__compute-field">
          <label className="pipeline-detail-page__compute-label" htmlFor="stringops-pattern-input">
            Pattern (must contain a capturing group)
          </label>
          <TextField
            id="stringops-pattern-input"
            placeholder="e.g. ^([^@]+)@"
            value={config.pattern}
            onChange={handlePatternChange}
            aria-label="Pattern"
          />
        </div>
      )}

      {showSeparator && (
        <div className="pipeline-detail-page__compute-field">
          <label
            className="pipeline-detail-page__compute-label"
            htmlFor="stringops-separator-input"
          >
            Separator
          </label>
          <TextField
            id="stringops-separator-input"
            placeholder={isConcat ? "e.g. (space)" : "e.g. /"}
            value={config.separator}
            onChange={handleSeparatorChange}
            aria-label="Separator"
          />
        </div>
      )}

      {showIndex && (
        <div className="pipeline-detail-page__compute-field">
          <label className="pipeline-detail-page__compute-label" htmlFor="stringops-index-input">
            Index
          </label>
          <TextField
            id="stringops-index-input"
            type="number"
            value={config.index}
            onChange={handleIndexChange}
            aria-label="Index"
          />
        </div>
      )}

      <div className="pipeline-detail-page__compute-field">
        <label className="pipeline-detail-page__compute-label" htmlFor="stringops-output-column">
          Output column
        </label>
        <TextField
          id="stringops-output-column"
          placeholder="e.g. fullName"
          value={config.outputColumn}
          onChange={handleOutputColumnChange}
          aria-label="Output column"
        />
      </div>
    </div>
  );
}
