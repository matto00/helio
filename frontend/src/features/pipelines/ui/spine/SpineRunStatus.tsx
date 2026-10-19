// SpineRunStatus + SpineLastRunMeta -- HEL-1579 (design.md D3): the header's run status chip and
// "N rows written · <relative>" metadata, moved from the footer with the same text and accessible names.
// The in-session status (SSE / redux) wins; otherwise the persisted latest run's Succeeded/Failed chip.

import { StatusChip } from "../../../../shared/ui/StatusChip";
import { formatRelativeTime } from "../../../../utils/formatRelativeTime";
import type { RunStatusEventData } from "../../hooks/usePipelineRunEvents";
import { TruncatedRowCountBadge } from "../TruncatedRowCountBadge";

export interface SpineRunState {
  sseStatus: RunStatusEventData["status"] | null;
  sseRowCount: number | null;
  sseErrorLog: string | null;
  runStatus: string | null;
  runError: string | null;
  runIsDry: boolean | null;
  runResult: Record<string, unknown>[] | null;
}

export function SpineRunStatus({
  run,
  lastRunStatus,
}: {
  run: SpineRunState;
  lastRunStatus: "succeeded" | "failed" | null;
}) {
  const displayStatus = run.sseStatus ?? run.runStatus;
  if (displayStatus !== null) {
    const displayRowCount =
      run.sseRowCount !== null ? run.sseRowCount : (run.runResult ?? []).length;
    const displayErrorLog = run.sseErrorLog ?? run.runError;
    return (
      <span
        className={`spine-header__run-status spine-header__run-status--${displayStatus}`}
        aria-label={`Run status: ${displayStatus}`}
        // The label ellipsizes in a narrow header; a failed run's full error stays reachable here (HEL-1582).
        title={displayStatus === "failed" && displayErrorLog ? displayErrorLog : undefined}
      >
        {displayStatus === "queued" && "Queued…"}
        {displayStatus === "running" && "Running…"}
        {displayStatus === "succeeded" &&
          (run.runIsDry
            ? `Preview: ${displayRowCount} rows`
            : `Snapshot replaced: ${displayRowCount} rows`)}
        {displayStatus === "dry_run" && `Preview: ${displayRowCount} rows`}
        {displayStatus === "failed" && `Failed${displayErrorLog ? `: ${displayErrorLog}` : ""}`}
      </span>
    );
  }
  // The wire omits a null field (spray-json drops `None`), so absent reads as `undefined`, not `null`.
  if (lastRunStatus == null) return null;
  return (
    // Narrow desktop shows only the dot: the label becomes visually hidden (still its accessible name).
    <StatusChip intent={lastRunStatus === "succeeded" ? "success" : "error"} dot>
      <span className="spine-header__status-label">
        {lastRunStatus === "succeeded" ? "Succeeded" : "Failed"}
      </span>
    </StatusChip>
  );
}

export function SpineLastRunMeta({
  lastRunAt,
  lastRunRowCount,
  lastRunTruncated,
}: {
  lastRunAt: string | null;
  lastRunRowCount: number | null;
  lastRunTruncated: boolean | null;
}) {
  if (lastRunAt == null) return null;
  const full = `${lastRunRowCount != null ? `${lastRunRowCount.toLocaleString()} rows written · ` : ""}${formatRelativeTime(lastRunAt)}${
    lastRunTruncated === true && lastRunRowCount != null ? " · Partial (row cap reached)" : ""
  }`;
  return (
    // In a narrow header the row-count part drops out whole (never cut); the full figures stay in the title.
    <span className="spine-header__meta" aria-label="Last run metadata" title={full}>
      {/* The row count is shown whole or not at all; the relative time never shrinks away (HEL-1668). */}
      <span className="spine-header__meta-text">
        {lastRunRowCount != null && (
          <>
            <span className="spine-header__meta-count">{`${lastRunRowCount.toLocaleString()} rows written ·`}</span>{" "}
          </>
        )}
        <span className="spine-header__meta-time">{formatRelativeTime(lastRunAt)}</span>
      </span>
      {/* HEL-873: icon + text, never colour alone; complete and not-recorded both render nothing. */}
      {lastRunTruncated === true && lastRunRowCount != null && <TruncatedRowCountBadge />}
    </span>
  );
}
