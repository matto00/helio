// ChunkByTokenCountConfig — field + token-count + encoding editor for the
// "chunkbytokencount" pipeline op (HEL-221, third and final of the planned
// "text op" family — mirrors SplitTextConfig/ExtractHeadingsConfig's
// analyzeSchema-driven field dropdown pattern, see design.md decision 6).
//
// Field dropdown is restricted to analyzeSchema entries whose type is
// "string-body". A numeric targetTokenCount input follows the
// LimitConfig/SplitTextConfig heading-level recipe; the encoding dropdown
// offers the two jtokkit encodings this op supports.

import type { ChangeEvent } from "react";

import type { SchemaField } from "../types/pipelineStep";
import { Select, TextField } from "../../../shared/ui/index";

export interface ChunkByTokenCountConfigValue {
  field: string;
  targetTokenCount: number;
  encoding: "o200k_base" | "cl100k_base";
  indexField: string;
  tokenCountField: string;
}

interface ChunkByTokenCountConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: ChunkByTokenCountConfigValue;
  /** Full schema fields from the analyze endpoint's inputSchema — filtered to
   *  string-body entries for the field dropdown. */
  analyzeSchema: SchemaField[];
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: ChunkByTokenCountConfigValue) => void;
}

const ENCODING_OPTIONS = [
  { value: "o200k_base", label: "o200k_base (GPT-4o family)" },
  { value: "cl100k_base", label: "cl100k_base (GPT-3.5/4 family)" },
];

export function ChunkByTokenCountConfig({
  config,
  analyzeSchema,
  onChange,
}: ChunkByTokenCountConfigProps) {
  const contentFields = analyzeSchema.filter((f) => f.type === "string-body");

  function handleFieldChange(field: string) {
    onChange({ ...config, field });
  }

  function handleEncodingChange(encoding: string) {
    onChange({ ...config, encoding: encoding === "cl100k_base" ? "cl100k_base" : "o200k_base" });
  }

  function handleTargetTokenCountChange(e: ChangeEvent<HTMLInputElement>) {
    const parsed = parseInt(e.target.value, 10);
    if (!isNaN(parsed) && parsed > 0) {
      onChange({ ...config, targetTokenCount: parsed });
    }
  }

  return (
    <div className="pipeline-detail-page__splittext-config">
      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Content field</span>
        <Select
          ariaLabel="Content field to chunk"
          value={config.field}
          placeholder="— select a string-body field —"
          options={contentFields.map((f) => ({ value: f.name, label: f.name }))}
          onChange={handleFieldChange}
        />
      </div>

      <div className="pipeline-detail-page__limit-config-row">
        <label
          className="pipeline-detail-page__limit-config-label"
          htmlFor="chunkbytokencount-target-count-input"
        >
          Target token count (N)
        </label>
        <TextField
          id="chunkbytokencount-target-count-input"
          type="number"
          min={1}
          value={config.targetTokenCount}
          onChange={handleTargetTokenCountChange}
          aria-label="Target token count"
        />
      </div>

      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Encoding</span>
        <Select
          ariaLabel="Token encoding"
          value={config.encoding}
          options={ENCODING_OPTIONS}
          onChange={handleEncodingChange}
        />
      </div>
    </div>
  );
}
