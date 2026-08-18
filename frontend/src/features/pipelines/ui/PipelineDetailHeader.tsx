// PipelineDetailHeader — the single header region shown above the river view
// on PipelineDetailPage: bound source, bound output type, and schedule
// summary as three field groups inside one bordered/backed container.
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

import { labelForKind } from "../../sources/utils/labelForKind";
import type { DataSource } from "../../sources/types/dataSource";
import type { PipelineSchedule } from "../types/pipelineSchedule";
import { Toggle } from "../../../shared/ui/Toggle";
import { ActionsMenu, type ActionsMenuItem } from "../../../shared/chrome/ActionsMenu";

import "./PipelineDetailHeader.css";

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
  /** The pipeline's bound source name (`Pipeline.sourceDataSourceName`), for display. */
  sourceName: string;
  /** The matching DataSource record, resolved by `Pipeline.sourceDataSourceId`,
   *  for its kind badge. */
  source: DataSource | undefined;
  /** Whether the current user owns the bound source (i.e. `source` is
   *  resolvable in their own owner-scoped `sources.items`). Gates the "Edit
   *  Source" button — see `pipeline-editor-page` spec. */
  canEditSource: boolean;
  /** Navigates to the source's detail view. Only invoked when `canEditSource`
   *  is true (the button is not rendered otherwise). */
  onEditSource: () => void;
  /** The pipeline's bound output DataType name (`Pipeline.outputDataTypeName`). */
  outputTypeName: string;
  /** Whether the current user owns the output DataType (i.e. it is
   *  resolvable in their own owner-scoped `dataTypes.items`). Gates the
   *  "Edit Type" button — see `pipeline-editor-page` spec. */
  canEditType: boolean;
  /** Navigates to the type's detail view. Only invoked when `canEditType` is
   *  true (the button is not rendered otherwise). */
  onEditType: () => void;
  /** The pipeline's current schedule, or `null` if none is set. */
  schedule: PipelineSchedule | null;
  /** Opens PipelineScheduleDialog (create or edit, depending on `schedule`). */
  onEditSchedule: () => void;
  /** Toggles `enabled` without altering kind/expression/timezone. Only
   *  rendered when a schedule exists. */
  onToggleScheduleEnabled: (enabled: boolean) => void;
}

export function PipelineDetailHeader({
  sourceName,
  source,
  canEditSource,
  onEditSource,
  outputTypeName,
  canEditType,
  onEditType,
  schedule,
  onEditSchedule,
  onToggleScheduleEnabled,
}: PipelineDetailHeaderProps) {
  const nextRun = schedule !== null ? formatNextRun(schedule.nextRunAt) : null;

  // design.md D5 — one menu replaces the three per-field edit buttons.
  // Gating is identical to each retired button's own condition; "Edit
  // schedule"/"Set schedule" is always present (mirrors the always-visible
  // button it replaces). Built fresh each render — cheap, and keeps item
  // gating trivially readable next to the JSX it used to live beside.
  const actionItems: ActionsMenuItem[] = [
    ...(canEditSource ? [{ label: "Edit source", onClick: onEditSource }] : []),
    ...(canEditType ? [{ label: "Edit type", onClick: onEditType }] : []),
    { label: schedule === null ? "Set schedule" : "Edit schedule", onClick: onEditSchedule },
  ];

  return (
    <div className="pipeline-detail-header">
      {/* ── Bound source ── */}
      <div className="pipeline-detail-header__group">
        <span className="pipeline-detail-header__group-label">Source</span>
        <div className="pipeline-detail-header__group-value">
          <span className="pipeline-detail-header__source-name">{sourceName}</span>
          {source && (
            <span className="pipeline-detail-header__source-kind">{labelForKind(source.type)}</span>
          )}
        </div>
      </div>

      {/* ── Bound output type ── */}
      <div className="pipeline-detail-header__group">
        <span className="pipeline-detail-header__group-label">Type</span>
        <div className="pipeline-detail-header__group-value">
          <span className="pipeline-detail-header__type-name">{outputTypeName}</span>
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
