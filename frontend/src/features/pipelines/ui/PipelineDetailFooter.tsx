// PipelineDetailFooter — the single footer region shown on the
// PipelineDetailPage. Renders the last-run metadata (when present), the
// output-name editor, step count + live run status, dirty-state save/cancel
// buttons (with inline discard-confirm), and the always-visible dry-run/
// run-pipeline buttons.
//
// Extracted from `./PipelineDetailPage.tsx` as part of CS3 cycle 2 — purely
// to keep the parent file under the 400L hard cap. All wiring is preserved.
//
// HEL-719: absorbed the owner-only Share button and the last-run metadata bar
// (formerly two separate strips rendered below this footer) so the page has
// exactly one footer region — see design.md D3.
//
// "Dry run"/"Run pipeline" stay plain, always-visible buttons at every
// viewport, 430px included.
//
// This footer no longer owns an actions menu. "Run history"/"Preview"/"Share"
// (formerly a second `ActionsMenu` here, design.md D7) moved into
// `PipelineDetailHeader`'s menu: once the header stacks at <=1100px the two
// unlabeled kebabs read as the same control repeated, with nothing to
// distinguish which holds what. The page has exactly one actions menu now.

import type { RunStatusEventData } from "../hooks/usePipelineRunEvents";
import type { SchemaField } from "../types/pipelineStep";
import { StatusChip } from "../../../shared/ui/StatusChip";
import { TextField } from "../../../shared/ui/TextField";
import { formatRelativeTime } from "../../../utils/formatRelativeTime";

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
  /** The pipeline's real final-step output schema (HEL-404's
   *  `getAnalyzeOutputSchema`, keyed to the last step) — `[]` while the
   *  pipeline has no steps or /analyze hasn't returned yet. */
  outputSchema: SchemaField[];
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
  handleDryRun: () => void;
  handleRunPipeline: () => void;
  /** Persisted last-run metadata from `currentPipeline` — rendered as a top
   *  row inside this footer only when `lastRunAt` is non-null (spec:
   *  "PipelineDetailPage shows persistent last-run metadata bar"). */
  lastRunAt: string | null;
  lastRunRowCount: number | null;
  lastRunStatus: "succeeded" | "failed" | null;
}

export function PipelineDetailFooter({
  editingOutputName,
  outputName,
  pipelineName,
  setOutputName,
  setEditingOutputName,
  stepCount,
  outputSchema,
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
  handleDryRun,
  handleRunPipeline,
  lastRunAt,
  lastRunRowCount,
  lastRunStatus,
}: PipelineDetailFooterProps) {
  return (
    <div className="pipeline-detail-page__footer-region">
      {lastRunAt != null && (
        <div className="pipeline-detail-page__meta-bar" aria-label="Last run metadata">
          <span className="pipeline-detail-page__meta-bar-item">
            <span className="pipeline-detail-page__meta-bar-label">Last run:</span>{" "}
            {formatRelativeTime(lastRunAt)}
          </span>
          {lastRunRowCount != null && (
            <span className="pipeline-detail-page__meta-bar-item">
              <span className="pipeline-detail-page__meta-bar-label">Rows written:</span>{" "}
              {lastRunRowCount.toLocaleString()}
            </span>
          )}
          {lastRunStatus != null && (
            <StatusChip intent={lastRunStatus === "succeeded" ? "success" : "error"}>
              {lastRunStatus === "succeeded" ? "Succeeded" : "Failed"}
            </StatusChip>
          )}
        </div>
      )}
      <div className="pipeline-detail-page__footer">
        <div className="pipeline-detail-page__footer-left">
          {/* This edits `currentPipeline.name` (handleSave →
           *  `updatePipeline({ id, name: outputName })`) — i.e. the pipeline's
           *  own name, not the bound output DataType's name. Labeled
           *  "PIPELINE" (not "OUTPUT") so it isn't mistaken for the schema
           *  label immediately to its right. Accessible name (aria-label)
           *  renamed to match ("Pipeline name" / "Edit pipeline name") —
           *  formerly "(Edit) output name", which drifted from the visible
           *  label once it changed. PipelineDetailPage.test.tsx's assertions
           *  were updated alongside this (see crossPackageRequests). */}
          <span className="pipeline-detail-page__footer-output-label">PIPELINE</span>
          {editingOutputName ? (
            <TextField
              className="pipeline-detail-page__footer-output-input"
              value={outputName}
              aria-label="Pipeline name"
              onChange={(e) => setOutputName(e.target.value)}
              onBlur={() => setEditingOutputName(false)}
              autoFocus
            />
          ) : (
            <button
              type="button"
              className="pipeline-detail-page__footer-output-name"
              onClick={() => setEditingOutputName(true)}
              aria-label="Edit pipeline name"
            >
              {outputName || pipelineName}
            </button>
          )}
          <span className="pipeline-detail-page__footer-output-label">OUTPUT</span>
          <span className="pipeline-detail-page__footer-schema">
            {outputSchema.length > 0 ? (
              outputSchema.map((field) => (
                <span key={field.name} className="pipeline-detail-page__footer-schema-chip">
                  {field.name}
                </span>
              ))
            ) : (
              <em className="pipeline-detail-page__footer-inferred">no output yet</em>
            )}
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
              {/* F-230: the confirm popover is anchored to the Cancel button
                (position: absolute, out of flex flow) instead of swapping in
                as a wider inline flex sibling, so appearing/dismissing it
                never grows or reflows the footer-right row. The Cancel
                button itself stays mounted (invisible, not display:none) so
                the wrap keeps its normal box size and tab order. */}
              <span className="pipeline-detail-page__cancel-wrap">
                <button
                  type="button"
                  className={
                    isConfirmingCancel
                      ? "pipeline-detail-page__cancel-btn pipeline-detail-page__cancel-btn--hidden"
                      : "pipeline-detail-page__cancel-btn"
                  }
                  onClick={handleCancel}
                  aria-label="Cancel changes"
                  aria-hidden={isConfirmingCancel}
                  tabIndex={isConfirmingCancel ? -1 : undefined}
                >
                  Cancel
                </button>
                {isConfirmingCancel && (
                  <span
                    className="pipeline-detail-page__cancel-confirm"
                    role="alertdialog"
                    aria-label="Discard unsaved changes"
                  >
                    <span className="pipeline-detail-page__cancel-confirm-text">
                      Discard changes?
                    </span>
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
                )}
              </span>
            </>
          )}
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
    </div>
  );
}
