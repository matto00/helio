import type { HomePipeline, HomeRun, HomeRunStatus } from "../types/homeSummary";
import { formatClock } from "./timelineScale";

export type MarkStatus = HomeRunStatus | "scheduled";

/** One point on a pipeline's row: a past/live run or a projected schedule fire. */
export interface TimelineMark {
  key: string;
  status: MarkStatus;
  time: number;
  run: HomeRun | null;
}

/** A pipeline's marks in ascending time order: its runs plus its upcoming fires. */
export function buildMarks(pipeline: HomePipeline): TimelineMark[] {
  const runs: TimelineMark[] = pipeline.runs.map((run) => ({
    key: `${pipeline.pipelineId}:run:${run.runId}`,
    status: run.status,
    time: Date.parse(run.startedAt),
    run,
  }));
  const fires: TimelineMark[] = pipeline.upcoming.map((at, index) => ({
    key: `${pipeline.pipelineId}:fire:${index}:${at}`,
    status: "scheduled",
    time: Date.parse(at),
    run: null,
  }));
  return [...runs, ...fires].sort((a, b) => a.time - b.time);
}

export const STATUS_WORD: Record<MarkStatus, string> = {
  succeeded: "succeeded",
  failed: "failed",
  queued: "queued",
  running: "running",
  scheduled: "scheduled",
};

/** The first line of an error log, for a label that stays one sentence long. */
export function firstLine(text: string | null): string | null {
  if (text === null) return null;
  const line = text.split("\n").find((candidate) => candidate.trim().length > 0);
  return line === undefined ? null : line.trim();
}

/** "orders-sync, failed, 03:10, source returned 0 rows": the mark's whole accessible name (name, status, local
 *  time, and the error for a failed run). */
export function markLabel(pipelineName: string, mark: TimelineMark): string {
  const parts = [pipelineName, STATUS_WORD[mark.status], formatClock(mark.time)];
  const error = mark.status === "failed" ? firstLine(mark.run?.errorLog ?? null) : null;
  if (error !== null) parts.push(error);
  return parts.join(", ");
}

/** "2m 05s" style duration of a finished run, or null while it is still going. */
export function runDuration(run: HomeRun): string | null {
  if (run.completedAt === null) return null;
  const seconds = Math.max(
    0,
    Math.round((Date.parse(run.completedAt) - Date.parse(run.startedAt)) / 1000),
  );
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export interface MarkPosition {
  row: number;
  col: number;
}

/** Roving-tabindex navigation over rows of marks (DESIGN.md §8): Left/Right within a row, Up/Down to the
 *  nearest-in-time mark of the adjacent row that has marks, Home/End to a row's ends. Returns null when the key
 *  does not move focus (an edge, or a key that is not a navigation key). */
export function nextMarkPosition(
  rows: readonly (readonly TimelineMark[])[],
  from: MarkPosition,
  key: string,
): MarkPosition | null {
  const current = rows[from.row]?.[from.col];
  if (current === undefined) return null;
  const rowLength = rows[from.row].length;
  switch (key) {
    case "ArrowRight":
      return from.col + 1 < rowLength ? { row: from.row, col: from.col + 1 } : null;
    case "ArrowLeft":
      return from.col > 0 ? { row: from.row, col: from.col - 1 } : null;
    case "Home":
      return from.col === 0 ? null : { row: from.row, col: 0 };
    case "End":
      return from.col === rowLength - 1 ? null : { row: from.row, col: rowLength - 1 };
    case "ArrowDown":
    case "ArrowUp": {
      const step = key === "ArrowDown" ? 1 : -1;
      for (let row = from.row + step; row >= 0 && row < rows.length; row += step) {
        if (rows[row].length === 0) continue;
        let best = 0;
        rows[row].forEach((mark, col) => {
          if (Math.abs(mark.time - current.time) < Math.abs(rows[row][best].time - current.time))
            best = col;
        });
        return { row, col: best };
      }
      return null;
    }
    default:
      return null;
  }
}

/** Run and failure counts plus the next fire, for the single-control row used on coarse pointers and phones. */
export function disclosureLabel(pipeline: HomePipeline): string {
  const runs = pipeline.runs.length + pipeline.runsOmitted;
  const failed = pipeline.runs.filter((run) => run.status === "failed").length;
  const runPart = `${runs} ${runs === 1 ? "run" : "runs"}`;
  const failedPart = failed === 0 ? "none failed" : `${failed} failed`;
  const next = pipeline.upcoming[0];
  const nextPart =
    next === undefined ? "nothing scheduled" : `next ${formatClock(Date.parse(next))}`;
  return `${pipeline.name}, ${runPart}, ${failedPart}, ${nextPart}`;
}
