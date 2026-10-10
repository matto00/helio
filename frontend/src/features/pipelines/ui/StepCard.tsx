// StepCard — one expandable card per pipeline step on the PipelineDetailPage.
// Owns the header/actions chrome and delegates the op-specific editor
// (`StepOpEditor.tsx`) and the inline "preview data" panel state
// (`useStepCardPreview.ts`, HEL-682 split, task 3.2) to their own modules.

import React, { useId, useState } from "react";

import { useStepCardState } from "../hooks/useStepCardState";
import { useStepCardPreview } from "../hooks/useStepCardPreview";
import { InlineError } from "../../../shared/chrome/InlineError";
import { isTempStepId, renamesOf } from "../state/stepNarrowing";
import type { Step } from "../types/step";
import { StepOpEditor } from "./StepOpEditor";
import { StepSchemaDiffChips } from "./StepSchemaDiffChips";
import { OutputsRail } from "./OutputsRail";

import type { StepCardProps } from "./stepCardTypes";
import { StepCardHeader } from "./StepCardHeader";
import { StepCardWarnings } from "./StepCardWarnings";
import { StepCardPreviewTray } from "./StepCardPreviewTray";

// F-146 — rendered once per pipeline step, and every edit to any one step's
// config re-renders `PipelineDetailPage`/`PipelineRiverView` with a new
// `steps` array (one keystroke in one step's editor). Without `memo`, that
// re-render cascaded into every OTHER step's `StepCard` too — each
// re-running its own hooks, effects, and (for expanded/preview-open cards)
// full editor + preview markup for no reason. `PipelineDetailPage` and
// `PipelineRiverView` were the other half of this fix (HEL sweep F-146):
// they now hand down referentially-stable callbacks/arrays (`useCallback`,
// id-keyed `onMoveUp`/`onMoveDown`, a memoized `analyzeByStepId` map) so
// `memo`'s shallow prop comparison actually holds for the steps an edit
// didn't touch, instead of every prop being a fresh reference every render
// regardless of this wrapper.
const EMPTY_ALL_STEPS: Step[] = [];

