// JoinConfig — config editor for the "join" pipeline op (HEL-958). A key-based join of the
// step's input (left) against a second input (right): a data source or another lane, via the
// shared SecondaryInputPicker, exactly as union and lookup choose theirs.
//
// The join key must exist on both sides, but the right schema isn't fetchable by id from the
// frontend (lookup design.md Decision 11), so the key is chosen from the left (analyze) schema.
// A stored key absent from it is appended as a labelled option rather than hidden, and a stored
// joinType the backend can't run is flagged and left unselected -- never coerced.

import { TriangleAlert } from "lucide-react";

import { Select } from "../../../../shared/ui/index";
import { ICON_SIZE } from "../../../../shared/ui/iconSize";
import type { SchemaField, SecondaryInput } from "../../types/pipelineStep";
import type { Step } from "../../types/step";
import { SecondaryInputPicker } from "./SecondaryInputPicker";

export interface JoinConfigValue {
  secondary: SecondaryInput;
  joinKey: string;
  /** A plain string, not a union: an unsupported stored value must survive narrowing. */
  joinType: string;
}

interface JoinConfigProps {
  config: JoinConfigValue;
  /** inputSchema from the analyze endpoint — the join-key selector's options. */
  analyzeSchema: SchemaField[];
  /** Every step in the pipeline — feeds the "other lane" option group. */
  allSteps: Step[];
  currentStepId: string;
  onChange: (newConfig: JoinConfigValue) => void;
}

// Mirrors JoinStep.SupportedJoinTypes (backend); anything else fails at run time.
const JOIN_TYPES = ["inner", "left"] as const;

const JOIN_TYPE_DESCRIPTIONS: Record<(typeof JOIN_TYPES)[number], string> = {
  inner: "Only rows whose key matches on both sides are kept.",
  left: "Every input row is kept; unmatched rows get no right-side columns.",
};

export function JoinConfig({
  config,
  analyzeSchema,
  allSteps,
  currentStepId,
  onChange,
}: JoinConfigProps) {
  const normalizedType = config.joinType.trim().toLowerCase();
  const supportedType = JOIN_TYPES.find((t) => t === normalizedType);

  const keyOptions = analyzeSchema.map((f) => ({ value: f.name, label: f.name }));
  if (config.joinKey !== "" && !analyzeSchema.some((f) => f.name === config.joinKey)) {
    keyOptions.push({ value: config.joinKey, label: `${config.joinKey} (not in input)` });
  }

  return (
    <div className="pipeline-detail-page__union-config">
      <SecondaryInputPicker
        label="Right source"
        value={config.secondary}
        allSteps={allSteps}
        currentStepId={currentStepId}
        onChange={(secondary) => onChange({ ...config, secondary })}
      />

      <div className="pipeline-detail-page__compute-field">
        <span className="pipeline-detail-page__compute-label">Join key</span>
        <Select
          ariaLabel="Join key"
          value={config.joinKey}
          placeholder="— select field —"
          options={keyOptions}
          onChange={(joinKey) => onChange({ ...config, joinKey })}
        />
      </div>

      <div className="pipeline-detail-page__filter-combinator">
        <span className="pipeline-detail-page__filter-combinator-label">Join type</span>
        {JOIN_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className={`pipeline-detail-page__filter-combinator-btn${supportedType === t ? " pipeline-detail-page__filter-combinator-btn--active" : ""}`}
            onClick={() => onChange({ ...config, joinType: t })}
            aria-pressed={supportedType === t}
          >
            {t.toUpperCase()}
          </button>
        ))}
      </div>
      {supportedType ? (
        <p className="pipeline-detail-page__aggregate-section-description">
          {JOIN_TYPE_DESCRIPTIONS[supportedType]}
        </p>
      ) : (
        <span className="pipeline-detail-page__filter-warning" role="alert">
          <TriangleAlert size={ICON_SIZE.sm} /> Join type &quot;{config.joinType}&quot; is not
          supported and will fail at run time — choose Inner or Left.
        </span>
      )}
      <p className="pipeline-detail-page__aggregate-section-description">
        The key must exist on both sides. Right-side columns that collide with an input column
        arrive as <code>right_&lt;name&gt;</code>.
      </p>
    </div>
  );
}
