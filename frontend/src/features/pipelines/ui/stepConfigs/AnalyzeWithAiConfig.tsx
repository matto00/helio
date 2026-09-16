// AnalyzeWithAiConfig — input-field picker, instruction, and an ordered
// output-schema row editor for the "analyzewithai" pipeline op (HEL-1109 —
// see design.md Decisions 3/4/5/7).
//
// The output schema is edited as an ordered row list and emitted as a JSON
// ARRAY in display order (design.md D4) — never an object, which
// spray-json's serializer would silently re-sort by key. Capped at
// MAX_OUTPUT_SCHEMA_ENTRIES, matching the backend's own limit.

import type { SchemaField } from "../../types/pipelineStep";
import type { OutputSchemaFieldType } from "../../types/pipelineStep";
import { Select, TextField, Textarea } from "../../../../shared/ui/index";
import { InlineError } from "../../../../shared/chrome/InlineError";
import { ICON_SIZE } from "../../../../shared/ui/iconSize";
import {
  MAX_OUTPUT_SCHEMA_ENTRIES,
  OUTPUT_SCHEMA_FIELD_TYPES,
  type AnalyzeWithAiConfigValue,
} from "../../state/stepNarrowing";
import { AiStepCostDisclosure } from "./AiStepCostDisclosure";
import { ChevronDown, ChevronUp, X } from "lucide-react";

export type { AnalyzeWithAiConfigValue };

interface AnalyzeWithAiConfigProps {
  /** Parsed config object from the step's persisted (or draft) config. */
  config: AnalyzeWithAiConfigValue;
  /** Full schema fields from the analyze endpoint's inputSchema — filtered to
   *  string/string-body entries for the input-field dropdown (design.md D7). */
  analyzeSchema: SchemaField[];
  /** design.md D5 — the pipeline's own estimated row count, when known. */
  estimatedRows?: number;
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: AnalyzeWithAiConfigValue) => void;
}

