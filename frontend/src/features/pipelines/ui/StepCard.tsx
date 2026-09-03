// StepCard — one expandable card per pipeline step on the PipelineDetailPage.
// Owns the header/actions chrome and delegates the op-specific editor
// (`StepOpEditor.tsx`) and the inline "preview data" panel state
// (`useStepCardPreview.ts`, HEL-682 split, task 3.2) to their own modules.

import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronDown,
  faChevronUp,
  faCopy,
  faGripVertical,
  faPowerOff,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";

import { useStepCardState } from "../hooks/useStepCardState";
import { useStepCardPreview } from "../hooks/useStepCardPreview";
import { DataGrid } from "../../../shared/ui/index";
import { InlineError } from "../../../shared/chrome/InlineError";
import { renamesOf } from "../state/stepNarrowing";
import type { PipelineStepConfig, SchemaField } from "../types/pipelineStep";
import type { Step } from "../types/step";
import { StepOpEditor } from "./StepOpEditor";
import { StepSchemaDiffChips } from "./StepSchemaDiffChips";
import { OutputsRail } from "./OutputsRail";
import type { Output } from "../types/output";

interface StepCardProps {
  step: Step;
  /** HEL-912 task 5.3 — every step in the pipeline (across every lane), so
   *  `union`/`lookup`'s `SecondaryInputPicker` can offer "other lane" node
   *  options. Not filtered/derived per-card — the picker itself computes
   *  eligibility (design.md Decision 3). Optional/defaults to `[]` so every
   *  pre-existing non-union/lookup test site (which never exercises this
   *  path) doesn't need updating just to satisfy this prop. */
  allSteps?: Step[];
  /** HEL-407 — this step's index in the editor's step list. Threaded down so
   *  the Move up/down buttons know when to disable (design.md Decision 6),
   *  the drag handle can report which step is being dragged (Decision 5),
   *  and the preview-refresh fingerprint can pick up a reorder even though
   *  the UI `Step` type has no persisted `position` field (Decision 9). */
  stepIndex: number;
  pipelineId: string;
  onRemove: (id: string) => void;
  /** Column names from the analyze endpoint's inputSchema for this step — used by SelectFieldsConfig/RenameFieldsConfig/CastFieldsConfig. */
  analyzeColumns: string[];
  /** Full schema fields from the analyze endpoint's inputSchema — used by FilterConfig for type-aware value input. */
  analyzeSchema: SchemaField[];
  /** HEL-404 — this step's output schema (name + type) from the analyze endpoint,
   *  rendered inline in the preview tray alongside the sample rows. Empty when
   *  analyze data for the step is unavailable (pending/failed/unknown step id). */
  analyzeOutputSchema: SchemaField[];
  /** This step's analyze-time `validationError`, if any. Rendered generically via
   *  `InlineError` in the expanded card body (skeptic-final-1.md CR1) for every op
   *  except `compute`, which renders it itself inline below the expression input
   *  (`ComputeFieldConfig`) — kept there for its more specific placement, not
   *  double-rendered. */
  validationError?: string;
  /** Called after a successful config PATCH so the parent can keep step.config in sync. */
  onConfigChange: (stepId: string, config: PipelineStepConfig) => void;
  /** Output row count from the last run, if available. Null hides the chip. */
  rowCount: number | null;
  /** HEL-407 — the drag handle is the SOLE draggable element (design.md
   *  Decision 5); RiverView owns drop targeting on its own card wrapper. */
  onStepDragStart: (index: number) => void;
  onStepDragEnd: () => void;
  /** Undefined disables the button — RiverView omits the handler at the
   *  first/last position rather than StepCard reasoning about bounds.
   *  F-146 — id-keyed (not `() => void`) so RiverView can hand every
   *  StepCard the *same* stable callback reference instead of allocating a
   *  fresh index-closing arrow per card per render (see
   *  `PipelineRiverView.handleMoveUp`/`handleMoveDown`); StepCard supplies
   *  its own `step.id` at the call site below. */
  onMoveUp?: (stepId: string) => void;
  onMoveDown?: (stepId: string) => void;
  /** HEL-412 — persists the disable/enable toggle; the page owns the
   *  optimistic flip + revert-on-failure convention. */
  onToggleEnabled: (stepId: string, enabled: boolean) => void;
  /** HEL-412 — invokes the duplicate endpoint; the page owns splicing the
   *  clone in after the original. */
  onDuplicate: (stepId: string) => void;
  /** HEL-412 — the join of every step's enabled flag (design.md Decision 8),
   *  folded into the preview fingerprint so a toggle anywhere refreshes every
   *  open preview tray, not just this card's own. */
  enabledBits: string;
  /** task 3.3 — this step's own Outputs (already filtered/grouped by the
   *  parent's `selectOutputsByStepId`); rendered as an `OutputsRail` chip row
   *  in the card body. */
  outputs: Output[];
  previewRowCountByOutputId: Record<string, number>;
  onOpenOutput: (output: Output) => void;
  onAddOutput: (stepId: string) => void;
  /** HEL-908 task 3.4 — `true` renders this card as an indented, dashed tail
   *  item (`TailChain`'s sole consumer) instead of a top-level trunk card;
   *  hides the Move up/down buttons and drag handle, since tail-internal
   *  reorder shares the same backend `PUT /steps/order` sibling-scoped
   *  primitive that trunk-to-trunk reorder already relies on (untouched by
   *  this ticket — see `execution-progress.md` Cycle 6 for why building new
   *  reorder UI on top of it isn't attempted here). */
  isTail?: boolean;
}

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
  stepIndex,
  pipelineId,
  onRemove,
  analyzeColumns,
  analyzeSchema,
  analyzeOutputSchema,
  validationError,
  onConfigChange,
  rowCount,
  onStepDragStart,
  onStepDragEnd,
  onMoveUp,
  onMoveDown,
  onToggleEnabled,
  onDuplicate,
  enabledBits,
  outputs,
  previewRowCountByOutputId,
  onOpenOutput,
  onAddOutput,
  isTail = false,
}: StepCardProps) {
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
      <div className="pipeline-detail-page__step-card-header">
        <button
          type="button"
          className="pipeline-detail-page__step-card-toggle"
          onClick={handleHeaderClick}
          aria-expanded={expanded}
        >
          <span className="pipeline-detail-page__step-card-icon" aria-hidden="true">
            <FontAwesomeIcon icon={step.opType.icon} />
          </span>
          <span className="pipeline-detail-page__step-card-label">{step.label}</span>
          {/* Non-interactive chip, like the count chip below (design.md Decision 2). */}
          {validationError && (
            <span
              className="pipeline-detail-page__step-card-error-chip"
              role="img"
              aria-label="Step has a validation error"
            >
              <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
            </span>
          )}
          {rowCount !== null && (
            <span className="pipeline-detail-page__step-card-count">
              {rowCount.toLocaleString()} rows
            </span>
          )}
          <span
            className={`pipeline-detail-page__step-card-chevron${expanded ? " pipeline-detail-page__step-card-chevron--open" : ""}`}
            aria-hidden="true"
          >
            ▾
          </span>
        </button>
        <div className="pipeline-detail-page__step-card-actions-cluster">
          {/* HEL-908 task 3.4 — the drag handle and Move up/down buttons are
           * trunk-only (see `isTail` prop doc): tail-internal reorder shares
           * the same sibling-scoped `PUT /steps/order` primitive trunk
           * reorder already relies on, unmodified by this ticket. */}
          {!isTail && (
            <>
              {/* design.md Decision 5 — the drag handle is an `aria-hidden`
               * mouse/touch-only drag surface, not a focusable control: the
               * keyboard-accessible reorder path is the Move up/down buttons
               * below, not this handle. A focusable-but-hidden element would be
               * an accessibility anti-pattern (phantom tab-stop excluded from
               * the a11y tree), so this is a `<span>`, not a `<button>`. */}
              <span
                className="pipeline-detail-page__step-card-drag-handle"
                aria-hidden="true"
                draggable
                onDragStart={() => onStepDragStart(stepIndex)}
                onDragEnd={onStepDragEnd}
              >
                <FontAwesomeIcon icon={faGripVertical} aria-hidden="true" />
              </span>
              <button
                type="button"
                className="pipeline-detail-page__step-card-move-btn"
                aria-label="Move step up"
                title="Move step up"
                disabled={onMoveUp === undefined}
                onClick={() => onMoveUp?.(step.id)}
              >
                <FontAwesomeIcon icon={faChevronUp} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="pipeline-detail-page__step-card-move-btn"
                aria-label="Move step down"
                title="Move step down"
                disabled={onMoveDown === undefined}
                onClick={() => onMoveDown?.(step.id)}
              >
                <FontAwesomeIcon icon={faChevronDown} aria-hidden="true" />
              </button>
            </>
          )}
          {/* HEL-412 (design.md Decision 6) — sibling of the toggle/drag/move
           * controls above, never nested inside another button. The
           * accessible name flips with state; the icon stays constant
           * (mirrors the Move up/down buttons, which don't swap icons either). */}
          <button
            type="button"
            className="pipeline-detail-page__step-card-toggle-enabled-btn"
            aria-label={step.enabled ? "Disable step" : "Enable step"}
            title={step.enabled ? "Disable step" : "Enable step"}
            aria-pressed={!step.enabled}
            onClick={() => onToggleEnabled(step.id, !step.enabled)}
          >
            <FontAwesomeIcon icon={faPowerOff} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="pipeline-detail-page__step-card-duplicate-btn"
            aria-label="Duplicate step"
            title="Duplicate step"
            onClick={() => onDuplicate(step.id)}
          >
            <FontAwesomeIcon icon={faCopy} aria-hidden="true" />
          </button>
        </div>
      </div>

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
          <StepSchemaDiffChips
            input={analyzeSchema}
            output={analyzeOutputSchema}
            renames={step.opType.id === "rename" ? renamesOf(step) : undefined}
          />
          {/* skeptic-final-1.md CR1 — a reorder-invalidated step must surface its
           * validationError regardless of op type (AC2 "surfacing"); previously
           * only the `compute` op rendered it (inline below its expression
           * input via `ComputeFieldConfig`, kept as-is below — excluded here
           * so it isn't rendered twice). */}
          {step.opType.id !== "compute" && <InlineError error={validationError ?? null} />}
          <StepOpEditor
            step={step}
            allSteps={allSteps}
            analyzeColumns={analyzeColumns}
            analyzeSchema={analyzeSchema}
            validationError={validationError}
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
            <div className="pipeline-detail-page__step-preview">
              {analyzeOutputSchema.length > 0 && (
                <div
                  className="pipeline-detail-page__step-preview-schema"
                  aria-label="Output schema"
                >
                  {analyzeOutputSchema.map((field) => (
                    <span
                      key={field.name}
                      className="pipeline-detail-page__step-preview-schema-chip"
                    >
                      {field.name}
                      <span className="pipeline-detail-page__step-preview-schema-chip-type">
                        : {field.type}
                      </span>
                    </span>
                  ))}
                </div>
              )}
              {previewLoading ? (
                <p className="pipeline-detail-page__step-preview-loading">Loading preview…</p>
              ) : previewError !== null ? (
                <p className="pipeline-detail-page__step-preview-error" role="alert">
                  {previewError}
                </p>
              ) : (
                <DataGrid variant="preview" rows={previewRows} emptyText="No rows to preview." />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
