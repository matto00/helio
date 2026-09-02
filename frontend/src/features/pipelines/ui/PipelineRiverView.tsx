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
import { ShapePickerModal } from "./shapes/ShapePickerModal";
import { StepCard } from "./StepCard";
import { TailChain } from "./TailChain";
import { EmptyState } from "../../../shared/ui/EmptyState";
import type { OpType, Step } from "../types/step";
import type { PipelineStepConfig, SchemaField } from "../types/pipelineStep";
import type { ExpandPipelineShapeResponse } from "../types/pipelineShape";
import type { Output } from "../types/output";
import type { StepTree } from "../state/stepTree";
import { reorderTrunk } from "../state/stepTree";

// task 3.3 — mirrors `EMPTY_ANALYZE_COLUMNS` in `usePipelineDetailPage.ts`: a
// step with zero Outputs gets the same stable `[]` reference on every
// lookup, not a fresh array per render (a precondition for `StepCard`'s
// `React.memo` to actually skip re-rendering unrelated cards -- see F-146).
const EMPTY_OUTPUTS: Output[] = [];
// HEL-908 task 3.4 — same stable-reference precedent, for a trunk step with
// no tail (`TailChain` early-returns `null` on an empty array either way,
// but a fresh `[]` per render would still be a fresh prop reference).
const EMPTY_TAIL_STEPS: Step[] = [];

interface PipelineRiverViewProps {
  steps: Step[];
  /** HEL-908 task 3.4 — trunk/tail grouping (design.md decision 1); the
   *  main list below maps `stepTree.trunk`, not `steps`, so tail steps are
   *  rendered via `TailChain` nested under their trunk node instead of as
   *  flat top-level cards. */
  stepTree: StepTree;
  pipelineId: string;
  dropdownOpen: boolean;
  openDropdown: () => void;
  closeDropdown: () => void;
  onAddStep: (opType: OpType) => void;
  /** HEL-410 — invoked with the selected op and the list index to insert at
   *  (0 = before the first step); `PipelineDetailPage.handleInsertStep` owns
   *  the optimistic splice + persistence, mirroring `onAddStep`. */
  onInsertStep: (opType: OpType, index: number) => void;
  /** HEL-908 tasks 3.4/5.6 — "+ tail" create affordance: attaches a new step as a
   *  genuine branch off `parentStepId` via the backend's `attachTailInternal`
   *  primitive (design.md's non-goal waiver). See `usePipelineDetailPage.
   *  handleAddTailStep`. */
  onAddTailStep: (opType: OpType, parentStepId: string) => void;
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
  onInstantiateShape: (
    expansion: ExpandPipelineShapeResponse,
    anchorStepId?: string,
  ) => Promise<void>;
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
  /** task 3.3 — one Outputs array per trunk/tail step id, from
   *  `selectOutputsByStepId`; feeds each `StepCard`'s `OutputsRail`. */
  outputsByStepId: Record<string, Output[]>;
  /** task 3.3 — live-thumbnail row counts keyed by `outputId`, from the
   *  shared preview cache (`selectPreviewRowCountByOutputId`). */
  previewRowCountByOutputId: Record<string, number>;
  onOpenOutput: (output: Output) => void;
  onAddOutput: (stepId: string) => void;
}