export function AnalyzeWithAiConfig({
  config,
  analyzeSchema,
  estimatedRows,
  onChange,
}: AnalyzeWithAiConfigProps) {
  const stringFields = analyzeSchema.filter((f) => f.type === "string" || f.type === "string-body");

  function handleInputFieldChange(inputField: string) {
    onChange({ ...config, inputField });
  }

  function handleInstructionChange(instruction: string) {
    onChange({ ...config, instruction });
  }

  function handleAddField() {
    if (config.outputSchema.length >= MAX_OUTPUT_SCHEMA_ENTRIES) return;
    onChange({
      ...config,
      outputSchema: [...config.outputSchema, { name: "", type: "string" }],
    });
  }

  function handleRemoveField(index: number) {
    onChange({ ...config, outputSchema: config.outputSchema.filter((_, i) => i !== index) });
  }

  function handleFieldNameChange(index: number, name: string) {
    const outputSchema = config.outputSchema.map((f, i) => (i === index ? { ...f, name } : f));
    onChange({ ...config, outputSchema });
  }

  function handleFieldTypeChange(index: number, type: string) {
    const outputSchema = config.outputSchema.map((f, i) =>
      i === index ? { ...f, type: type as OutputSchemaFieldType } : f,
    );
    onChange({ ...config, outputSchema });
  }

  function handleMoveUp(index: number) {
    if (index <= 0) return;
    const outputSchema = [...config.outputSchema];
    [outputSchema[index - 1], outputSchema[index]] = [outputSchema[index], outputSchema[index - 1]];
    onChange({ ...config, outputSchema });
  }

  function handleMoveDown(index: number) {
    if (index >= config.outputSchema.length - 1) return;
    const outputSchema = [...config.outputSchema];
    [outputSchema[index], outputSchema[index + 1]] = [outputSchema[index + 1], outputSchema[index]];
    onChange({ ...config, outputSchema });
  }

  const names = config.outputSchema.map((f) => f.name.trim());
  const duplicateNames = new Set(
    names.filter((name, i) => name !== "" && names.indexOf(name) !== i),
  );
  const atCap = config.outputSchema.length >= MAX_OUTPUT_SCHEMA_ENTRIES;

  return (
    <div className="pipeline-detail-page__analyzewithai-config">
      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Input field</span>
        <Select
          ariaLabel="Input field to analyze"
          value={config.inputField}
          placeholder="— select a string field —"
          options={stringFields.map((f) => ({ value: f.name, label: f.name }))}
          onChange={handleInputFieldChange}
        />
      </div>

      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Instruction</span>
        <Textarea
          aria-label="Instruction for the model"
          placeholder="e.g. Extract the sentiment and key topics from this text"
          value={config.instruction}
          onChange={(e) => handleInstructionChange(e.target.value)}
        />
        {!config.instruction.trim() && <InlineError error="Instruction is required" />}
      </div>

      <div className="pipeline-detail-page__aggregate-section">
        <span className="pipeline-detail-page__aggregate-section-label">Output fields</span>
        <p className="pipeline-detail-page__aggregate-section-description">
          Declared fields are emitted in the order shown here — reorder with the arrows below.
        </p>

        <div className="pipeline-detail-page__aggregate-groupby-rows">
          {config.outputSchema.map((field, index) => {
            const trimmedName = field.name.trim();
            const isEmpty = trimmedName === "";
            const isDuplicate = !isEmpty && duplicateNames.has(trimmedName);
            const collidesWithInput = !isEmpty && trimmedName === config.inputField.trim();
            const nameErrorId = isEmpty
              ? `analyzewithai-output-field-${index}-empty-error`
              : undefined;
            return (
              <div key={index} className="pipeline-detail-page__aggregate-groupby-row">
                <TextField
                  aria-label={`Output field ${index + 1} name`}
                  placeholder="field name"
                  value={field.name}
                  onChange={(e) => handleFieldNameChange(index, e.target.value)}
                  aria-invalid={isEmpty ? true : undefined}
                  aria-describedby={nameErrorId}
                />
                <Select
                  ariaLabel={`Output field ${index + 1} type`}
                  value={field.type}
                  options={OUTPUT_SCHEMA_FIELD_TYPES.map((t) => ({ value: t, label: t }))}
                  onChange={(next) => handleFieldTypeChange(index, next)}
                />
                <button
                  type="button"
                  className="pipeline-detail-page__step-card-move-btn"
                  aria-label={`Move output field ${index + 1} up`}
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => handleMoveUp(index)}
                >
                  <ChevronUp aria-hidden="true" size={ICON_SIZE.sm} />
                </button>
                <button
                  type="button"
                  className="pipeline-detail-page__step-card-move-btn"
                  aria-label={`Move output field ${index + 1} down`}
                  title="Move down"
                  disabled={index === config.outputSchema.length - 1}
                  onClick={() => handleMoveDown(index)}
                >
                  <ChevronDown aria-hidden="true" size={ICON_SIZE.sm} />
                </button>
                <button
                  type="button"
                  className="pipeline-detail-page__row-remove-btn"
                  aria-label={`Remove output field ${index + 1}`}
                  onClick={() => handleRemoveField(index)}
                >
                  <X size={ICON_SIZE.sm} />
                </button>
                {isEmpty && (
                  <p id={nameErrorId} className="inline-error">
                    Output field name is required
                  </p>
                )}
                {isDuplicate && (
                  <InlineError error={`"${trimmedName}" is declared more than once`} />
                )}
                {collidesWithInput && (
                  <InlineError error={`"${trimmedName}" collides with the input field`} />
                )}
              </div>
            );
          })}
        </div>

        {config.outputSchema.length === 0 && (
          <InlineError error="At least one output field is required" />
        )}

        <button
          type="button"
          className="pipeline-detail-page__filter-add-btn"
          onClick={handleAddField}
          disabled={atCap}
        >
          + Add output field
        </button>
        {atCap && (
          <p className="pipeline-detail-page__compute-fields-hint">
            Limit reached — up to {MAX_OUTPUT_SCHEMA_ENTRIES} output fields are supported.
          </p>
        )}
      </div>

      <AiStepCostDisclosure estimatedRows={estimatedRows} />
    </div>
  );
}
