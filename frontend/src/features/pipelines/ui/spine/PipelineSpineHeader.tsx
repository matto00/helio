// PipelineSpineHeader -- HEL-1579 (design.md D3/D4): the desktop page's one compact header row.
// Breadcrumb "Pipelines / <name>" (name in mono, a quiet button that swaps to the existing
// `TextField` with Save / Cancel / the inline discard confirm), the run status chip, rows written and
// last-run time, the schedule chip, Dry run (secondary), Run (the only primary: the accent) and the
// "Pipeline actions" menu. There is no Delete here (owner ruling: Delete lives only on the overview rows).
// The name is not an <h1>: the shell's sr-only <h1> stays the landmark name (DESIGN.md §9).

import { FlaskConical } from "lucide-react";
import { Link } from "react-router-dom";

import { ICON_SIZE } from "../../../../shared/ui/iconSize";

import { ActionsMenu, type ActionsMenuItem } from "../../../../shared/chrome/ActionsMenu";
import { StatusChip } from "../../../../shared/ui/StatusChip";
import { TextField } from "../../../../shared/ui/TextField";
import type { PipelineSchedule } from "../../types/pipelineSchedule";
import { SpineLastRunMeta, SpineRunStatus } from "./SpineRunStatus";
import type { SpineRunState } from "./SpineRunStatus";
import { SpineScheduleChip } from "./SpineScheduleChip";
import "./PipelineSpineHeader.css";

export interface SpineHeaderProps {
  pipelineName: string;
  outputName: string;
  setOutputName: (v: string) => void;
  editingName: boolean;
  setEditingName: (v: boolean) => void;
  isDirty: boolean;
  updateError: string | null;
  updateStatus: string;
  isConfirmingCancel: boolean;
  onSave: () => void;
  onCancel: () => void;
  onConfirmDiscard: () => void;
  onDismissConfirm: () => void;
  run: SpineRunState;
  lastRunAt: string | null;
  lastRunRowCount: number | null;
  lastRunStatus: "succeeded" | "failed" | null;
  lastRunTruncated: boolean | null;
  schedule: PipelineSchedule | null;
  onEditSchedule: () => void;
  onToggleScheduleEnabled: (enabled: boolean) => void;
  onOpenHistory: () => void;
  isOwner: boolean;
  onOpenShare: () => void;
  /** Present only when the pipeline has exactly one resolvable source (HEL-1022: with 2+ sources the
   *  source cards each carry their own Edit item, so a singular one would silently pick). */
  onEditOnlySource: (() => void) | null;
  onDryRun: () => void;
  onRun: () => void;
  /** HEL-1631: the client-only draft. While `hasDraft`, Discard replaces Dry run and Save & run replaces Run. */
  draft: { hasDraft: boolean; saving: boolean; onDiscard: () => void; onSaveAndRun: () => void };
}

