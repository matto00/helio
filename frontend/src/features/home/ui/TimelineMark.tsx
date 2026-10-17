import type { HomeRun } from "../types/homeSummary";
import {
  firstLine,
  runDuration,
  STATUS_WORD,
  type MarkStatus,
  type TimelineMark as Mark,
} from "../utils/timelineMarks";
import { formatClock } from "../utils/timelineScale";

/** The shape that distinguishes a status by more than hue (DESIGN.md §8): succeeded a filled circle, failed a
 *  filled diamond, queued/running a ring with a centre dot, scheduled a hollow ring. */
export function MarkShape({ status }: { status: MarkStatus }) {
  return (
    <span
      className={`tl-shape tl-shape--${status === "queued" ? "running" : status}`}
      aria-hidden="true"
    />
  );
}

const TRIGGER_WORD: Record<string, string> = {
  manual: "Manual",
  scheduled: "Scheduled",
  external: "External",
  auto: "Auto",
};

function triggerWord(source: string): string {
  return TRIGGER_WORD[source] ?? source;
}

/** The hover/focus details of one mark: status, start, duration, rows, trigger and (failed) error. */
export function MarkDetails({
  pipelineName,
  mark,
  id,
}: {
  pipelineName: string;
  mark: Mark;
  id: string;
}) {
  const run: HomeRun | null = mark.run;
  const error = run?.status === "failed" ? firstLine(run.errorLog) : null;
  return (
    <span role="tooltip" id={id} className="tl-tip">
      <span className="tl-tip__title">{pipelineName}</span>
      <span className="tl-tip__row">
        {STATUS_WORD[mark.status]} · {formatClock(mark.time)}
        {run !== null && runDuration(run) !== null ? ` · ${runDuration(run)}` : ""}
      </span>
      {run !== null ? (
        <span className="tl-tip__row">
          {run.rowCount !== null ? `${run.rowCount} rows · ` : ""}
          {triggerWord(run.triggerSource)}
        </span>
      ) : (
        <span className="tl-tip__row">Next scheduled run</span>
      )}
      {error !== null ? <span className="tl-tip__error">{error}</span> : null}
    </span>
  );
}
