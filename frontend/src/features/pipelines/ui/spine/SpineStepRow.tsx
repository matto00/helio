// SpineStepRow -- HEL-1579 (design.md D5): one numbered row of the step spine. A `button` that selects
// the step (`aria-current="true"` on the selected row), with the number badge, title, one-line mono
// summary and the row count after the step; plus a quiet row menu (a SIBLING of the select button, never
// nested inside it) and, on trunk rows, a drag grip. Markers (disabled, save error, draft, validation,
// warnings) are quiet: never the accent. The accent appears only as the selected row's wash and filled
// number (DESIGN.md §0).

import { GripVertical, TriangleAlert } from "lucide-react";
import type { DragEvent } from "react";

import { ActionsMenu, type ActionsMenuItem } from "../../../../shared/chrome/ActionsMenu";
import { StatusChip } from "../../../../shared/ui/index";
import { ICON_SIZE } from "../../../../shared/ui/iconSize";
import { isTempStepId } from "../../state/stepNarrowing";
import { summarizeStepConfig } from "../../state/summarizeStepConfig";
import type { Step } from "../../types/step";

/** Drag-reorder wiring for a trunk row (see `useLaneReorder`); absent for a branch lane's rows. */
export interface SpineRowReorder {
  index: number;
  onDragStart: (index: number, stepId: string) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLElement>, index: number) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}

interface SpineStepRowProps {
  step: Step;
  /** 1-based number within the step's own lane. */
  number: number;
  selected: boolean;
  /** Row count after this step; `null` = not recorded ("—", never 0). */
  rowCount: number | null;
  /** The shown counts are partial (the run hit its row cap): added to the accessible name. */
  partial: boolean;
  hasValidationError: boolean;
  warningCount: number;
  /** A flushed save that failed after the editor unmounted (page-level `stepSaveErrors`). */
  hasSaveError: boolean;
  isCreating: boolean;
  menuItems: ActionsMenuItem[];
  reorder?: SpineRowReorder;
  nodePath?: string;
  onSelect: (stepId: string) => void;
}

export function SpineStepRow({
  step,
  number,
  selected,
  rowCount,
  partial,
  hasValidationError,
  warningCount,
  hasSaveError,
  isCreating,
  menuItems,
  reorder,
  nodePath,
  onSelect,
}: SpineStepRowProps) {
  const summary = summarizeStepConfig(step);
  const isDraft = isTempStepId(step.id);
  const countText = !step.enabled ? "off" : rowCount === null ? "—" : rowCount.toLocaleString();
  const accessibleName = [
    `Step ${number}: ${step.label}`,
    !step.enabled
      ? "disabled"
      : rowCount === null
        ? null
        : `${rowCount.toLocaleString()} ${rowCount === 1 ? "row" : "rows"}${partial ? ", partial (row cap reached)" : ""}`,
    // Marker states live INSIDE the button, whose explicit aria-label overrides its content, so they are said here.
    isDraft ? "draft, not yet saved" : null,
    hasValidationError ? "has a validation error" : null,
    warningCount > 0
      ? `${warningCount} schema ${warningCount === 1 ? "warning" : "warnings"}`
      : null,
    hasSaveError ? "couldn't save the last change to this step" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      className={`spine-row${selected ? " spine-row--selected" : ""}${!step.enabled ? " spine-row--disabled" : ""}`}
      data-step-row={step.id}
      onDragOver={reorder ? (e) => reorder.onDragOver(e, reorder.index) : undefined}
      onDrop={reorder ? (e) => reorder.onDrop(e) : undefined}
      title={nodePath}
    >
      {reorder && (
        // The grip is a mouse/touch drag surface only: the keyboard path is the row menu's Move
        // up/down (the same decision the card's grip made, HEL-407 design.md Decision 5).
        <span
          className="spine-row__grip"
          aria-hidden="true"
          draggable
          onDragStart={() => reorder.onDragStart(reorder.index, step.id)}
          onDragEnd={reorder.onDragEnd}
        >
          <GripVertical aria-hidden="true" size={ICON_SIZE.sm} />
        </span>
      )}
      <button
        type="button"
        className="spine-row__select"
        aria-current={selected ? "true" : undefined}
        aria-label={accessibleName}
        onClick={() => onSelect(step.id)}
      >
        <span className="spine-row__number" aria-hidden="true">
          {number}
        </span>
        <span className="spine-row__text" aria-hidden="true">
          <span className="spine-row__title">{step.label}</span>
          <span className="spine-row__summary" title={summary}>
            {summary}
          </span>
        </span>
        <span className="spine-row__markers">
          {isDraft && (
            <StatusChip intent="neutral" dashed>
              Draft — not yet saved
            </StatusChip>
          )}
          {isCreating && !isDraft && <span className="spine-row__note">Saving…</span>}
          {hasValidationError && (
            <span
              className="spine-row__marker spine-row__marker--error"
              role="img"
              aria-label="Step has a validation error"
            >
              <TriangleAlert aria-hidden="true" size={ICON_SIZE.sm} />
            </span>
          )}
          {warningCount > 0 && (
            <span
              className="spine-row__marker spine-row__marker--warning"
              role="img"
              aria-label={`${warningCount} schema ${warningCount === 1 ? "warning" : "warnings"}`}
            >
              <TriangleAlert aria-hidden="true" size={ICON_SIZE.sm} />
              {warningCount > 1 && <span aria-hidden="true">{warningCount}</span>}
            </span>
          )}
          {hasSaveError && (
            <span
              className="spine-row__marker spine-row__marker--error"
              role="img"
              aria-label="Couldn't save the last change to this step"
            >
              <TriangleAlert aria-hidden="true" size={ICON_SIZE.sm} />
            </span>
          )}
        </span>
        <span className="spine-row__count" aria-hidden="true">
          {countText}
        </span>
      </button>
      <div className="spine-row__menu">
        <ActionsMenu label={`Step actions for ${step.label}`} items={menuItems} />
      </div>
    </div>
  );
}
