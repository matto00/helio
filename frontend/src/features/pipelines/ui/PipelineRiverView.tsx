// PipelineRiverView — the central "river" canvas of the PipelineDetailPage
// that lists each StepCard with ribbon segments between them, plus the
// add-step controls (empty-state CTA when no steps; dashed "+ Add" button
// otherwise). Extracted from PipelineDetailPage.tsx in CS3 cycle 2 to keep
// the parent under the 400L hard cap.
//
// HEL-912 — generalizes the trunk/at-most-one-tail model to n lanes
// (design.md Decision 1): the primary lane (the lane rooted at the
// pipeline's root step) renders here as before (full StepCards, drag
// reorder, Move up/down); every OTHER lane rooted off a primary-lane step
// renders via `LaneColumn`, side by side when a step roots more than one.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCodeBranch, faPlus } from "@fortawesome/free-solid-svg-icons";

import { BranchAffordance } from "./BranchAffordance";
import { OpDropdown } from "./OpDropdown";
import { RibbonSegment } from "./RibbonSegment";
import { ShapePickerModal } from "./shapes/ShapePickerModal";
import { StepCard } from "./StepCard";
import { LaneColumn } from "./LaneColumn";
import { RootColumn } from "./RootColumn";
import { AddRootModal } from "./AddRootModal";
import { EmptyState } from "../../../shared/ui/EmptyState";
import type { OpType, Step } from "../types/step";
import type { PipelineRoot, PipelineStepConfig, SchemaField } from "../types/pipelineStep";
import type { ExpandPipelineShapeResponse } from "../types/pipelineShape";
import type { Output } from "../types/output";
import type { LaneGraph } from "../state/stepTree";
import { childLanesOf, reorderLane } from "../state/stepTree";
import { nodePath } from "../state/nodePath";

// task 3.3 — mirrors `EMPTY_ANALYZE_COLUMNS` in `usePipelineDetailPage.ts`: a
// step with zero Outputs gets the same stable `[]` reference on every
// lookup, not a fresh array per render (a precondition for `StepCard`'s
// `React.memo` to actually skip re-rendering unrelated cards -- see F-146).
const EMPTY_OUTPUTS: Output[] = [];

