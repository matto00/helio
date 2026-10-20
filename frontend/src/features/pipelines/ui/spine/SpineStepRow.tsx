// SpineStepRow -- HEL-1579 (design.md D5): one numbered row of the step spine. A `button` that selects
// the step (`aria-current="true"` on the selected row), with the number badge, title, one-line mono
// summary and the row count after the step; plus a quiet row menu (a SIBLING of the select button, never
// nested inside it) and, on trunk rows, a drag grip. Markers (disabled, save error, draft, validation,
// warnings) are quiet: never the accent. The accent appears only as the selected row's wash and filled
// number (DESIGN.md §0).

import { ChevronRight, EyeOff, GripVertical, TriangleAlert } from "lucide-react";
import type { DragEvent } from "react";

import { ActionsMenu, type ActionsMenuItem } from "../../../../shared/chrome/ActionsMenu";
import { StatusChip } from "../../../../shared/ui/index";
import { Spinner } from "../../../../shared/ui/Spinner";
import { ICON_SIZE } from "../../../../shared/ui/iconSize";
import type { DraftDisplayStatus } from "../../state/draftStepView";
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

/** HEL-1631: how a step reads while a draft exists. Counts are over the cached source sample, both sides. */
export interface SpineRowDraft {
  status: DraftDisplayStatus;
  /** The draft's count (the last good one while pending, stale or in error); `null` when never known. */
  count: number | null;
  /** The saved pipeline's count over the same sample; `null` when unknown. */
  baseCount: number | null;
  /** The counts are over the first 1,000 rows of a larger source. */
  sample: boolean;
}

/** "104 → 92" when the draft changes the count, else the plain count (or a placeholder). */
export function draftCountText(draft: SpineRowDraft, enabled: boolean): string {
  if (!enabled) return "off";
  if (draft.status === "notPreviewed") return "—";
  if (draft.count === null) return draft.status === "pending" ? "…" : "—";
  if (draft.baseCount !== null && draft.baseCount !== draft.count) {
    return `${draft.baseCount.toLocaleString()} → ${draft.count.toLocaleString()}`;
  }
  return draft.count.toLocaleString();
}

function draftAccessibleCount(draft: SpineRowDraft): string | null {
  const rows = (n: number) => `${n.toLocaleString()} ${n === 1 ? "row" : "rows"}`;
  const parts: string[] = [];
  if (draft.count !== null) {
    parts.push(
      draft.baseCount !== null && draft.baseCount !== draft.count
        ? `${rows(draft.baseCount)} saved, ${draft.count.toLocaleString()} in draft`
        : `${rows(draft.count)} in draft`,
    );
    if (draft.sample) parts.push("counted over the first 1,000 rows of the source");
  }
  if (draft.status === "pending") parts.push("updating on the server");
  if (draft.status === "stale") parts.push("an earlier step has an error, showing its last result");
  if (draft.status === "error") parts.push("has an error in the draft");
  if (draft.status === "notPreviewed") parts.push("not previewed (AI step): runs on Save & run");
  return parts.length > 0 ? parts.join(", ") : null;
}

interface SpineStepRowProps {
  step: Step;
  /** 1-based number within the step's own lane. */
  number: number;
  selected: boolean;
  /** Row count after this step; `null` = not recorded ("—", never 0). */
  rowCount: number | null;
  /** HEL-1631: present while a draft exists; then the count, its "saved → draft" form and the status come from here. */
  draft?: SpineRowDraft;
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
  /** HEL-1582: the phone's row -- a full-width 60px+ button opening the step sheet, with a chevron and no grip or
   *  row menu (HTML5 drag is mouse-only; Move up/down is in the sheet's "Step actions" menu). */
  phone?: boolean;
  onSelect: (stepId: string) => void;
}

export function SpineStepRow({
  step,
  number,
  selected,
  rowCount,
  draft,
  partial,
  hasValidationError,
  warningCount,
  hasSaveError,
  isCreating,
  menuItems,
  reorder,
  nodePath,
  phone = false,
  onSelect,
}: SpineStepRowProps) {
  const summary = summarizeStepConfig(step);
  const isDraft = isTempStepId(step.id);
  const countText =
    draft !== undefined
      ? draftCountText(draft, step.enabled)
      : !step.enabled
        ? "off"
        : rowCount === null
          ? "—"
          : rowCount.toLocaleString();
  const accessibleName = [
    `Step ${number}: ${step.label}`,
    !step.enabled
      ? "disabled"
      : draft !== undefined
        ? draftAccessibleCount(draft)
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
      className={`spine-row${selected ? " spine-row--selected" : ""}${!step.enabled ? " spine-row--disabled" : ""}${phone ? " spine-row--phone" : ""}`}
      data-step-row={step.id}
      onDragOver={reorder && !phone ? (e) => reorder.onDragOver(e, reorder.index) : undefined}
      onDrop={reorder && !phone ? (e) => reorder.onDrop(e) : undefined}
      title={nodePath}
    >
      {reorder && !phone && (
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
        aria-haspopup={phone ? "dialog" : undefined}
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
          {draft?.status === "pending" && step.enabled && (
            <span className="spine-row__marker" role="img" aria-label="Updating on the server">
              <Spinner size="sm" />
            </span>
          )}
          {draft?.status === "error" && step.enabled && (
            <span
              className="spine-row__marker spine-row__marker--error"
              role="img"
              aria-label="Step has an error in the draft"
            >
              <TriangleAlert aria-hidden="true" size={ICON_SIZE.sm} />
            </span>
          )}
          {draft?.status === "stale" && step.enabled && (
            <span className="spine-row__note">stale</span>
          )}
          {draft?.status === "notPreviewed" && step.enabled && (
            <span
              className="spine-row__marker"
              role="img"
              aria-label="Not previewed (AI step): runs on Save & run"
              title="not previewed (AI step): runs on Save & run"
            >
              <EyeOff aria-hidden="true" size={ICON_SIZE.sm} />
            </span>
          )}
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
        <span
          className={`spine-row__count${draft?.status === "stale" || draft?.status === "pending" ? " spine-row__count--stale" : ""}`}
          aria-hidden="true"
        >
          {countText}
        </span>
        {phone && (
          <ChevronRight className="spine-row__chevron" aria-hidden="true" size={ICON_SIZE.sm} />
        )}
      </button>
      {!phone && (
        <div className="spine-row__menu">
          <ActionsMenu label={`Step actions for ${step.label}`} items={menuItems} />
        </div>
      )}
    </div>
  );
}
