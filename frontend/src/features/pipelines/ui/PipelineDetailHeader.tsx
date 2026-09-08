// PipelineDetailHeader — the single header region shown above the river view
// on PipelineDetailPage: bound source(s), bound output type, and schedule
// summary as field groups inside one bordered/backed container.
//
// Consolidates the three formerly-separate bars (`BoundSourceBar`,
// `BoundTypeBar`, `PipelineScheduleBar`, HEL-719) into one component so the
// page reads as a single designed header rather than a stack of retrofitted
// strips (design.md D1). Each field group keeps its retired sibling's exact
// logic/JSX shape — only the outer bordered/backed container is shared.
//
// Scope amendment (design.md D5/D6): the three per-field "Edit source"/
// "Edit type"/"Edit schedule" buttons consolidate into one `ActionsMenu`
// trigger at the header's trailing edge, and each field group compacts to a
// single, denser line — both free the horizontal budget that was feeding
// skeptic-final-2.md's `__schedule-next-run` truncation finding.
//
// HEL-1022 — the source group now renders one chip per `PipelineRoot`
// (previously it read only `roots[0]`, silently discarding roots[1..] once
// a pipeline had more than one). User-facing copy calls a root a "source"
// (internal naming — `root`/`PipelineRoot` — is unchanged; this is a copy
// decision, not a rename). The `+` reopens the same `AddRootModal` the
// canvas used to own; the canvas's own "+ Add root" box is removed in favor
// of this header affordance (it read as an empty drop zone, not an action).
//
// Follow-up (same ticket) — a chip's NAME is the per-root navigation
// affordance now, not a single global "Edit source" menu item: the actions
// menu previously offered exactly ONE "Edit source" action that silently
// navigated to `roots[0]`'s source regardless of how many chips the header
// showed, which is worse than the pre-chip UI (that one only ever CLAIMED
// one source). `canEditSource` is therefore per-root (`sourceByRootId`), and
// the singular menu item survives ONLY at exactly one root — 2+ roots drop
// it entirely in favor of clicking the chip whose source you mean. A root
// whose source isn't resolvable in the caller's own `sources.items` (the
// same condition the old global `canEditSource` checked) renders as plain
// non-interactive text, never a dead link.

import { useState } from "react";
import { createPortal } from "react-dom";

import { labelForKind } from "../../sources/utils/labelForKind";
import type { DataSource } from "../../sources/types/dataSource";
import type { PipelineRoot } from "../types/pipelineStep";
import type { PipelineSchedule } from "../types/pipelineSchedule";
import { Toggle } from "../../../shared/ui/Toggle";
import { StatusChip } from "../../../shared/ui/StatusChip";
import { ActionsMenu, type ActionsMenuItem } from "../../../shared/chrome/ActionsMenu";
import { usePortalPopover } from "../../../hooks/usePortalPopover";
import { AddRootModal } from "./AddRootModal";

import "../../../shared/chrome/Popover.css";
import "./PipelineDetailHeader.css";

// HEL-1022 — past this many chips, the rest collapse into a "+N more"
// affordance so 6 sources can't wrap the header row or blow out its height.
const MAX_VISIBLE_SOURCE_CHIPS = 3;

/** `nextRunAt` is nullish both as an explicit `null` (backend hasn't computed
 *  a next run yet) and, on the wire, as an **absent key** — spray-json's
 *  default `Option` formatter omits `None` fields entirely rather than
 *  serializing `null` (documented codebase gotcha), so a freshly-saved or
 *  cadence-changed schedule's not-yet-computed `nextRunAt` deserializes as
 *  `undefined`. A strict `=== null` check misses that case and feeds
 *  `undefined` into `new Date(...)`, rendering the literal text "Invalid
 *  Date". Use a nullish check so both shapes take the same "no next run yet"
 *  path (spec: "Schedule exists but has no computed next run yet"). */
