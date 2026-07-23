// PipelineScheduleBar — at-a-glance display of the pipeline's schedule state,
// shown between BoundTypeBar and PipelineRiverView on PipelineDetailPage
// (design D1). Mirrors BoundSourceBar/BoundTypeBar's visual structure (label +
// value + right-aligned action button), but adds an inline enabled toggle so
// disabling a schedule doesn't require opening the dialog.
//
// Purely presentational: the parent owns the `schedule` Redux read and the
// dialog's open state, and passes an `onToggleEnabled` callback that dispatches
// `savePipelineSchedule` with the unchanged kind/expression/timezone (see
// `pipeline-schedule-config-ui` spec, "Disabling from the bar").

import type { PipelineSchedule } from "../types/pipelineSchedule";

import "./PipelineScheduleBar.css";

interface PipelineScheduleBarProps {
  /** The pipeline's current schedule, or `null` if none is set. */
  schedule: PipelineSchedule | null;
  /** Opens PipelineScheduleDialog (create or edit, depending on `schedule`). */
  onEditSchedule: () => void;
  /** Toggles `enabled` without altering kind/expression/timezone. Only
   *  rendered when a schedule exists. */
  onToggleEnabled: (enabled: boolean) => void;
}

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

export function PipelineScheduleBar({
  schedule,
  onEditSchedule,
  onToggleEnabled,
}: PipelineScheduleBarProps) {
  if (schedule === null) {
    return (
      <div className="pipeline-detail-page__schedule-bar">
        <span className="pipeline-detail-page__schedule-bar-label">SCHEDULE</span>
        <div className="pipeline-detail-page__schedule-summary">
          <span className="pipeline-detail-page__schedule-empty">No schedule set</span>
        </div>
        <button className="pipeline-detail-page__edit-btn" onClick={onEditSchedule} type="button">
          Set schedule
        </button>
      </div>
    );
  }

  const nextRun = formatNextRun(schedule.nextRunAt);

  return (
    <div className="pipeline-detail-page__schedule-bar">
      <span className="pipeline-detail-page__schedule-bar-label">SCHEDULE</span>
      <div className="pipeline-detail-page__schedule-summary">
        <label className="pipeline-detail-page__schedule-toggle">
          <input
            type="checkbox"
            checked={schedule.enabled}
            onChange={(e) => onToggleEnabled(e.target.checked)}
            aria-label={schedule.enabled ? "Disable schedule" : "Enable schedule"}
          />
        </label>
        <span className="pipeline-detail-page__schedule-expression">
          {formatExpressionSummary(schedule)}
        </span>
        {schedule.enabled && nextRun !== null && (
          <span className="pipeline-detail-page__schedule-next-run">next run {nextRun}</span>
        )}
        {schedule.enabled && nextRun === null && (
          <span className="pipeline-detail-page__schedule-next-run">no next run yet</span>
        )}
        {!schedule.enabled && (
          <span className="pipeline-detail-page__schedule-disabled-badge">Disabled</span>
        )}
      </div>
      <button className="pipeline-detail-page__edit-btn" onClick={onEditSchedule} type="button">
        Edit schedule
      </button>
    </div>
  );
}