export const StepCard = React.memo(function StepCard({
  step,
  allSteps = EMPTY_ALL_STEPS,
  isOwner = true,
  stepIndex,
  pipelineId,
  onRemove,
  analyzeColumns,
  analyzeSchema,
  analyzeOutputSchema,
  hasOwnAnalyze = true,
  validationError,
  warnings,
  onConfigChange,
  rowCount,
  onStepDragStart,
  onStepDragEnd,
  onMoveUp,
  onMoveDown,
  laneLabel,
  reorderable = true,
  onToggleEnabled,
  onDuplicate,
  isDuplicating,
  enabledBits,
  outputs,
  previewRowCountByOutputId,
  onOpenOutput,
  onAddOutput,
  isTail = false,
  estimatedRows,
  draftError,
  isCreating = false,
}: StepCardProps) {
  // HEL-1109 (design.md D6, pipeline-ai-step-authoring spec) — a step still
  // carrying its `makeStep`-minted temp id has no server-side representation
  // yet. Uses the single `isTempStepId` source of truth (evaluation-1.md
  // CR3) so a semantic test-fixture id like "step-rename-1" is never
  // mistaken for a draft.
  const isDraft = isTempStepId(step.id);
  const [expanded, setExpanded] = useState(false);

  // HEL-407 (design.md Decision 9) — the UI `Step` type has no persisted
  // `position` field, so a reorder alone wouldn't change `step.config` and
  // would silently leave a stale preview. Fold `stepIndex` into the
  // fingerprint: a reorder changes the index, which re-triggers the same
  // debounced re-fetch below.
  // HEL-412 (design.md Decision 8) — `enabledBits` is folded in too: toggling
  // ANY step's enabled state can change what an enabled step's preview
  // prefix actually executes (a disabled step upstream is now skipped, or a
  // just-re-enabled one now runs), so every open preview refreshes on any
  // toggle, not just this card's own.
  const configFingerprint = `${stepIndex}:${enabledBits}:${JSON.stringify(step.config)}`;

  const {
    previewOpen,
    previewRows,
    previewLoading,
    previewError,
    handlePreviewToggle,
    syncPreviewOpenFromStorage,
  } = useStepCardPreview({
    pipelineId,
    stepId: step.id,
    stepEnabled: step.enabled,
    expanded,
    configFingerprint,
  });

  function handleHeaderClick() {
    if (!expanded) {
      // Collapsed → expanded transition: re-sync from localStorage. All
      // StepCards mount unconditionally (only the body is gated on
      // `expanded`), so a mount-time-only read would miss a preference
      // change a sibling card made earlier in the same session.
      syncPreviewOpenFromStorage();
    }
    setExpanded((prev) => !prev);
  }

  const stepCardState = useStepCardState(step, onConfigChange);
  const warningsHeadingId = useId();
  const warningCount = warnings?.length ?? 0;
  const moveUpLabel = laneLabel ? `Move step up in ${laneLabel}` : "Move step up";
  const moveDownLabel = laneLabel ? `Move step down in ${laneLabel}` : "Move step down";

  return (
    <div
      // `--errored` mirrors the `--expanded` modifier (design.md Decision 1).
      // `--disabled` (HEL-412) mutes the card when the step is toggled off.
      className={`pipeline-detail-page__step-card${expanded ? " pipeline-detail-page__step-card--expanded" : ""}${validationError ? " pipeline-detail-page__step-card--errored" : ""}${!step.enabled ? " pipeline-detail-page__step-card--disabled" : ""}${isTail ? " pipeline-detail-page__step-card--tail" : ""}`}
    >
      {/* HEL-407 (design.md Decision 4): the header is now a wrapper `<div>`.
       * The expand-toggle `<button>` keeps its content/semantics unchanged
       * (aria-expanded, native keyboard activation) and stretches via
       * `flex: 1`; the drag handle + Move buttons are SIBLINGS — never
       * nested inside the toggle — following the
       * `SidebarItemList.renderRowAction` precedent (no `stopPropagation`
       * needed since the controls aren't inside another button). */}
      <StepCardHeader
        step={step}
        isDraft={isDraft}
        expanded={expanded}
        isCreating={isCreating}
        validationError={validationError}
        warningCount={warningCount}
        rowCount={rowCount}
        handleHeaderClick={handleHeaderClick}
        isTail={isTail}
        reorderable={reorderable}
        stepIndex={stepIndex}
        onStepDragStart={onStepDragStart}
        onStepDragEnd={onStepDragEnd}
        moveUpLabel={moveUpLabel}
        moveDownLabel={moveDownLabel}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        onToggleEnabled={onToggleEnabled}
        onDuplicate={onDuplicate}
        isDuplicating={isDuplicating}
      />

      {/* HEL-1414 — warnings region: expanded only, directly after the header and before the
       * Outputs rail (outside the card body). Not role="alert": non-blocking and refreshed on
       * every analyze. */}
      {expanded && warningCount > 0 && (
        <StepCardWarnings warnings={warnings} warningsHeadingId={warningsHeadingId} />
      )}

      {/* task 3.3 — always visible (not gated on `expanded`): the rail is
       * this step's Outputs summary, the whole point of which is to be
       * scannable without opening the card. */}
      <OutputsRail
        outputs={outputs}
        previewRowCountByOutputId={previewRowCountByOutputId}
        onOpenOutput={onOpenOutput}
        onAddOutput={() => onAddOutput(step.id)}
      />

      {expanded && (
        <div className="pipeline-detail-page__step-card-body">
          {/* evaluation-1.md CR1 -- a draft's `analyzeSchema` is a best-effort
           * FALLBACK (input flowing in), never a real analyze entry, and
           * `analyzeOutputSchema` is always empty for a draft (it's never
           * sent to /analyze). Rendering the diff regardless would compare a
           * populated fallback input against a genuinely-empty output and
           * falsely report every field as dropped -- suppressed entirely for
           * a draft rather than mirroring the fallback into the output side,
           * which would instead assert the equally-unknown "nothing
           * changes". HEL-1340: the same holds for a created draft still on the fallback
           * schema (`hasOwnAnalyze` false). */}
          {!isDraft && hasOwnAnalyze && (
            <StepSchemaDiffChips
              input={analyzeSchema}
              output={analyzeOutputSchema}
              renames={step.opType.id === "rename" ? renamesOf(step) : undefined}
            />
          )}
          {/* skeptic-final-1.md CR1 — a reorder-invalidated step must surface its
           * validationError regardless of op type (AC2 "surfacing"); previously
           * only the `compute` op rendered it (inline below its expression
           * input via `ComputeFieldConfig`, kept as-is below — excluded here
           * so it isn't rendered twice). */}
          {step.opType.id !== "compute" && <InlineError error={validationError ?? null} />}
          {/* HEL-1109 (pipeline-ai-step-authoring spec) — a rejected deferred
           * create is shown, not swallowed; the step remains a draft. */}
          <InlineError error={draftError ?? null} />
          <StepOpEditor
            step={step}
            allSteps={allSteps}
            analyzeColumns={analyzeColumns}
            analyzeSchema={analyzeSchema}
            validationError={validationError}
            isOwner={isOwner}
            estimatedRows={estimatedRows}
            stepCardState={stepCardState}
          />
          <div className="pipeline-detail-page__step-card-actions">
            {/* HEL-412 (design.md Decision 6) — preview is unavailable for a
             * disabled step (it doesn't run), so the control is hidden
             * entirely rather than shown disabled. */}
            {step.enabled && (
              <button
                type="button"
                className="pipeline-detail-page__step-card-preview-btn"
                onClick={handlePreviewToggle}
                aria-expanded={previewOpen}
              >
                {previewOpen ? "Hide preview" : "Preview data"}
              </button>
            )}
            <button
              type="button"
              className="pipeline-detail-page__step-card-remove-btn"
              onClick={() => onRemove(step.id)}
            >
              Remove step
            </button>
          </div>

          {previewOpen && step.enabled && (
            <StepCardPreviewTray
              analyzeOutputSchema={analyzeOutputSchema}
              previewLoading={previewLoading}
              previewError={previewError}
              previewRows={previewRows}
            />
          )}
        </div>
      )}
    </div>
  );
});
