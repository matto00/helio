import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";

import { useEffect, useRef, useState } from "react";

import "./RunHistoryModal.css";
import type { PipelineRunRecord } from "../types/models";

interface RunHistoryModalProps {
  runs: PipelineRunRecord[];
  onClose: () => void;
}

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

export function RunHistoryModal({ runs, onClose }: RunHistoryModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function handleClose() {
    dialogRef.current?.close();
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="run-history-modal"
      aria-label="Run history"
      onClose={onClose}
    >
      <div className="run-history-modal__inner">
        <header className="run-history-modal__header">
          <h2 className="run-history-modal__title">Run history ({runs.length})</h2>
          <button
            type="button"
            className="run-history-modal__close"
            aria-label="Close run history"
            onClick={handleClose}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
        </header>
        <div className="run-history-modal__body">
          {runs.length === 0 ? (
            <p className="run-history-modal__empty">No runs recorded yet.</p>
          ) : (
            runs.map((run) => <RunRow key={run.id} run={run} />)
          )}
        </div>
      </div>
    </dialog>
  );
}
