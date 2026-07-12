// ExtractHeadingsConfig — field editor for the "extractheadings" pipeline op
// (HEL-220, second of the planned "text op" family — mirrors SplitTextConfig's
// analyzeSchema-driven field dropdown pattern, see design.md decision 6).
//
// Field dropdown is restricted to analyzeSchema entries whose type is
// "string-body". Unlike SplitTextConfig, there is no mode toggle — this op has
// a single behavior (extract every ATX heading line).

import type { SchemaField } from "../types/pipelineStep";
import { Select } from "../../../shared/ui/index";

export interface ExtractHeadingsConfigValue {
  field: string;
  indexField: string;
  levelField: string;
}

interface ExtractHeadingsConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: ExtractHeadingsConfigValue;
  /** Full schema fields from the analyze endpoint's inputSchema — filtered to
   *  string-body entries for the field dropdown. */
  analyzeSchema: SchemaField[];
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: ExtractHeadingsConfigValue) => void;
}

export function ExtractHeadingsConfig({
  config,
  analyzeSchema,
  onChange,
}: ExtractHeadingsConfigProps) {
  const contentFields = analyzeSchema.filter((f) => f.type === "string-body");

  function handleFieldChange(field: string) {
    onChange({ ...config, field });
  }

  return (
    <div className="pipeline-detail-page__splittext-config">
      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Content field</span>
        <Select
          ariaLabel="Content field to extract headings from"
          value={config.field}
          placeholder="— select a string-body field —"
          options={contentFields.map((f) => ({ value: f.name, label: f.name }))}
          onChange={handleFieldChange}
        />
      </div>
    </div>
  );
}