function formatNextRun(nextRunAt: string | null | undefined): string | null {
  if (nextRunAt == null) return null;
  return new Date(nextRunAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatExpressionSummary(schedule: PipelineSchedule): string {
  return schedule.kind === "interval" ? `Every ${schedule.expression}` : schedule.expression;
}

interface PipelineDetailHeaderProps {
  /** HEL-1022 — every root feeding this pipeline, in `position` order; the
   *  source group renders one chip per entry instead of only `roots[0]`. */
  roots: PipelineRoot[];
  /** HEL-1022 — the matching `DataSource`, keyed by ROOT id (not source id,
   *  since two roots can't share a `dataSourceId` but the lookup always
   *  starts from the root). `undefined` means the source isn't resolvable in
   *  the current user's own `sources.items` (not owned, or shared-pipeline
   *  visibility) — that root's chip renders as plain non-interactive text
   *  rather than a dead link, and it never contributes a kind badge. */
  sourceByRootId: Record<string, DataSource | undefined>;
  /** Navigates to a source's detail view. Called with the specific source's
   *  id — never invoked for a root whose source didn't resolve. */
  onEditSource: (sourceId: string) => void;
  /** "+ root": either an existing source's id or a source just created via
   *  the nested `AddSourceModal` composition (`AddRootModal`). */
  onAddRoot: (sourceId: string) => void;
  /** Root removal (R7) — the confirmation/refusal rendering lives in the
   *  caller (`usePipelineDetailPage.handleRemoveRoot`). */
  onRemoveRoot: (rootId: string) => void;
  /** HEL-908 task 8.1 — the pipeline's total Output count (`selectOutputsForPipeline`),
   *  replacing the retired "Output type" link (DataType-bound, HEL-903 dropped
   *  DataType-per-pipeline as the panel-binding concept). */
  outputsCount: number;
  /** HEL-908 task 8.1 — the pipeline's last run status, for a compact chip
   *  alongside source/schedule (the footer's own `StatusChip` still owns the
   *  detailed in-progress/queued run state; this is a glanceable header
   *  summary of the LAST completed run only, mirroring `PipelineListTable`'s
   *  own header-row badge). `null` means no run has completed yet. */
  lastRunStatus: "succeeded" | "failed" | null;
  /** The pipeline's current schedule, or `null` if none is set. */
  schedule: PipelineSchedule | null;
  /** Opens PipelineScheduleDialog (create or edit, depending on `schedule`). */
  onEditSchedule: () => void;
  /** Toggles `enabled` without altering kind/expression/timezone. Only
   *  rendered when a schedule exists. */
  onToggleScheduleEnabled: (enabled: boolean) => void;
  /** Opens the run-history modal. */
  onOpenHistory: () => void;
  /** Whether the current user owns the pipeline. Gates "Share" (owner-only). */
  isOwner: boolean;
  /** Opens the share dialog. Only invoked when `isOwner` is true. */
  onOpenShare: () => void;
}

export function PipelineDetailHeader({
  roots,
  sourceByRootId,
  onEditSource,
  onAddRoot,
  onRemoveRoot,
  outputsCount,
  lastRunStatus,
  schedule,
  onEditSchedule,
  onToggleScheduleEnabled,
  onOpenHistory,
  isOwner,
  onOpenShare,
}: PipelineDetailHeaderProps) {
  const nextRun = schedule !== null ? formatNextRun(schedule.nextRunAt) : null;
  const [addRootOpen, setAddRootOpen] = useState(false);
  // HEL-1022 follow-up — a cold-review defect: this used to be bare
  // `useState`, so nothing ever closed the popover on Escape, an outside
  // click, or focus leaving it (the only way out was re-finding and
  // re-clicking the trigger the popover itself was covering). `usePortalPopover`
  // is the primitive `ActionsMenu` (two field-groups over, in this same file)
  // already uses for exactly this — Escape-to-close, focusout-to-close (once
  // `panelRef` is attached), and portal positioning — so this reuses the hook
  // rather than re-deriving that behavior. It does NOT reuse the `ActionsMenu`
  // COMPONENT itself: that component's `role="menu"`/`"menuitem"` contract
  // assumes one flat list of single-action buttons, but each chip here is a
  // compound control (an independent "edit" affordance on the name, and a
  // separate "remove" affordance) — forcing that into the menu/menuitem ARIA
  // pattern would be invalid in the other direction. `renderSourceChip` below
  // is reused as-is for both the visible row and this popover's contents, so
  // there is exactly one place a chip's markup is defined.
  const {
    triggerRef: overflowTriggerRef,
    panelRef: overflowPanelRef,
    isOpen: overflowOpen,
    panelPos: overflowPanelPos,
    handleOpen: openOverflow,
    close: closeOverflow,
  } = usePortalPopover<HTMLButtonElement>();
  // HEL-1022 — past 6 sources this is just a lower bound: showing more than
  // this in the overflow list would blow out the popover, not the header
  // row, but no fixture in this codebase has approached that yet.
  const visibleRoots = roots.slice(0, MAX_VISIBLE_SOURCE_CHIPS);
  const overflowRoots = roots.slice(MAX_VISIBLE_SOURCE_CHIPS);
  // The server refuses removal of the last root (R7); disabling the chip's
  // own × for that case avoids a guaranteed-failing round trip.
  const canRemoveRoot = roots.length > 1;
  // HEL-1022 — the kind badge ("SQL", "CSV", ...) is only restored at exactly
  // one source, matching the pre-chip header's look; at 2+ it would make
  // every chip heavier right when the row is already tightest on space.
  const showKindBadge = roots.length === 1;

  // design.md D5 — one menu replaces the per-field edit buttons.
  // Gating is identical to each retired button's own condition; "Edit
  // schedule"/"Set schedule" is always present (mirrors the always-visible
  // button it replaces). Built fresh each render — cheap, and keeps item
  // gating trivially readable next to the JSX it used to live beside.
  // The page's ONE actions menu. Previously there were two — this one (edit
  // source/schedule) and a second in the footer (run history/preview/
  // share). On desktop they sat at opposite corners and read as distinct; once
  // the header stacks at <=1100px they end up as two identical kebabs a few
  // hundred pixels apart, neither labeled, with no way to tell which holds
  // what. Merged here, ordered edit-actions then view-actions, with the same
  // per-item gating both menus already had.
  //
  // HEL-908 task 8.1/8.2 — "Edit type" (DataType-bound) and "Preview" (the
  // deleted `PipelinePreviewModal`, superseded by per-Output previews in the
  // Output editor sheet / Outputs rail thumbnails) are both removed.
  //
  // HEL-1022 — the singular "Edit source" item only survives at exactly one
  // root: with 2+ chips, which one it would silently pick is ambiguous (that
  // was the defect), and the fix is clicking the chip whose source you mean,
  // not a menu item that guesses.
  const onlyRoot = roots.length === 1 ? roots[0] : undefined;
  const onlyRootSource = onlyRoot ? sourceByRootId[onlyRoot.id] : undefined;
  const actionItems: ActionsMenuItem[] = [
    ...(onlyRootSource
      ? [{ label: "Edit source", onClick: () => onEditSource(onlyRootSource.id) }]
      : []),
    { label: schedule === null ? "Set schedule" : "Edit schedule", onClick: onEditSchedule },
    { label: "Run history", onClick: onOpenHistory },
    ...(isOwner ? [{ label: "Share", onClick: onOpenShare }] : []),
  ];

  // HEL-1022 — one render path for both the visible row and the overflow
  // popover's chips, so the editable-name/plain-text/kind-badge logic lives
  // in exactly one place.
  function renderSourceChip(root: PipelineRoot) {
    const source = sourceByRootId[root.id];
    return (
      <span key={root.id} className="pipeline-detail-header__source-chip">
        {source ? (
          <button
            type="button"
            className="pipeline-detail-header__source-chip-name pipeline-detail-header__source-chip-name--link"
            aria-label={`Edit source ${root.dataSourceName}`}
            onClick={() => onEditSource(source.id)}
          >
            {root.dataSourceName}
          </button>
        ) : (
          <span className="pipeline-detail-header__source-chip-name">{root.dataSourceName}</span>
        )}
        {showKindBadge && source && (
          <span className="pipeline-detail-header__source-kind">{labelForKind(source.type)}</span>
        )}
        <button
          type="button"
          className="pipeline-detail-header__source-chip-remove"
          aria-label={`Remove source ${root.dataSourceName}`}
          disabled={!canRemoveRoot}
          onClick={() => onRemoveRoot(root.id)}
        >
          ×
        </button>
      </span>
    );
  }

  function handleOverflowToggle() {
    if (overflowOpen) {
      closeOverflow();
      return;
    }
    openOverflow((rect) => ({ top: rect.bottom + 8, left: rect.left }));
  }

  // HEL-1022 — `role="menu"` (with `role="menuitem"` children) was invalid
  // here: each chip is a compound control (name + remove), not a single
  // menuitem. `role="group"` has no such constraint and still gives the
  // popover an accessible name via `aria-labelledby`.
  const overflowPanel =
    overflowOpen && overflowPanelPos
      ? createPortal(
          <>
            <button
              type="button"
              className="popover__scrim"
              tabIndex={-1}
              onClick={closeOverflow}
            />
            <div
              ref={(el) => {
                overflowPanelRef.current = el;
              }}
              className="popover__panel pipeline-detail-header__source-overflow-menu"
              role="group"
              aria-labelledby="pipeline-detail-header__source-overflow-trigger"
              style={{
                position: "fixed",
                top: overflowPanelPos.top,
                left: overflowPanelPos.left,
              }}
            >
              {overflowRoots.map(renderSourceChip)}
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <div className="pipeline-detail-header">
      {/* ── Bound source(s) — HEL-1022: one chip per root, "Source"/"Sources
          (N)" so a single-source pipeline still reads exactly as calm as it
          always has. ── */}
      <div className="pipeline-detail-header__group">
        <span className="pipeline-detail-header__group-label">
          {roots.length > 1 ? `Sources (${roots.length})` : "Source"}
        </span>
        <div className="pipeline-detail-header__group-value">
          <div className="pipeline-detail-header__source-chips">
            {visibleRoots.map(renderSourceChip)}
            {overflowRoots.length > 0 && (
              <button
                id="pipeline-detail-header__source-overflow-trigger"
                ref={overflowTriggerRef}
                type="button"
                className="pipeline-detail-header__source-overflow-trigger"
                aria-haspopup="true"
                aria-expanded={overflowOpen}
                onClick={handleOverflowToggle}
              >
                +{overflowRoots.length} more
              </button>
            )}
            {overflowPanel}
          </div>
          <button
            type="button"
            className="pipeline-detail-header__add-source-btn"
            aria-label="Add source"
            onClick={() => setAddRootOpen(true)}
          >
            +
          </button>
        </div>
      </div>

      {addRootOpen && (
        <AddRootModal
          onClose={() => setAddRootOpen(false)}
          onAdd={(sourceId) => {
            onAddRoot(sourceId);
            setAddRootOpen(false);
          }}
        />
      )}

      {/* ── Outputs count + last run status (HEL-908 task 8.1 — replaces the
          retired DataType-bound "Output type" link). Rendered as a single
          "Outputs (N)" string, matching the gallery tab's own "Outputs (N)"
          label convention (`pipeline-editor-page`'s HEL-908 delta scenario). ── */}
      <div className="pipeline-detail-header__group">
        <div className="pipeline-detail-header__group-value">
          <span className="pipeline-detail-header__type-name">Outputs ({outputsCount})</span>
          {lastRunStatus !== null && (
            <StatusChip intent={lastRunStatus === "succeeded" ? "success" : "error"}>
              {lastRunStatus === "succeeded" ? "Succeeded" : "Failed"}
            </StatusChip>
          )}
        </div>
      </div>

      {/* ── Schedule ── */}
      {schedule === null ? (
        <div className="pipeline-detail-header__group">
          <span className="pipeline-detail-header__group-label">Schedule</span>
          <div className="pipeline-detail-header__group-value">
            <span className="pipeline-detail-header__schedule-empty">No schedule set</span>
          </div>
        </div>
      ) : (
        <div className="pipeline-detail-header__group">
          <span className="pipeline-detail-header__group-label">Schedule</span>
          <div className="pipeline-detail-header__group-value">
            {/* F-139: a bare checkbox read as a row-selection control with no
             *  visible affordance for its enable/disable meaning. The switch
             *  shape (shared Toggle primitive) is self-explanatory without
             *  needing extra visible label text crammed into this already-dense
             *  row — the aria-label still carries the accessible name. Stays
             *  outside the actions menu (design.md D5) — a persistent state
             *  control, not a navigation action. */}
            <Toggle
              className="pipeline-detail-header__schedule-toggle"
              checked={schedule.enabled}
              onChange={onToggleScheduleEnabled}
              ariaLabel={schedule.enabled ? "Disable schedule" : "Enable schedule"}
            />
            <span className="pipeline-detail-header__schedule-expression">
              {formatExpressionSummary(schedule)}
            </span>
            {schedule.enabled && nextRun !== null && (
              <span
                className="pipeline-detail-header__schedule-next-run"
                title={`next run ${nextRun}`}
              >
                next run {nextRun}
              </span>
            )}
            {schedule.enabled && nextRun === null && (
              <span className="pipeline-detail-header__schedule-next-run">no next run yet</span>
            )}
            {!schedule.enabled && (
              // skeptic-final-1.md: `title` gives the badge's text a
              // hover/keyboard-recoverable fallback in case any future
              // change re-narrows its box (the badge is hidden outright in
              // the row layout — see PipelineDetailHeader.css — so this is
              // defense-in-depth, not the primary fix).
              <span className="pipeline-detail-header__schedule-disabled-badge" title="Disabled">
                Disabled
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Actions menu (design.md D5) ── */}
      <div className="pipeline-detail-header__actions">
        <ActionsMenu label="Pipeline actions" items={actionItems} />
      </div>
    </div>
  );
}