export function PipelineRiverView({
  steps,
  stepTree,
  pipelineId,
  dropdownOpen,
  openDropdown,
  closeDropdown,
  onAddStep,
  onInsertStep,
  onAddTailStep,
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
  outputsByStepId,
  previewRowCountByOutputId,
  onOpenOutput,
  onAddOutput,
}: PipelineRiverViewProps) {
  // Only one add-step trigger is mounted at a time (empty-state XOR list), so a
  // single ref anchors the portalled OpDropdown to whichever button is showing.
  const addStepButtonRef = useRef<HTMLButtonElement>(null);
  const [shapePickerOpen, setShapePickerOpen] = useState(false);
  // HEL-908 task 6.1 — "Add Outputs from a shape" targets a chosen anchor
  // node: `undefined` for the empty-state trigger (seeds a new trunk), the
  // last trunk step's id for the bottom-of-list trigger (always a leaf, so
  // `handleInstantiateShape` resolves it to plain trunk-continuation).
  const [shapePickerAnchorStepId, setShapePickerAnchorStepId] = useState<string | undefined>(
    undefined,
  );

  // F-146/HEL-908 — lets `handleMoveUp`/`handleMoveDown`/`handleCardDrop`
  // below read the current `stepTree` without closing over the prop
  // directly, so they stay stable (`useCallback` identity unchanged) across
  // the renders that change `steps`/`stepTree` most often — editing one
  // step's config re-renders this component with new arrays on every
  // keystroke. A `useCallback([..., stepTree])` dependency would get a new
  // identity on exactly those renders, which — since these are `StepCard`
  // props — would keep every *other*, unrelated `StepCard` re-rendering via
  // `React.memo`'s prop comparison (see `StepCard.tsx`). Reorder handlers
  // need TRUNK-relative indices (see `reorderTrunk` in state/stepTree.ts),
  // not flat-array indices, so this ref holds `stepTree`, not `steps`.
  const stepTreeRef = useRef(stepTree);
  // eslint-plugin-react-hooks@7's react-hooks/refs rule forbids writing a ref
  // during render (the assignment used to sit right here) — commit it in an
  // effect instead. Still runs before any event handler can read it, and the
  // whole point of this ref is to be read outside render (see above).
  useEffect(() => {
    stepTreeRef.current = stepTree;
  }, [stepTree]);

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

  // HEL-908 tasks 3.4/5.6 — "+ tail" create affordance, keyed by trunk step
  // id (same anchor-in-state pattern as the gap picker above, since the
  // trigger button is per-trunk-card, not a single fixed ref). Only one
  // dropdown open at a time, mirroring `openGapDropdown`/`openBottomDropdown`.
  const [tailDropdownForStepId, setTailDropdownForStepId] = useState<string | null>(null);
  const [tailAnchorEl, setTailAnchorEl] = useState<HTMLButtonElement | null>(null);

  function openTailDropdown(stepId: string, anchorEl: HTMLButtonElement) {
    closeDropdown();
    setInsertDropdownAt(null);
    setTailDropdownForStepId(stepId);
    setTailAnchorEl(anchorEl);
  }

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
      // HEL-908 — `draggedIndex`/`targetIndex` are TRUNK-relative (set from
      // `stepTree.trunk.map`'s own `idx`, see the JSX below); `reorderTrunk`
      // permutes the trunk and re-flattens with each node's tail (if any)
      // carried along by node id, not `moveStep(steps, ...)` on the flat
      // array (a real index mismatch the instant any tail exists — found
      // and fixed alongside design.md decision 15).
      onReorderSteps(reorderTrunk(stepTreeRef.current, draggedIndex, targetIndex));
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
      const currentTree = stepTreeRef.current;
      const index = currentTree.trunk.findIndex((s) => s.id === stepId);
      if (index <= 0) return;
      onReorderSteps(reorderTrunk(currentTree, index, index - 1));
    },
    [onReorderSteps],
  );

  const handleMoveDown = useCallback(
    (stepId: string) => {
      const currentTree = stepTreeRef.current;
      const index = currentTree.trunk.findIndex((s) => s.id === stepId);
      if (index === -1 || index >= currentTree.trunk.length - 1) return;
      onReorderSteps(reorderTrunk(currentTree, index, index + 1));
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

  // skeptic-final-2 (round 1) CR1 — the bottom "Add Outputs from a shape"
  // trigger always anchors on the trunk's LAST step (see the button below);
  // gate it on that anchor already having a tail so this can never again
  // silently create a second, dead tail branch (see
  // `usePipelineDetailPage.handleInstantiateShape`'s doc comment).
  const trunkLastStepId = stepTree.trunk[stepTree.trunk.length - 1]?.id;
  const trunkLastHasTail =
    trunkLastStepId !== undefined && Boolean(stepTree.tailsByStepId[trunkLastStepId]);

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
                onClick={() => {
                  setShapePickerAnchorStepId(undefined);
                  setShapePickerOpen(true);
                }}
              >
                Add Outputs from a shape
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
            {stepTree.trunk.map((step, idx) => (
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
                    onMoveDown={idx < stepTree.trunk.length - 1 ? handleMoveDown : undefined}
                    onToggleEnabled={onToggleStepEnabled}
                    onDuplicate={onDuplicateStep}
                    enabledBits={enabledBits}
                    outputs={outputsByStepId[step.id] ?? EMPTY_OUTPUTS}
                    previewRowCountByOutputId={previewRowCountByOutputId}
                    onOpenOutput={onOpenOutput}
                    onAddOutput={onAddOutput}
                  />
                  {/* HEL-908 tasks 3.4/5.6 — "+ tail" affordance: single-tail-per-node
                   * (design.md's Phase-1 invariant) enforced here by only rendering the
                   * button when this trunk node has NO existing tail yet
                   * (`stepTree.tailsByStepId[step.id]` absent). */}
                  {!stepTree.tailsByStepId[step.id] && (
                    <div className="pipeline-detail-page__add-tail-row">
                      <button
                        type="button"
                        className="pipeline-detail-page__add-tail-btn"
                        aria-label="Add tail step"
                        title="Add tail step"
                        onClick={(e) => openTailDropdown(step.id, e.currentTarget)}
                      >
                        <FontAwesomeIcon icon={faPlus} aria-hidden="true" /> tail
                      </button>
                      {tailDropdownForStepId === step.id && (
                        <OpDropdown
                          anchorRef={{ current: tailAnchorEl }}
                          onSelect={(opType) => {
                            onAddTailStep(opType, step.id);
                            setTailDropdownForStepId(null);
                          }}
                          onClose={() => setTailDropdownForStepId(null)}
                        />
                      )}
                    </div>
                  )}
                  {/* HEL-908 task 3.4 — nested beneath its trunk node, before
                   * the gap/ribbon to the NEXT trunk step, per design.md
                   * decision 1 ("each trunk step renders zero-or-one
                   * TailChain"). */}
                  <TailChain
                    steps={stepTree.tailsByStepId[step.id] ?? EMPTY_TAIL_STEPS}
                    pipelineId={pipelineId}
                    onRemove={onRemoveStep}
                    getAnalyzeColumns={getAnalyzeColumns}
                    getAnalyzeSchema={getAnalyzeSchema}
                    getAnalyzeOutputSchema={getAnalyzeOutputSchema}
                    getAnalyzeValidationError={getAnalyzeValidationError}
                    onConfigChange={onStepConfigChange}
                    runStepRowCounts={runStepRowCounts}
                    onToggleStepEnabled={onToggleStepEnabled}
                    onDuplicateStep={onDuplicateStep}
                    enabledBits={enabledBits}
                    outputsByStepId={outputsByStepId}
                    previewRowCountByOutputId={previewRowCountByOutputId}
                    onOpenOutput={onOpenOutput}
                    onAddOutput={onAddOutput}
                  />
                  {idx < stepTree.trunk.length - 1 && renderGap(idx + 1)}
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
              {/* skeptic-final-2 (round 1) CR1 — a shape's first step always
               * targets this trunk-last anchor with plain trunk-continuation
               * semantics (see `usePipelineDetailPage.handleInstantiateShape`);
               * an anchor that already has a tail can't legally accept
               * another one, so disable rather than let the handler create a
               * second, dead tail branch. */}
              <button
                type="button"
                className="pipeline-detail-page__shape-picker-btn pipeline-detail-page__shape-picker-btn--dashed"
                disabled={trunkLastHasTail}
                title={
                  trunkLastHasTail
                    ? "This step already has a tail branch — remove it, or add a plain step first, before adding a shape here."
                    : undefined
                }
                onClick={() => {
                  setShapePickerAnchorStepId(stepTree.trunk[stepTree.trunk.length - 1]?.id);
                  setShapePickerOpen(true);
                }}
              >
                Add Outputs from a shape
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
          anchorStepId={shapePickerAnchorStepId}
          onClose={() => setShapePickerOpen(false)}
          onSeedSteps={onInstantiateShape}
        />
      )}
    </div>
  );
}