interface PipelineRiverViewProps {
  steps: Step[];
  /** HEL-912 task 1.1 — n-lane grouping (design.md decision 1); the main
   *  list below maps the PRIMARY lane's steps, not `steps`, so every other
   *  lane is rendered via `LaneColumn` nested under the step it branches
   *  off of instead of as flat top-level cards. */
  laneGraph: LaneGraph;
  /** HEL-968 task 6 — one column head per root, in `position` order. Root 0
   *  keeps the rich top-level treatment below (drag reorder, gap-insert,
   *  Move up/down) -- R3 SANCTIONS UI privileging position 0 the same way
   *  engine-contract item 2 already does for lanes; no root is styled or
   *  labelled as PRIMARY (task 6.3), it's simply the one rendered inline
   *  rather than as a sibling `RootColumn`. Roots[1..] render via
   *  `RootColumn`, side by side with root 0's river. */
  roots: PipelineRoot[];
  /** HEL-968 task 8 — "+ root": either an existing source's id or a source
   *  just created via the nested `AddSourceModal` composition. */
  onAddRoot: (sourceId: string) => void;
  /** HEL-968 task 9 — root removal (R7); the confirmation + refusal
   *  rendering live in the caller (`usePipelineDetailPage.handleRemoveRoot`). */
  onRemoveRoot: (rootId: string) => void;
  pipelineId: string;
  dropdownOpen: boolean;
  openDropdown: () => void;
  closeDropdown: () => void;
  onAddStep: (opType: OpType) => void;
  /** HEL-410 — invoked with the selected op and the list index to insert at
   *  (0 = before the first step); `PipelineDetailPage.handleInsertStep` owns
   *  the optimistic splice + persistence, mirroring `onAddStep`. */
  onInsertStep: (opType: OpType, index: number) => void;
  /** HEL-912 task 4 — "+ lane" create affordance: attaches a new step as a
   *  genuine branch off `parentStepId` via the backend's `attachTailInternal`
   *  primitive, unconditionally offered on every step now (design.md
   *  Decision 1 removed the single-tail-per-node gate). */
  onAddLaneStep: (opType: OpType, parentStepId: string) => void;
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
  /** task 3.3 — one Outputs array per step id, from
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
  laneGraph,
  roots,
  onAddRoot,
  onRemoveRoot,
  pipelineId,
  dropdownOpen,
  openDropdown,
  closeDropdown,
  onAddStep,
  onInsertStep,
  onAddLaneStep,
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
  // HEL-968 task 8 — "+ root" modal open state.
  const [addRootOpen, setAddRootOpen] = useState(false);
  // HEL-908 task 6.1 — "Add Outputs from a shape" targets a chosen anchor
  // node: `undefined` for the empty-state trigger (seeds a new primary
  // lane), the last primary-lane step's id for the bottom-of-list trigger
  // (always a leaf, so `handleInstantiateShape` resolves it to plain
  // primary-lane continuation).
  const [shapePickerAnchorStepId, setShapePickerAnchorStepId] = useState<string | undefined>(
    undefined,
  );

  // HEL-968: "the primary lane" is now root 0's own root-level lane, not a
  // retired single-pipeline `primaryLaneId` -- root 0 is the one root this
  // component still gives the rich top-level treatment to (R3 sanctions UI
  // privileging position 0; it grants root 0 no different data/ACL/lifecycle).
  const firstRootId = roots[0]?.id;
  const primaryLane = laneGraph.lanes.find(
    (l) => l.parentStepId === undefined && l.rootId === firstRootId,
  );
  const primarySteps = primaryLane?.steps ?? [];

  // F-146/HEL-912 — lets `handleMoveUp`/`handleMoveDown`/`handleCardDrop`
  // below read the current `laneGraph` without closing over the prop
  // directly, so they stay stable (`useCallback` identity unchanged) across
  // the renders that change `steps`/`laneGraph` most often — editing one
  // step's config re-renders this component with new arrays on every
  // keystroke.
  const laneGraphRef = useRef(laneGraph);
  // eslint-plugin-react-hooks@7's react-hooks/refs rule forbids writing a ref
  // during render — commit it in an effect instead.
  useEffect(() => {
    laneGraphRef.current = laneGraph;
  }, [laneGraph]);

  // HEL-410 — gap "insert step here" affordance (design.md Decision 5): one
  // compact "+" button per gap (before the first card + between each pair;
  // after-last stays the existing add row).
  const [insertDropdownAt, setInsertDropdownAt] = useState<number | null>(null);
  const [insertAnchorEl, setInsertAnchorEl] = useState<HTMLButtonElement | null>(null);

  // HEL-912 — "+ lane" create affordance, keyed by step id.
  const [laneDropdownForStepId, setLaneDropdownForStepId] = useState<string | null>(null);
  const [laneAnchorEl, setLaneAnchorEl] = useState<HTMLButtonElement | null>(null);

  function openLaneDropdown(stepId: string, anchorEl: HTMLButtonElement) {
    closeDropdown();
    setInsertDropdownAt(null);
    setLaneDropdownForStepId(stepId);
    setLaneAnchorEl(anchorEl);
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
  // drop-indicator line renders above the card at `overIndex`. Both are
  // PRIMARY-lane-relative indices.
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

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
      const targetIndex = draggedIndex < overIndex ? overIndex - 1 : overIndex;
      const currentGraph = laneGraphRef.current;
      const primaryId = currentGraph.lanes.find(
        (l) => l.parentStepId === undefined && l.rootId === firstRootId,
      )?.id;
      if (primaryId) {
        onReorderSteps(reorderLane(currentGraph, primaryId, draggedIndex, targetIndex));
      }
    }
    setDraggedIndex(null);
    setOverIndex(null);
  }

  const handleMoveUp = useCallback(
    (stepId: string) => {
      const currentGraph = laneGraphRef.current;
      const lane = currentGraph.lanes.find(
        (l) => l.parentStepId === undefined && l.rootId === firstRootId,
      );
      if (!lane) return;
      const index = lane.steps.findIndex((s) => s.id === stepId);
      if (index <= 0) return;
      onReorderSteps(reorderLane(currentGraph, lane.id, index, index - 1));
    },
    [onReorderSteps, firstRootId],
  );

  const handleMoveDown = useCallback(
    (stepId: string) => {
      const currentGraph = laneGraphRef.current;
      const lane = currentGraph.lanes.find(
        (l) => l.parentStepId === undefined && l.rootId === firstRootId,
      );
      if (!lane) return;
      const index = lane.steps.findIndex((s) => s.id === stepId);
      if (index === -1 || index >= lane.steps.length - 1) return;
      onReorderSteps(reorderLane(currentGraph, lane.id, index, index + 1));
    },
    [onReorderSteps, firstRootId],
  );

  // HEL-412 (design.md Decision 8) — one bit per step, same string passed to
  // every StepCard's preview fingerprint: any toggle anywhere refreshes
  // every open preview tray.
  const enabledBits = steps.map((s) => (s.enabled ? "1" : "0")).join("");

  // HEL-968 D3/task 5.3 — the R5 runtime graph path for every step, computed
  // once here and threaded down as a plain lookup (mirrors `outputsByStepId`'s
  // existing convention) rather than recomputed per render site. Rendered as
  // each step card's `title` (a native hover tooltip) -- the one exported
  // `nodePath` function is what makes this the ONLY place a path is
  // constructed, so "not the stale single-root form" (AC3) stays a
  // single-call-site guarantee, not a per-site promise.
  const nodePathByStepId = useMemo(() => {
    const entries: Record<string, string> = {};
    for (const step of steps) entries[step.id] = nodePath(step.id, steps, roots);
    return entries;
  }, [steps, roots]);

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

  // HEL-968 task 6 — every root past root 0, in `position` order (root 0
  // keeps the top-level treatment rendered inline below). No root here is
  // styled/labelled as primary (R3/task 6.3) -- root 0 is simply the one
  // this component happens to render inline rather than via `RootColumn`.
  const extraRoots = roots.slice(1);

  return (
    <div className="pipeline-detail-page__river">
      <div className="pipeline-detail-page__root-columns">
        <div className="pipeline-detail-page__river-inner">
          {steps.length === 0 ? (
            <div className="pipeline-detail-page__empty-state">
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
              {primarySteps.map((step, idx) => {
                const childLanes = childLanesOf(laneGraph, step.id);
                return (
                  <Fragment key={step.id}>
                    {draggedIndex !== null && overIndex === idx && (
                      <div className="pipeline-detail-page__drop-indicator" aria-hidden="true" />
                    )}
                    <div
                      className="pipeline-detail-page__step-section"
                      onDragOver={(e) => handleCardDragOver(e, idx)}
                      onDrop={handleCardDrop}
                      title={nodePathByStepId[step.id]}
                    >
                      <StepCard
                        step={step}
                        allSteps={steps}
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
                        onMoveDown={idx < primarySteps.length - 1 ? handleMoveDown : undefined}
                        onToggleEnabled={onToggleStepEnabled}
                        onDuplicate={onDuplicateStep}
                        enabledBits={enabledBits}
                        outputs={outputsByStepId[step.id] ?? EMPTY_OUTPUTS}
                        previewRowCountByOutputId={previewRowCountByOutputId}
                        onOpenOutput={onOpenOutput}
                        onAddOutput={onAddOutput}
                      />
                      {/* HEL-912 — "+ lane" affordance, unconditional now
                       * (design.md Decision 1 removed the single-tail gate;
                       * a step may root any number of lanes, not just one).
                       * HEL-943 — labelled by outcome ("Branch this step" /
                       * "into a new lane"), not internal vocabulary.
                       * evaluation-1.md issue 8 — shared
                       * `BranchAffordance` (also used by `LaneColumn`), this
                       * component owns its OWN dropdown-coordination (closing
                       * the gap/bottom-add pickers) around it. */}
                      <BranchAffordance
                        isOpen={laneDropdownForStepId === step.id}
                        anchorEl={laneAnchorEl}
                        onOpen={(anchorEl) => openLaneDropdown(step.id, anchorEl)}
                        onSelect={(opType) => {
                          onAddLaneStep(opType, step.id);
                          setLaneDropdownForStepId(null);
                        }}
                        onClose={() => setLaneDropdownForStepId(null)}
                      />
                      {/* HEL-912 task 3/7 — every child lane rooted at this
                       * primary-lane step renders side by side (a flex row
                       * that stacks per DESIGN.md's phone breakpoint, task
                       * 7.1); a one-step lane keeps its P1.5 compact
                       * rendering. */}
                      {childLanes.length > 0 && (
                        <div
                          className="pipeline-detail-page__lane-row"
                          role="group"
                          aria-label="Lanes"
                        >
                          {childLanes.map((childLane, index) => (
                            <LaneColumn
                              key={childLane.id}
                              laneNumber={index + 1}
                              lane={childLane}
                              laneGraph={laneGraph}
                              allSteps={steps}
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
                              onAddLaneStep={onAddLaneStep}
                              isCompact={childLane.steps.length === 1}
                              nodePathByStepId={nodePathByStepId}
                            />
                          ))}
                        </div>
                      )}
                      {idx < primarySteps.length - 1 && renderGap(idx + 1)}
                    </div>
                  </Fragment>
                );
              })}
              <div className="pipeline-detail-page__add-step-row">
                <button
                  ref={addStepButtonRef}
                  type="button"
                  className="pipeline-detail-page__add-step-dashed-btn"
                  onClick={openBottomDropdown}
                >
                  + Add transformation step
                </button>
                {/* HEL-912 (design.md Decision 1) — the `trunkLastHasTail`
                 * disable this used to have relied on the single-tail
                 * invariant, which is gone: a shape's first step landing as
                 * another child of the primary-lane's last step is just a new
                 * lane now, not a dead branch. */}
                <button
                  type="button"
                  className="pipeline-detail-page__shape-picker-btn pipeline-detail-page__shape-picker-btn--dashed"
                  onClick={() => {
                    setShapePickerAnchorStepId(primarySteps[primarySteps.length - 1]?.id);
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

        {/* HEL-968 task 6 — every root past root 0 renders as its own column,
         * side by side with root 0's river above (D6 -- the same responsive
         * column primitive HEL-912 already made mobile-safe). */}
        {extraRoots.map((root) => {
          const rootLane = laneGraph.lanes.find(
            (l) => l.rootId === root.id && l.parentStepId === undefined,
          );
          return (
            <RootColumn
              key={root.id}
              root={root}
              lane={rootLane}
              laneGraph={laneGraph}
              allSteps={steps}
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
              onAddLaneStep={onAddLaneStep}
              onRemoveRoot={onRemoveRoot}
              canRemove={roots.length > 1}
              nodePathByStepId={nodePathByStepId}
            />
          );
        })}

        {/* HEL-968 task 8 — "+ root" (D4): always offered, mirroring
         * `CreatePipelineModal`'s inline-source composition. */}
        <div className="pipeline-detail-page__root-column pipeline-detail-page__root-column--add">
          <button
            type="button"
            className="pipeline-detail-page__add-root-btn"
            onClick={() => setAddRootOpen(true)}
          >
            + Add root
          </button>
        </div>
      </div>

      {shapePickerOpen && (
        <ShapePickerModal
          anchorStepId={shapePickerAnchorStepId}
          onClose={() => setShapePickerOpen(false)}
          onSeedSteps={onInstantiateShape}
        />
      )}

      {addRootOpen && (
        <AddRootModal
          onClose={() => setAddRootOpen(false)}
          onAdd={(sourceId) => {
            onAddRoot(sourceId);
            setAddRootOpen(false);
          }}
        />
      )}
    </div>
  );
}
