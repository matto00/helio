// PipelineDetailFooter — the bottom action bar shown on the PipelineDetailPage.
// Renders the output-name editor, step count + live run status, dirty-state
// save/cancel buttons (with inline discard-confirm), and the run-history /
// preview / dry-run / run-pipeline action buttons.
//
// Extracted from `./PipelineDetailPage.tsx` as part of CS3 cycle 2 — purely
// to keep the parent file under the 400L hard cap. All wiring is preserved.

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faClockRotateLeft } from "@fortawesome/free-solid-svg-icons";

import type { RunStatusEventData } from "../hooks/usePipelineRunEvents";

interface SseLike {
  status: RunStatusEventData["status"] | null;
  rowCount: number | null;
  errorLog: string | null;
}

interface PipelineDetailFooterProps {
  editingOutputName: boolean;
  outputName: string;
  pipelineName: string;
  setOutputName: (v: string) => void;
  setEditingOutputName: (v: boolean) => void;
  stepCount: number;
  sseData: SseLike;
  runStatus: string | null;
  runError: string | null;
  runIsDry: boolean | null;
  runResult: Record<string, unknown>[] | null;
  isDirty: boolean;
  updateError: string | null;
  updateStatus: string;
  isConfirmingCancel: boolean;
  handleSave: () => void;
  confirmCancelDiscard: () => void;
  dismissCancelConfirm: () => void;
  handleCancel: () => void;
  runHistoryCount: number;
  openHistory: () => void;
  openPreview: () => void;
  handleDryRun: () => void;
  handleRunPipeline: () => void;
}

export function PipelineDetailFooter({
  editingOutputName,
  outputName,
  pipelineName,
  setOutputName,
  setEditingOutputName,
  stepCount,
  sseData,
  runStatus,
  runError,
  runIsDry,
  runResult,
  isDirty,
  updateError,
  updateStatus,
  isConfirmingCancel,
  handleSave,
  confirmCancelDiscard,
  dismissCancelConfirm,
  handleCancel,
  runHistoryCount,
  openHistory,
  openPreview,
  handleDryRun,
  handleRunPipeline,
}: PipelineDetailFooterProps) {
  return (
    <div className="pipeline-detail-page__footer">
      <div className="pipeline-detail-page__footer-left">
        <span className="pipeline-detail-page__footer-output-label">OUTPUT</span>
        {editingOutputName ? (
          <input
            className="pipeline-detail-page__footer-output-input"
            value={outputName}
            aria-label="Output name"
            onChange={(e) => setOutputName(e.target.value)}
            onBlur={() => setEditingOutputName(false)}
            autoFocus
          />
        ) : (
          <button
            type="button"
            className="pipeline-detail-page__footer-output-name"
            onClick={() => setEditingOutputName(true)}
            aria-label="Edit output name"
          >
            {outputName || pipelineName}
          </button>
        )}
        <span className="pipeline-detail-page__footer-schema">
          <span className="pipeline-detail-page__footer-schema-chip">id</span>
          <span className="pipeline-detail-page__footer-schema-chip">name</span>
          <span className="pipeline-detail-page__footer-schema-chip">value</span>
          <em className="pipeline-detail-page__footer-inferred">inferred</em>
        </span>
      </div>
      <div className="pipeline-detail-page__footer-right">
        <span className="pipeline-detail-page__footer-stats">
          {stepCount} step{stepCount !== 1 ? "s" : ""}
        </span>
        {(sseData.status !== null || runStatus !== null) &&
          (() => {
            const displayStatus = sseData.status ?? runStatus;
            const displayRowCount =
              sseData.rowCount !== null ? sseData.rowCount : (runResult ?? []).length;
            const displayErrorLog = sseData.errorLog ?? runError;
            return (
              <span
                className={`pipeline-detail-page__run-status pipeline-detail-page__run-status--${displayStatus}`}
                aria-label={`Run status: ${displayStatus}`}
              >
                {displayStatus === "queued" && "Queued…"}
                {displayStatus === "running" && "Running…"}
                {displayStatus === "succeeded" &&
                  (runIsDry
                    ? `Preview: ${displayRowCount} rows`
                    : `Snapshot replaced: ${displayRowCount} rows`)}
                {displayStatus === "dry_run" && `Preview: ${displayRowCount} rows`}
                {displayStatus === "failed" &&
                  `Failed${displayErrorLog ? `: ${displayErrorLog}` : ""}`}
              </span>
            );
          })()}
        {isDirty && (
          <>
            {updateError && (
              <span
                className="pipeline-detail-page__update-error"
                role="alert"
                aria-label="Save error"
              >
                {updateError}
              </span>
            )}
            <button
              type="button"
              className="pipeline-detail-page__save-btn"
              onClick={handleSave}
              disabled={updateStatus === "loading"}
              aria-label="Save pipeline"
            >
              {updateStatus === "loading" ? "Saving…" : "Save"}
            </button>
            {isConfirmingCancel ? (
              <span
                className="pipeline-detail-page__cancel-confirm"
                role="alertdialog"
                aria-label="Discard unsaved changes"
              >
                <span className="pipeline-detail-page__cancel-confirm-text">Discard changes?</span>
                <button
                  type="button"
                  className="pipeline-detail-page__cancel-confirm-btn pipeline-detail-page__cancel-confirm-btn--danger"
                  onClick={confirmCancelDiscard}
                  aria-label="Discard changes"
                >
                  Discard
                </button>
                <button
                  type="button"
                  className="pipeline-detail-page__cancel-confirm-btn"
                  onClick={dismissCancelConfirm}
                  aria-label="Keep editing"
                >
                  Keep editing
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="pipeline-detail-page__cancel-btn"
                onClick={handleCancel}
                aria-label="Cancel changes"
              >
                Cancel
              </button>
            )}
          </>
        )}
        <button
          type="button"
          className="pipeline-detail-page__history-btn"
          onClick={openHistory}
          aria-label="Open run history"
        >
          <FontAwesomeIcon icon={faClockRotateLeft} /> Run history ({runHistoryCount})
        </button>
        <button type="button" className="pipeline-detail-page__preview-btn" onClick={openPreview}>
          Preview
        </button>
        <button
          type="button"
          className="pipeline-detail-page__dry-run-btn"
          onClick={handleDryRun}
          disabled={runStatus === "queued" || runStatus === "running"}
          aria-label="Dry run"
        >
          Dry run
        </button>
        <button
          type="button"
          className="pipeline-detail-page__run-btn"
          onClick={handleRunPipeline}
          disabled={runStatus === "queued" || runStatus === "running"}
        >
          Run pipeline
        </button>
      </div>
    </div>
  );
}
