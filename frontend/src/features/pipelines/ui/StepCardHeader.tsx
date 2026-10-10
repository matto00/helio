// StepCardHeader — the card's header row: expand toggle (with draft/error/warning/count chips) and
// the drag handle / Move / enable / duplicate actions cluster (HEL-1465 split out of StepCard.tsx).

import { TriangleAlert, ChevronDown, ChevronUp, Copy, GripVertical, Power } from "lucide-react";

import { StatusChip } from "../../../shared/ui/index";
import { ICON_SIZE } from "../../../shared/ui/iconSize";
import type { Step } from "../types/step";

interface StepCardHeaderProps {
  step: Step;
  isDraft: boolean;
  expanded: boolean;
  isCreating: boolean;
  validationError?: string;
  warningCount: number;
  rowCount: number | null;
  handleHeaderClick: () => void;
  isTail: boolean;
  reorderable: boolean;
  stepIndex: number;
  onStepDragStart: (index: number, stepId: string) => void;
  onStepDragEnd: () => void;
  moveUpLabel: string;
  moveDownLabel: string;
  onMoveUp?: (stepId: string) => void;
  onMoveDown?: (stepId: string) => void;
  onToggleEnabled: (stepId: string, enabled: boolean) => void;
  onDuplicate: (stepId: string) => void;
  isDuplicating: boolean;
}

export function StepCardHeader({
  step,
  isDraft,
  expanded,
  isCreating,
  validationError,
  warningCount,
  rowCount,
  handleHeaderClick,
  isTail,
  reorderable,
  stepIndex,
  onStepDragStart,
  onStepDragEnd,
  moveUpLabel,
  moveDownLabel,
  onMoveUp,
  onMoveDown,
  onToggleEnabled,
  onDuplicate,
  isDuplicating,
}: StepCardHeaderProps) {
  return (
    <div className="pipeline-detail-page__step-card-header">
      <button
        type="button"
        className="pipeline-detail-page__step-card-toggle"
        onClick={handleHeaderClick}
        aria-expanded={expanded}
        disabled={isCreating}
        title={isCreating ? "Saving step…" : undefined}
      >
        <span className="pipeline-detail-page__step-card-icon" aria-hidden="true">
          <step.opType.icon size={ICON_SIZE.md} />
        </span>
        <span className="pipeline-detail-page__step-card-label">{step.label}</span>
        {/* HEL-1109 (design.md D6) — an unsaved AI draft's own affordance;
         * DESIGN.md's one pill recipe, same treatment as a never-run
         * pipeline (`PipelineListTable.tsx:37-39`), not a new badge. */}
        {isDraft && (
          <StatusChip intent="neutral" dashed>
            Draft — not yet saved
          </StatusChip>
        )}
        {/* Non-interactive chip, like the count chip below (design.md Decision 2). */}
        {validationError && (
          <span
            className="pipeline-detail-page__step-card-error-chip"
            role="img"
            aria-label="Step has a validation error"
          >
            <TriangleAlert aria-hidden="true" size={ICON_SIZE.sm} />
          </span>
        )}
        {/* HEL-1414 — non-interactive warning-intent indicator, a sibling of the error chip;
         * never marks the card errored (warning tokens only). */}
        {warningCount > 0 && (
          <span
            className="pipeline-detail-page__step-card-warning-chip"
            role="img"
            aria-label={`${warningCount} schema ${warningCount === 1 ? "warning" : "warnings"}`}
          >
            <TriangleAlert aria-hidden="true" size={ICON_SIZE.sm} />
            {warningCount > 1 && <span aria-hidden="true">{warningCount}</span>}
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
        {!isTail && reorderable && (
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
              onDragStart={() => onStepDragStart(stepIndex, step.id)}
              onDragEnd={onStepDragEnd}
            >
              <GripVertical aria-hidden="true" size={ICON_SIZE.sm} />
            </span>
            <button
              type="button"
              className="pipeline-detail-page__step-card-move-btn"
              aria-label={moveUpLabel}
              title={moveUpLabel}
              data-step-id={step.id}
              data-move-dir="up"
              disabled={onMoveUp === undefined}
              onClick={() => onMoveUp?.(step.id)}
            >
              <ChevronUp aria-hidden="true" size={ICON_SIZE.sm} />
            </button>
            <button
              type="button"
              className="pipeline-detail-page__step-card-move-btn"
              aria-label={moveDownLabel}
              title={moveDownLabel}
              data-step-id={step.id}
              data-move-dir="down"
              disabled={onMoveDown === undefined}
              onClick={() => onMoveDown?.(step.id)}
            >
              <ChevronDown aria-hidden="true" size={ICON_SIZE.sm} />
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
          <Power aria-hidden="true" size={ICON_SIZE.sm} />
        </button>
        <button
          type="button"
          className="pipeline-detail-page__step-card-duplicate-btn"
          aria-label="Duplicate step"
          title="Duplicate step"
          disabled={isDuplicating}
          onClick={() => onDuplicate(step.id)}
        >
          <Copy aria-hidden="true" size={ICON_SIZE.sm} />
        </button>
      </div>
    </div>
  );
}
