// GenerateTextConfig — input-field picker, instruction, and destination-field
// editor for the "generatetext" pipeline op (HEL-1109 — see design.md
// Decisions 3/5/7).
//
// `outputField` is NEVER prefilled or defaulted from `inputField` — a
// generator that overwrote its own source would destroy the content it was
// asked to summarize, and the backend deliberately rejects an absent/empty
// `outputField`.

import type { SchemaField } from "../../types/pipelineStep";
import { Select, TextField, Textarea } from "../../../../shared/ui/index";
import { InlineError } from "../../../../shared/chrome/InlineError";
import { AiStepCostDisclosure } from "./AiStepCostDisclosure";

export interface GenerateTextConfigValue {
  inputField: string;
  instruction: string;
  outputField: string;
}

interface GenerateTextConfigProps {
  /** Parsed config object from the step's persisted (or draft) config. */
  config: GenerateTextConfigValue;
  /** Full schema fields from the analyze endpoint's inputSchema — filtered to
   *  string/string-body entries for the input-field dropdown (design.md D7). */
  analyzeSchema: SchemaField[];
  /** design.md D5 — the pipeline's own estimated row count, when known. */
  estimatedRows?: number;
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: GenerateTextConfigValue) => void;
}

export function GenerateTextConfig({
  config,
  analyzeSchema,
  estimatedRows,
  onChange,
}: GenerateTextConfigProps) {
  const stringFields = analyzeSchema.filter((f) => f.type === "string" || f.type === "string-body");
  const existingColumnNames = new Set(analyzeSchema.map((f) => f.name));

  function handleInputFieldChange(inputField: string) {
    // Deliberately does NOT touch outputField — see file header.
    onChange({ ...config, inputField });
  }

  function handleInstructionChange(instruction: string) {
    onChange({ ...config, instruction });
  }

  function handleOutputFieldChange(outputField: string) {
    onChange({ ...config, outputField });
  }

  const trimmedOutputField = config.outputField.trim();
  const overwritesExisting =
    trimmedOutputField !== "" && existingColumnNames.has(trimmedOutputField);

  return (
    <div className="pipeline-detail-page__generatetext-config">
      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Input field</span>
        <Select
          ariaLabel="Input field to generate from"
          value={config.inputField}
          placeholder="— select a string field —"
          options={stringFields.map((f) => ({ value: f.name, label: f.name }))}
          onChange={handleInputFieldChange}
        />
        {!config.inputField.trim() && <InlineError error="Input field is required" />}
      </div>

      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Instruction</span>
        <Textarea
          aria-label="Instruction for the model"
          placeholder="e.g. Write a one-sentence summary of this text"
          value={config.instruction}
          onChange={(e) => handleInstructionChange(e.target.value)}
        />
        {!config.instruction.trim() && <InlineError error="Instruction is required" />}
      </div>

      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Destination field</span>
        <TextField
          placeholder="e.g. summary"
          value={config.outputField}
          onChange={(e) => handleOutputFieldChange(e.target.value)}
          aria-label="Destination field"
        />
        {!trimmedOutputField && <InlineError error="Destination field is required" />}
        {overwritesExisting && (
          <p className="pipeline-detail-page__compute-fields-hint">
            &quot;{trimmedOutputField}&quot; already exists in the input schema — this step will
            overwrite it.
          </p>
        )}
      </div>

      <AiStepCostDisclosure estimatedRows={estimatedRows} />
    </div>
  );
}