export function PipelineSpineHeader(props: SpineHeaderProps) {
  const { pipelineName, outputName, editingName, updateStatus, isConfirmingCancel, schedule, run } =
    props;
  const runBusy = run.runStatus === "queued" || run.runStatus === "running";

  // Built fresh each render: item gating stays readable beside the JSX it used to live next to.
  const items: ActionsMenuItem[] = [
    { label: "Rename", onClick: () => props.setEditingName(true) },
    ...(props.onEditOnlySource ? [{ label: "Edit source", onClick: props.onEditOnlySource }] : []),
    { label: schedule === null ? "Set schedule" : "Edit schedule", onClick: props.onEditSchedule },
    ...(schedule !== null
      ? [
          {
            label: schedule.enabled ? "Pause schedule" : "Resume schedule",
            onClick: () => props.onToggleScheduleEnabled(!schedule.enabled),
          },
        ]
      : []),
    { label: "Run history", onClick: props.onOpenHistory },
    ...(props.isOwner ? [{ label: "Share", onClick: props.onOpenShare }] : []),
  ];

  return (
    <header className="spine-header">
      <nav className="spine-header__crumbs" aria-label="Pipeline path">
        <Link to="/pipelines" className="spine-header__crumb-link">
          Pipelines
        </Link>
        <span className="spine-header__crumb-sep" aria-hidden="true">
          /
        </span>
        {editingName ? (
          <TextField
            className="spine-header__name-input"
            value={outputName}
            aria-label="Pipeline name"
            onChange={(e) => props.setOutputName(e.target.value)}
            onBlur={() => props.setEditingName(false)}
            autoFocus
          />
        ) : (
          <button
            type="button"
            className="spine-header__name"
            onClick={() => props.setEditingName(true)}
            aria-label="Edit pipeline name"
            title={outputName || pipelineName}
          >
            {outputName || pipelineName}
          </button>
        )}
      </nav>

      {props.draft.hasDraft && (
        // DESIGN.md §11: the chip carries an accent dot (the CSS paints it); the words are also its title for the dot-only width.
        <StatusChip
          intent="neutral"
          dot
          className="spine-header__draft"
          title="Draft · unsaved changes"
        >
          <span className="spine-header__draft-text">Draft · unsaved changes</span>
        </StatusChip>
      )}

      {props.isDirty && props.updateError && (
        <span className="spine-header__error" role="alert" aria-label="Save error">
          {props.updateError}
        </span>
      )}

      {props.isDirty && (
        <span className="spine-header__edit-actions">
          <button
            type="button"
            className="spine-header__btn"
            onClick={props.onSave}
            disabled={updateStatus === "loading"}
            aria-label="Save pipeline"
          >
            {updateStatus === "loading" ? "Saving…" : "Save"}
          </button>
          {/* The confirm popover is anchored to Cancel (absolute, out of flow) so it never reflows the
              header row; Cancel stays mounted (invisible) while it shows (HEL F-230). */}
          <span className="spine-header__cancel-wrap">
            <button
              type="button"
              className={`spine-header__btn${isConfirmingCancel ? " spine-header__btn--hidden" : ""}`}
              onClick={props.onCancel}
              aria-label="Cancel changes"
              aria-hidden={isConfirmingCancel}
              tabIndex={isConfirmingCancel ? -1 : undefined}
            >
              Cancel
            </button>
            {isConfirmingCancel && (
              <span
                className="spine-header__confirm"
                role="alertdialog"
                aria-label="Discard unsaved changes"
              >
                <span className="spine-header__confirm-text">Discard changes?</span>
                <button
                  type="button"
                  className="spine-header__btn spine-header__btn--danger"
                  onClick={props.onConfirmDiscard}
                  aria-label="Discard changes"
                >
                  Discard
                </button>
                <button
                  type="button"
                  className="spine-header__btn"
                  onClick={props.onDismissConfirm}
                  aria-label="Keep editing"
                >
                  Keep editing
                </button>
              </span>
            )}
          </span>
        </span>
      )}

      <SpineRunStatus run={run} lastRunStatus={props.lastRunStatus} />
      <SpineLastRunMeta
        lastRunAt={props.lastRunAt}
        lastRunRowCount={props.lastRunRowCount}
        lastRunTruncated={props.lastRunTruncated}
      />

      <div className="spine-header__trailing">
        <SpineScheduleChip schedule={schedule} onOpen={props.onEditSchedule} />
        {props.draft.hasDraft ? (
          <>
            <button
              type="button"
              className="spine-header__btn"
              onClick={props.draft.onDiscard}
              disabled={props.draft.saving}
              aria-label="Discard draft"
            >
              Discard
            </button>
            <button
              type="button"
              className="spine-header__btn spine-header__btn--primary"
              onClick={props.draft.onSaveAndRun}
              disabled={props.draft.saving || runBusy}
              aria-label="Save and run"
            >
              {props.draft.saving ? "Saving…" : "Save & run"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="spine-header__btn"
              onClick={props.onDryRun}
              disabled={runBusy}
              aria-label="Dry run"
              title="Dry run"
            >
              <FlaskConical
                className="spine-header__dry-icon"
                aria-hidden="true"
                size={ICON_SIZE.sm}
              />
              <span className="spine-header__dry-label">Dry run</span>
            </button>
            <button
              type="button"
              className="spine-header__btn spine-header__btn--primary"
              onClick={props.onRun}
              aria-label="Run pipeline"
              disabled={runBusy}
            >
              <span className="spine-header__run-long">Run pipeline</span>
              <span className="spine-header__run-short" aria-hidden="true">
                Run
              </span>
            </button>
          </>
        )}
        <ActionsMenu label="Pipeline actions" items={items} />
      </div>
    </header>
  );
}
