// PipelineRiverView — the central "river" canvas of the PipelineDetailPage
// that lists each StepCard with ribbon segments between them, plus the
// add-step controls (empty-state CTA when no steps; dashed "+ Add" button
// otherwise). Extracted from PipelineDetailPage.tsx in CS3 cycle 2 to keep
// the parent under the 400L hard cap.

import { Fragment, useRef, useState } from "react";
import type { DragEvent } from "react";

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
  /** HEL-407 — invoked with the full reordered `Step[]` on drop or a Move
   *  up/down click; `PipelineDetailPage.handleReorderSteps` owns persistence
   *  + reconciliation (design.md Decision 7). */
  onReorderSteps: (newOrder: Step[]) => void;
}

/** Returns a copy of `items` with the element at `fromIndex` moved to end up
 *  at `toIndex` (HEL-407). Pure — shared by the drag-drop handler and the
 *  Move up/down buttons so both paths compute a reorder the same way. */
function moveStep<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
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
  onReorderSteps,
}: PipelineRiverViewProps) {
  // Only one add-step trigger is mounted at a time (empty-state XOR list), so a
  // single ref anchors the portalled OpDropdown to whichever button is showing.
  const addStepButtonRef = useRef<HTMLButtonElement>(null);
  const [shapePickerOpen, setShapePickerOpen] = useState(false);

  // HEL-407 — drag-reorder state (design.md Decision 5): `draggedIndex` is
  // set by the StepCard drag handle (the sole `draggable` element) via
  // `onStepDragStart`; `overIndex` is the index of the card currently
  // dragged over, i.e. the slot the dragged step would land in on drop. The
  // drop-indicator line renders above the card at `overIndex`.
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  function handleStepDragStart(index: number) {
    setDraggedIndex(index);
  }

  function handleStepDragEnd() {
    setDraggedIndex(null);
    setOverIndex(null);
  }

  function handleCardDragOver(e: DragEvent<HTMLDivElement>, index: number) {
    if (draggedIndex === null) return;
    e.preventDefault();
    setOverIndex(index);
  }

  function handleCardDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (draggedIndex !== null && overIndex !== null && overIndex !== draggedIndex) {
      // `overIndex` is the hovered card's index in the *original* (pre-move)
      // array — the drop-indicator line renders above that card, meaning
      // "insert here." `moveStep`'s `toIndex` wants the dragged item's
      // *final* resting index instead: removing the dragged item shifts
      // every later index down by one, so for a downward drag
      // (draggedIndex < overIndex) the final index is one less than the
      // hovered index. Upward drags need no adjustment — nothing before the
      // dragged item's original position shifts. (CR1, evaluation-1.md.)
      const targetIndex = draggedIndex < overIndex ? overIndex - 1 : overIndex;
      onReorderSteps(moveStep(steps, draggedIndex, targetIndex));
    }
    setDraggedIndex(null);
    setOverIndex(null);
  }

  function handleMoveUp(index: number) {
    if (index === 0) return;
    onReorderSteps(moveStep(steps, index, index - 1));
  }

  function handleMoveDown(index: number) {
    if (index === steps.length - 1) return;
    onReorderSteps(moveStep(steps, index, index + 1));
  }

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
              <Fragment key={step.id}>
                {draggedIndex !== null && overIndex === idx && (
                  <div className="pipeline-detail-page__drop-indicator" aria-hidden="true" />
                )}
                <div
                  className="pipeline-detail-page__step-section"
                  onDragOver={(e) => handleCardDragOver(e, idx)}
                  onDrop={handleCardDrop}
                >
                  <StepCard
                    step={step}
                    stepIndex={idx}
                    pipelineId={pipelineId}
                    onRemove={onRemoveStep}
                    analyzeColumns={getAnalyzeColumns(step.id)}
                    analyzeSchema={getAnalyzeSchema(step.id)}
                    analyzeOutputSchema={getAnalyzeOutputSchema(step.id)}
                    validationError={getAnalyzeValidationError(step.id)}
                    onConfigChange={onStepConfigChange}
                    rowCount={runStepRowCounts?.[step.id] ?? null}
                    onStepDragStart={handleStepDragStart}
                    onStepDragEnd={handleStepDragEnd}
                    onMoveUp={idx > 0 ? () => handleMoveUp(idx) : undefined}
                    onMoveDown={idx < steps.length - 1 ? () => handleMoveDown(idx) : undefined}
                  />
                  {idx < steps.length - 1 && <RibbonSegment />}
                </div>
              </Fragment>
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
