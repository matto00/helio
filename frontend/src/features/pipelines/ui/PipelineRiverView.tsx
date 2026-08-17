// PipelineRiverView — the central "river" canvas of the PipelineDetailPage
// that lists each StepCard with ribbon segments between them, plus the
// add-step controls (empty-state CTA when no steps; dashed "+ Add" button
// otherwise). Extracted from PipelineDetailPage.tsx in CS3 cycle 2 to keep
// the parent under the 400L hard cap.

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCodeBranch, faPlus } from "@fortawesome/free-solid-svg-icons";

import { OpDropdown } from "./OpDropdown";
import { RibbonSegment } from "./RibbonSegment";
import { ShapePickerModal } from "./ShapePickerModal";
import { StepCard } from "./StepCard";
import { EmptyState } from "../../../shared/ui/EmptyState";
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
  /** HEL-410 — invoked with the selected op and the list index to insert at
   *  (0 = before the first step); `PipelineDetailPage.handleInsertStep` owns
   *  the optimistic splice + persistence, mirroring `onAddStep`. */
  onInsertStep: (opType: OpType, index: number) => void;
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
  /** HEL-412 — persists the disable/enable toggle for one step;
   *  `PipelineDetailPage.handleToggleStepEnabled` owns the optimistic flip +
   *  revert-on-failure convention. */
  onToggleStepEnabled: (stepId: string, enabled: boolean) => void;
  /** HEL-412 — invokes the duplicate endpoint for one step;
   *  `PipelineDetailPage.handleDuplicateStep` owns splicing the clone in
   *  after the original. */
  onDuplicateStep: (stepId: string) => void;
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
  onInsertStep,
  onRemoveStep,
  getAnalyzeColumns,
  getAnalyzeSchema,
  getAnalyzeOutputSchema,
  getAnalyzeValidationError,
  onStepConfigChange,
  runStepRowCounts,
  onInstantiateShape,
  onReorderSteps,
  onToggleStepEnabled,
  onDuplicateStep,
}: PipelineRiverViewProps) {
  // Only one add-step trigger is mounted at a time (empty-state XOR list), so a
  // single ref anchors the portalled OpDropdown to whichever button is showing.
  const addStepButtonRef = useRef<HTMLButtonElement>(null);
  const [shapePickerOpen, setShapePickerOpen] = useState(false);

  // F-146 — lets `handleMoveUp`/`handleMoveDown` below read the current
  // `steps` without closing over the prop directly, so they stay stable
  // (`useCallback` identity unchanged) across the renders that change
  // `steps` most often — editing one step's config re-renders this
  // component with a new `steps` array on every keystroke. A
  // `useCallback([..., steps])` dependency would get a new identity on
  // exactly those renders, which — since these are `StepCard` props —
  // would keep every *other*, unrelated `StepCard` re-rendering via
  // `React.memo`'s prop comparison (see `StepCard.tsx`).
  const stepsRef = useRef(steps);
  // eslint-plugin-react-hooks@7's react-hooks/refs rule forbids writing a ref
  // during render (the assignment used to sit right here) — commit it in an
  // effect instead. Still runs before any event handler can read it, and the
  // whole point of this ref is to be read outside render (see above).
  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  // HEL-410 — gap "insert step here" affordance (design.md Decision 5): one
  // compact "+" button per gap (before the first card + between each pair;
  // after-last stays the existing add row). The gap count is dynamic, so
  // (unlike `addStepButtonRef` above) a single fixed `useRef` anchor can't
  // work — but reading a ref's `.current` during render is disallowed
  // (react-hooks/refs). `insertAnchorEl` is STATE instead, set from the
  // click event's `currentTarget` (available synchronously in the handler,
  // not during render) and read freely during render like any other state.
  const [insertDropdownAt, setInsertDropdownAt] = useState<number | null>(null);
  const [insertAnchorEl, setInsertAnchorEl] = useState<HTMLButtonElement | null>(null);

  function openBottomDropdown() {
    // Only one dropdown open at a time — opening the add-row picker closes
    // any open gap picker.
    setInsertDropdownAt(null);
    openDropdown();
  }

  function openGapDropdown(index: number, anchorEl: HTMLButtonElement) {
    // Only one dropdown open at a time — opening a gap picker closes the
    // add-row picker.
    closeDropdown();
    setInsertDropdownAt(index);
    setInsertAnchorEl(anchorEl);
  }

  // HEL-407 — drag-reorder state (design.md Decision 5): `draggedIndex` is
  // set by the StepCard drag handle (the sole `draggable` element) via
  // `onStepDragStart`; `overIndex` is the index of the card currently
  // dragged over, i.e. the slot the dragged step would land in on drop. The
  // drop-indicator line renders above the card at `overIndex`.
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  // F-146 — `StepCard` props; `useCallback` with empty deps (both close only
  // over the stable `useState` setters) so every `StepCard` gets the same
  // reference every render, not a fresh closure — a precondition for
  // `React.memo` to skip re-rendering the cards a given edit didn't touch.
  const handleStepDragStart = useCallback((index: number) => {
    setDraggedIndex(index);
  }, []);

  const handleStepDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setOverIndex(null);
  }, []);

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

  // F-146 — hoisted out of the per-item `idx > 0 ? () => handleMoveUp(idx) :
  // undefined` closures the JSX below used to build fresh on every render
  // for every step: two stable, id-keyed callbacks instead (reading the
  // step's position from `stepsRef` rather than taking an `index` argument,
  // so the JSX can pass the *function itself* as `StepCard`'s `onMoveUp`/
  // `onMoveDown` prop — see the mapping below — instead of allocating a new
  // wrapper arrow per card per render). `onReorderSteps` is itself stable
  // (`PipelineDetailPage.handleReorderSteps` is `useCallback`-wrapped), so
  // these only change identity when it does (i.e. a different pipeline).
  const handleMoveUp = useCallback(
    (stepId: string) => {
      const currentSteps = stepsRef.current;
      const index = currentSteps.findIndex((s) => s.id === stepId);
      if (index <= 0) return;
      onReorderSteps(moveStep(currentSteps, index, index - 1));
    },
    [onReorderSteps],
  );

  const handleMoveDown = useCallback(
    (stepId: string) => {
      const currentSteps = stepsRef.current;
      const index = currentSteps.findIndex((s) => s.id === stepId);
      if (index === -1 || index >= currentSteps.length - 1) return;
      onReorderSteps(moveStep(currentSteps, index, index + 1));
    },
    [onReorderSteps],
  );

  // HEL-412 (design.md Decision 8) — one bit per step, same string passed to
  // every StepCard's preview fingerprint: any toggle anywhere refreshes
  // every open preview tray.
  const enabledBits = steps.map((s) => (s.enabled ? "1" : "0")).join("");

  // HEL-410 — one gap per list index (0 = before the first step; gap `i` sits
  // between step `i-1` and step `i`). Wraps the existing `RibbonSegment` so
  // the connecting-ribbon visual is unchanged; the insert button is
  // absolutely positioned over it (token-only CSS) and does not affect the
  // drop-indicator, which is a separate sibling rendered only while dragging.
  function renderGap(index: number) {
    return (
      <div className="pipeline-detail-page__gap" key={`gap-${index}`}>
        <RibbonSegment />
        <button
          type="button"
          className="pipeline-detail-page__gap-insert-btn"
          aria-label="Insert step here"
          onClick={(e) => openGapDropdown(index, e.currentTarget)}
        >
          <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
        </button>
        {insertDropdownAt === index && (
          <OpDropdown
            anchorRef={{ current: insertAnchorEl }}
            onSelect={(opType) => onInsertStep(opType, index)}
            onClose={() => setInsertDropdownAt(null)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="pipeline-detail-page__river">
      <div className="pipeline-detail-page__river-inner">
        {steps.length === 0 ? (
          <div className="pipeline-detail-page__empty-state">
            {/* HEL sweep F-132/F-159: was a bare <p>; now the shared EmptyState
             * primitive (icon + title + description). `variant="sidebar"`
             * because this sits inside an already chrome-heavy detail page
             * (source/type/schedule bars + footer are all visible at once),
             * so the full `main`-variant hero would be heavier than
             * warranted — the two custom action buttons below stay
             * hand-rolled since EmptyState's `cta` prop only supports one. */}
            <EmptyState
              variant="sidebar"
              icon={faCodeBranch}
              title="No steps yet"
              description="Add your first transformation step to start shaping this pipeline's output."
            />
            <div className="pipeline-detail-page__empty-state-actions">
              <button
                ref={addStepButtonRef}
                type="button"
                className="pipeline-detail-page__add-step-btn"
                onClick={openBottomDropdown}
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
            {renderGap(0)}
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
                    onMoveUp={idx > 0 ? handleMoveUp : undefined}
                    onMoveDown={idx < steps.length - 1 ? handleMoveDown : undefined}
                    onToggleEnabled={onToggleStepEnabled}
                    onDuplicate={onDuplicateStep}
                    enabledBits={enabledBits}
                  />
                  {idx < steps.length - 1 && renderGap(idx + 1)}
                </div>
              </Fragment>
            ))}
            <div className="pipeline-detail-page__add-step-row">
              <button
                ref={addStepButtonRef}
                type="button"
                className="pipeline-detail-page__add-step-dashed-btn"
                onClick={openBottomDropdown}
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
