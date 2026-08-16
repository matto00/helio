// PipelineRiverView — the central "river" canvas of the PipelineDetailPage
// that lists each StepCard with ribbon segments between them, plus the
// add-step controls (empty-state CTA when no steps; dashed "+ Add" button
// otherwise). Extracted from PipelineDetailPage.tsx in CS3 cycle 2 to keep
// the parent under the 400L hard cap.

import { useRef, useState } from "react";

import { OpDropdown } from "./OpDropdown";
import { RibbonSegment } from "./RibbonSegment";
import { ShapePickerModal } from "./ShapePickerModal";
import { StepCard } from "./StepCard";
import type { OpType, Step } from "../types/step";
import type { PipelineStepConfig, SchemaField } from "../types/pipelineStep";
import type { ShapeStepExpansion } from "../types/pipelineShape";

interface PipelineRiverViewProps {
  steps: Step[];
  pipelineId: string;
  dropdownOpen: boolean;
  openDropdown: () => void;
  closeDropdown: () => void;
  onAddStep: (opType: OpType) => void;
  onRemoveStep: (stepId: string) => void;
  getAnalyzeColumns: (stepId: string) => string[];
  getAnalyzeSchema: (stepId: string) => SchemaField[];
  /** HEL-404 — per-step output schema (name + type), sourced from the analyze
   *  endpoint's outputSchema; threaded into StepCard's inline preview tray. */
  getAnalyzeOutputSchema: (stepId: string) => SchemaField[];
  getAnalyzeValidationError: (stepId: string) => string | undefined;
  onStepConfigChange: (stepId: string, config: PipelineStepConfig) => void;
  runStepRowCounts: Record<string, number> | null | undefined;
  /** HEL-402 — performs the sequential per-step create loop for a shape's
   *  expanded steps; see `PipelineDetailPage.handleInstantiateShape`. */
  onInstantiateShape: (expansions: ShapeStepExpansion[]) => Promise<void>;
}

export function PipelineRiverView({
  steps,
  pipelineId,
  dropdownOpen,
  openDropdown,
  closeDropdown,
  onAddStep,
  onRemoveStep,
  getAnalyzeColumns,
  getAnalyzeSchema,
  getAnalyzeOutputSchema,
  getAnalyzeValidationError,
  onStepConfigChange,
  runStepRowCounts,
  onInstantiateShape,
}: PipelineRiverViewProps) {
  // Only one add-step trigger is mounted at a time (empty-state XOR list), so a
  // single ref anchors the portalled OpDropdown to whichever button is showing.
  const addStepButtonRef = useRef<HTMLButtonElement>(null);
  const [shapePickerOpen, setShapePickerOpen] = useState(false);

  return (
    <div className="pipeline-detail-page__river">
      <div className="pipeline-detail-page__river-inner">
        {steps.length === 0 ? (
          <div className="pipeline-detail-page__empty-state">
            <p className="pipeline-detail-page__empty-state-text">
              Add your first transformation step
            </p>
            <div className="pipeline-detail-page__empty-state-actions">
              <button
                ref={addStepButtonRef}
                type="button"
                className="pipeline-detail-page__add-step-btn"
                onClick={openDropdown}
              >
                + Add step
              </button>
              <button
                type="button"
                className="pipeline-detail-page__shape-picker-btn"
                onClick={() => setShapePickerOpen(true)}
              >
                Start from a shape
              </button>
            </div>
            {dropdownOpen && (
              <OpDropdown
                anchorRef={addStepButtonRef}
                onSelect={onAddStep}
                onClose={closeDropdown}
              />
            )}
          </div>
        ) : (
          <>
            <RibbonSegment />
            {steps.map((step, idx) => (
              <div key={step.id} className="pipeline-detail-page__step-section">
                <StepCard
                  step={step}
                  pipelineId={pipelineId}
                  onRemove={onRemoveStep}
                  analyzeColumns={getAnalyzeColumns(step.id)}
                  analyzeSchema={getAnalyzeSchema(step.id)}
                  analyzeOutputSchema={getAnalyzeOutputSchema(step.id)}
                  validationError={getAnalyzeValidationError(step.id)}
                  onConfigChange={onStepConfigChange}
                  rowCount={runStepRowCounts?.[step.id] ?? null}
                />
                {idx < steps.length - 1 && <RibbonSegment />}
              </div>
            ))}
            <div className="pipeline-detail-page__add-step-row">
              <button
                ref={addStepButtonRef}
                type="button"
                className="pipeline-detail-page__add-step-dashed-btn"
                onClick={openDropdown}
              >
                + Add transformation step
              </button>
              <button
                type="button"
                className="pipeline-detail-page__shape-picker-btn pipeline-detail-page__shape-picker-btn--dashed"
                onClick={() => setShapePickerOpen(true)}
              >
                Start from a shape
              </button>
              {dropdownOpen && (
                <OpDropdown
                  anchorRef={addStepButtonRef}
                  onSelect={onAddStep}
                  onClose={closeDropdown}
                />
              )}
            </div>
          </>
        )}
      </div>

      {shapePickerOpen && (
        <ShapePickerModal
          onClose={() => setShapePickerOpen(false)}
          onSeedSteps={onInstantiateShape}
        />
      )}
    </div>
  );
}
