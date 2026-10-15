// SpineScheduleChip -- HEL-1579 (design.md D4): the header's schedule chip. "Add schedule" when there is
// none; otherwise the expression summary and "next <relative>" with a muted "Paused" marker when
// disabled. Clicking opens `PipelineScheduleDialog`. Enable/disable moved to the overflow menu.

import { CalendarClock } from "lucide-react";

import { ICON_SIZE } from "../../../../shared/ui/iconSize";
import { formatNextRun } from "../../../../app/shell/formatNextRun";
import type { PipelineSchedule } from "../../types/pipelineSchedule";

export function SpineScheduleChip({
  schedule,
  onOpen,
}: {
  schedule: PipelineSchedule | null;
  onOpen: () => void;
}) {
  if (schedule === null) {
    return (
      <button
        type="button"
        className="spine-header__chip"
        aria-label="Add schedule"
        title="Add schedule"
        onClick={onOpen}
      >
        <CalendarClock className="spine-header__chip-icon" aria-hidden="true" size={ICON_SIZE.sm} />
        <span className="spine-header__chip-text">Add schedule</span>
      </button>
    );
  }
  const expression =
    schedule.kind === "interval" ? `Every ${schedule.expression}` : schedule.expression;
  const next = formatNextRun(schedule.nextRunAt);
  return (
    <button
      type="button"
      className={`spine-header__chip${schedule.enabled ? "" : " spine-header__chip--paused"}`}
      aria-label={schedule.enabled ? "Edit schedule" : "Edit schedule, paused"}
      title={`${expression} · ${
        schedule.enabled ? (next !== null ? `next run ${next}` : "no next run yet") : "paused"
      }`}
      onClick={onOpen}
    >
      <CalendarClock className="spine-header__chip-icon" aria-hidden="true" size={ICON_SIZE.sm} />
      <span className="spine-header__chip-text">{expression}</span>
      {schedule.enabled ? (
        <span className="spine-header__chip-sub spine-header__chip-sub--next">
          {next !== null ? `next ${next}` : "no next run yet"}
        </span>
      ) : (
        <span className="spine-header__chip-sub spine-header__chip-sub--paused">Paused</span>
      )}
    </button>
  );
}
