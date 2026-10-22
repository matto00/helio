// UnionConfig — other-source/other-lane picker + byPosition/byName mode
// toggle for the "union" pipeline op (HEL-384 — see design.md Decisions
// 2-4, 7; HEL-912 design.md Decision 4 widened the "other operand" picker
// from data-source-only to `SecondaryInput` — a data source OR a lane
// node).
//
// The mode toggle reuses the filter-combinator button recipe (see
// DedupeConfig's keep first/last toggle) since it's the same binary-choice
// UI shape.

import type { SecondaryInput, UnionMode } from "../../types/pipelineStep";
import type { Step } from "../../types/step";
import { SecondaryInputPicker } from "./SecondaryInputPicker";

export interface UnionConfigValue {
  secondary: SecondaryInput;
  mode: UnionMode;
}

interface UnionConfigProps {
  /** Parsed config object from the step's persisted config. */
  config: UnionConfigValue;
  /** Every step in the pipeline (across every lane) — feeds the "other
   *  lane" option group (HEL-912 task 5.3). */
  allSteps: Step[];
  currentStepId: string;
  /** Called with the typed config object on any change (CS2c-3a). */
  onChange: (newConfig: UnionConfigValue) => void;
}

export function UnionConfig({ config, allSteps, currentStepId, onChange }: UnionConfigProps) {
  function handleSecondaryChange(secondary: SecondaryInput) {
    onChange({ ...config, secondary });
  }

  function handleModeChange(mode: UnionMode) {
    onChange({ ...config, mode });
  }

  return (
    <div className="pipeline-detail-page__union-config">
      <SecondaryInputPicker
        label="Other source"
        value={config.secondary}
        allSteps={allSteps}
        currentStepId={currentStepId}
        onChange={handleSecondaryChange}
      />

      <div className="pipeline-detail-page__filter-combinator">
        <span className="pipeline-detail-page__filter-combinator-label">Mode</span>
        <button
          type="button"
          className={`pipeline-detail-page__filter-combinator-btn${config.mode === "byPosition" ? " pipeline-detail-page__filter-combinator-btn--active" : ""}`}
          onClick={() => handleModeChange("byPosition")}
          aria-pressed={config.mode === "byPosition"}
        >
          BY POSITION
        </button>
        <button
          type="button"
          className={`pipeline-detail-page__filter-combinator-btn${config.mode === "byName" ? " pipeline-detail-page__filter-combinator-btn--active" : ""}`}
          onClick={() => handleModeChange("byName")}
          aria-pressed={config.mode === "byName"}
        >
          BY NAME
        </button>
      </div>
      <p className="pipeline-detail-page__aggregate-section-description">
        {config.mode === "byPosition"
          ? "Rows are appended as-is; both sources should share the same columns."
          : "Rows are aligned by column name; a column missing on either side is filled with null."}
      </p>
    </div>
  );
}
