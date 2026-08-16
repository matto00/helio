import { useState } from "react";

import "./RunHistoryModal.css";
import type { AssertionSummary, PipelineRunRecord } from "../types/pipelineStep";
import { Modal } from "../../../shared/ui/Modal";

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function StatusBadge({ status }: { status: PipelineRunRecord["status"] }) {
  const label =
    status === "dry_run"
      ? "Dry run"
      : status === "running"
        ? "Running…"
        : status === "queued"
          ? "Queued…"
          : status;
  return (
    <span className={`run-history-modal__status run-history-modal__status--${status}`}>
      {label}
    </span>
  );
}

const TRIGGER_SOURCE_LABELS: Record<PipelineRunRecord["triggerSource"], string> = {
  manual: "Manual",
  scheduled: "Scheduled",
  external: "External",
};

function TriggerSourceBadge({
  triggerSource,
}: {
  triggerSource: PipelineRunRecord["triggerSource"];
}) {
  return (
    <span className={`run-history-modal__trigger run-history-modal__trigger--${triggerSource}`}>
      {TRIGGER_SOURCE_LABELS[triggerSource]}
    </span>
  );
}

// HEL-576: only rendered when at least one rule was evaluated — a
// zero-valued summary means the pipeline had no `assert` steps at all, and
// showing "0 passed, 0 error, 0 warn" on every ordinary run would be pure
// noise (DESIGN.md §0: "nothing gratuitous").
function AssertionSummaryBadge({ summary }: { summary: AssertionSummary }) {
  const total = summary.passed + summary.warnFailed + summary.errorFailed;
  if (total === 0) return null;
  return (
    <span className="run-history-modal__assertions">
      {summary.passed} passed
      {summary.errorFailed > 0 && (
        <span className="run-history-modal__assertions-error"> · {summary.errorFailed} error</span>
      )}
      {summary.warnFailed > 0 && (
        <span className="run-history-modal__assertions-warn"> · {summary.warnFailed} warn</span>
      )}
    </span>
  );
}

function AssertionFailureList({ summary }: { summary: AssertionSummary }) {
  if (summary.failures.length === 0) return null;
  return (
    <ul className="run-history-modal__assertion-failures">
      {summary.failures.map((failure, idx) => (
        <li
          key={`${failure.kind}-${failure.field ?? ""}-${idx}`}
          className={`run-history-modal__assertion-failure run-history-modal__assertion-failure--${failure.severity}`}
        >
          <span className="run-history-modal__assertion-failure-kind">
            {failure.kind}
            {failure.field ? ` (${failure.field})` : ""}
          </span>
          {failure.message && (
            <span className="run-history-modal__assertion-failure-message">{failure.message}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function RunRow({ run }: { run: PipelineRunRecord }) {
  const [expanded, setExpanded] = useState(false);
  // HEL-576 (design.md Decision 10): broadened from `status === "failed" &&
  // errorLog` alone so a successful run with warn/error assertion failures
  // (or a blocked run whose failing rules are the whole story) can also be
  // expanded.
  const hasFailingAssertions = run.assertions.failures.length > 0;
  const canExpand = (run.status === "failed" && Boolean(run.errorLog)) || hasFailingAssertions;
  return (
    <div className="run-history-modal__row">
      <div className="run-history-modal__row-summary">
        <span className="run-history-modal__row-time">
          {new Date(run.startedAt).toLocaleString()}
        </span>
        <span className="run-history-modal__row-duration">
          {formatDuration(run.startedAt, run.completedAt)}
        </span>
        <span className="run-history-modal__row-count">
          {run.rowCount != null ? `${run.rowCount.toLocaleString()} rows` : "—"}
        </span>
        <StatusBadge status={run.status} />
        <TriggerSourceBadge triggerSource={run.triggerSource} />
        <AssertionSummaryBadge summary={run.assertions} />
        {canExpand && (
          <button
            type="button"
            className="run-history-modal__row-toggle"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? "Hide log" : "Show log"}
          </button>
        )}
      </div>
      {expanded && (
        <>
          {run.errorLog && <pre className="run-history-modal__row-error">{run.errorLog}</pre>}
          <AssertionFailureList summary={run.assertions} />
        </>
      )}
    </div>
  );
}

interface RunHistoryModalProps {
  runs: PipelineRunRecord[];
  onClose: () => void;
}

export function RunHistoryModal({ runs, onClose }: RunHistoryModalProps) {
  return (
    <Modal
      open
      title={`Run history (${runs.length})`}
      size="lg"
      ariaLabel="Run history"
      onClose={onClose}
    >
      <div className="run-history-modal__list">
        {runs.length === 0 ? (
          <p className="run-history-modal__empty">No runs recorded yet.</p>
        ) : (
          runs.map((run) => <RunRow key={run.id} run={run} />)
        )}
      </div>
    </Modal>
  );
}
