import { useState } from "react";

import "./RunHistoryModal.css";
import type { PipelineRunRecord } from "../types/pipelineStep";
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

function RunRow({ run }: { run: PipelineRunRecord }) {
  const [expanded, setExpanded] = useState(false);
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
        {run.status === "failed" && run.errorLog && (
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
      {expanded && run.errorLog && (
        <pre className="run-history-modal__row-error">{run.errorLog}</pre>
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
