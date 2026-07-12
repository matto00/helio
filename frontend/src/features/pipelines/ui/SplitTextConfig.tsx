// SplitTextConfig — field + mode editor for the "splittext" pipeline op
// (HEL-219, first of the planned "text op" family — see design.md decision 6
// for the field-gating rationale).
//
// Field dropdown is restricted to analyzeSchema entries whose type is
// "string-body" (mirrors FilterConfig's analyzeSchema-driven field dropdown).
// A paragraph/heading mode toggle follows the filter-combinator recipe; the
// heading-level numeric input only renders in heading mode.

import type { ChangeEvent } from "react";

import type { SchemaField } from "../types/pipelineStep";
import { Select, TextField } from "../../../shared/ui/index";

export interface SplitTextConfigValue {
  field: string;
  mode: "paragraph" | "heading";
  headingLevel: number;
  indexField: string;
}

interface SplitTextConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: SplitTextConfigValue;
  /** Full schema fields from the analyze endpoint's inputSchema — filtered to
   *  string-body entries for the field dropdown. */
  analyzeSchema: SchemaField[];
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: SplitTextConfigValue) => void;
}

export function SplitTextConfig({ config, analyzeSchema, onChange }: SplitTextConfigProps) {
  const contentFields = analyzeSchema.filter((f) => f.type === "string-body");

  function handleFieldChange(field: string) {
    onChange({ ...config, field });
  }

  function handleModeChange(mode: "paragraph" | "heading") {
    onChange({ ...config, mode });
  }

  function handleHeadingLevelChange(e: ChangeEvent<HTMLInputElement>) {
    const parsed = parseInt(e.target.value, 10);
    if (!isNaN(parsed) && parsed > 0) {
      onChange({ ...config, headingLevel: parsed });
    }
  }

  return (
    <div className="pipeline-detail-page__splittext-config">
      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Content field</span>
        <Select
          ariaLabel="Content field to split"
          value={config.field}
          placeholder="— select a string-body field —"
          options={contentFields.map((f) => ({ value: f.name, label: f.name }))}
          onChange={handleFieldChange}
        />
      </div>

      <div className="pipeline-detail-page__filter-combinator">
        <span className="pipeline-detail-page__filter-combinator-label">Split on</span>
        <button
          type="button"
          className={`pipeline-detail-page__filter-combinator-btn${config.mode === "paragraph" ? " pipeline-detail-page__filter-combinator-btn--active" : ""}`}
          onClick={() => handleModeChange("paragraph")}
          aria-pressed={config.mode === "paragraph"}
        >
          PARAGRAPH BREAKS
        </button>
        <button
          type="button"
          className={`pipeline-detail-page__filter-combinator-btn${config.mode === "heading" ? " pipeline-detail-page__filter-combinator-btn--active" : ""}`}
          onClick={() => handleModeChange("heading")}
          aria-pressed={config.mode === "heading"}
        >
          MARKDOWN HEADING
        </button>
      </div>

      {config.mode === "heading" && (
        <div className="pipeline-detail-page__limit-config-row">
          <label
            className="pipeline-detail-page__limit-config-label"
            htmlFor="splittext-heading-level-input"
          >
            Heading level (#)
          </label>
          <TextField
            id="splittext-heading-level-input"
            type="number"
            min={1}
            value={config.headingLevel}
            onChange={handleHeadingLevelChange}
            aria-label="Heading level"
          />
        </div>
      )}
    </div>
  );
}
