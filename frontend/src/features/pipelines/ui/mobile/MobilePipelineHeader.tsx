// MobilePipelineHeader -- HEL-1582 (design.md D2): the phone pipeline page's compact header. Row 1: a back link to
// the pipelines list, the pipeline name (mono, one line, ellipsized, full name in its title; not a heading, the
// shell's sr-only <h1> stays the landmark) and the "Pipeline actions" menu. Row 2: one status line -- run status,
// rows written and relative time (or the live run state), then the schedule state. Rename swaps the name for the
// "Pipeline name" field with Save / Cancel / the discard confirmation on a row of its own, with the same handlers
// the desktop header uses.

import { ChevronLeft } from "lucide-react";
import { Link } from "react-router-dom";

import { ActionsMenu, type ActionsMenuItem } from "../../../../shared/chrome/ActionsMenu";
import { ICON_SIZE } from "../../../../shared/ui/iconSize";
import { TextField } from "../../../../shared/ui/TextField";
import type { PipelinePageState } from "../spine/PipelineSpineLayout";
import { SpineLastRunMeta, SpineRunStatus } from "../spine/SpineRunStatus";
import { SpineScheduleChip } from "../spine/SpineScheduleChip";
import type { SpineStepActions } from "../spine/useSpineStepActions";
import "../spine/PipelineSpineHeader.css";
import "./PipelineMobile.css";

export function MobilePipelineHeader({
  page,
  actions,
}: {
  page: PipelinePageState;
  actions: SpineStepActions;
}) {
  const { currentPipeline, pipelineSchedule: schedule, roots } = page;
  if (currentPipeline === null) return null;
  const displayName = page.outputName || page.pipelineName;
  const onlyRootSource = roots.length === 1 ? page.sourceByRootId[roots[0].id] : undefined;
  const hasSteps = page.steps.length > 0;
  const lastTrunkStepId = hasSteps
    ? page.laneGraph.lanes
        .find((l) => l.parentStepId === undefined && l.rootId === roots[0]?.id)
        ?.steps.at(-1)?.id
    : undefined;

  const items: ActionsMenuItem[] = [
    { label: "Rename", onClick: () => page.setEditingOutputName(true) },
    ...(onlyRootSource
      ? [{ label: "Edit source", onClick: () => page.handleEditSource(onlyRootSource.id) }]
      : []),
    { label: "Add source", onClick: actions.openAddRoot },
    {
      label: "Add Outputs from a shape",
      onClick: () => actions.openShapePicker(lastTrunkStepId),
    },
    {
      label: schedule === null ? "Set schedule" : "Edit schedule",
      onClick: () => page.setScheduleOpen(true),
    },
    ...(schedule !== null
      ? [
          {
            label: schedule.enabled ? "Pause schedule" : "Resume schedule",
            onClick: () => page.handleToggleScheduleEnabled(!schedule.enabled),
          },
        ]
      : []),
    ...(page.isOwner ? [{ label: "Share", onClick: () => page.setShareOpen(true) }] : []),
  ];

  // Save / Cancel show while the name differs from the loaded one (as on the desktop header).
  const showEditRow = page.isDirty;
  const inSessionStatus = page.sseData.status ?? page.runStatus;

  return (
    <header className="mobile-header">
      <div className="mobile-header__row">
        <Link to="/pipelines" className="mobile-header__back" aria-label="Back to pipelines">
          <ChevronLeft aria-hidden="true" size={ICON_SIZE.md} />
        </Link>
        {page.editingOutputName ? (
          <TextField
            className="mobile-header__name-input"
            value={page.outputName}
            aria-label="Pipeline name"
            onChange={(e) => page.setOutputName(e.target.value)}
            onBlur={() => page.setEditingOutputName(false)}
            autoFocus
          />
        ) : (
          <span className="mobile-header__name" title={displayName}>
            {displayName}
          </span>
        )}
        <ActionsMenu label="Pipeline actions" items={items} />
      </div>

      {showEditRow && (
        <div className="mobile-header__edit">
          {page.isDirty && page.updateError && (
            <span className="mobile-header__error" role="alert" aria-label="Save error">
              {page.updateError}
            </span>
          )}
          {page.isConfirmingCancel ? (
            <span
              className="mobile-header__confirm"
              role="alertdialog"
              aria-label="Discard unsaved changes"
            >
              <span className="mobile-header__confirm-text">Discard changes?</span>
              <button
                type="button"
                className="mobile-btn mobile-btn--danger"
                onClick={page.confirmCancelDiscard}
                aria-label="Discard changes"
              >
                Discard
              </button>
              <button
                type="button"
                className="mobile-btn"
                onClick={page.dismissCancelConfirm}
                aria-label="Keep editing"
              >
                Keep editing
              </button>
            </span>
          ) : (
            <>
              <button
                type="button"
                className="mobile-btn"
                onClick={() => void page.handleSave()}
                disabled={page.updateStatus === "loading"}
                aria-label="Save pipeline"
              >
                {page.updateStatus === "loading" ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="mobile-btn"
                onClick={page.handleCancel}
                aria-label="Cancel changes"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      <div className="mobile-header__status">
        {/* ONE line for the run status and the last-run meta: it ellipsizes (the full figures are in the meta's
            title and in the Runs tab's latest row), so the status line stays at two lines with the schedule chip
            on the second. Empty when there is nothing to show (CSS hides it). */}
        <div className="mobile-header__runline">
          <SpineRunStatus
            run={{
              sseStatus: page.sseData.status,
              sseRowCount: page.sseData.rowCount,
              sseErrorLog: page.sseData.errorLog,
              runStatus: page.runStatus,
              runError: page.runError,
              runIsDry: page.runIsDry,
              runResult: page.runResult,
            }}
            lastRunStatus={currentPipeline.lastRunStatus}
          />
          {/* While an in-session status shows, the persisted "N rows written" is stale and redundant; showing both
              wraps the status line to a third line at 375 and pushes the Output card under the action bar. */}
          {inSessionStatus === null && (
            <SpineLastRunMeta
              lastRunAt={currentPipeline.lastRunAt}
              lastRunRowCount={currentPipeline.lastRunRowCount}
              lastRunTruncated={currentPipeline.lastRunTruncated ?? null}
            />
          )}
        </div>
        <SpineScheduleChip schedule={schedule} onOpen={() => page.setScheduleOpen(true)} />
      </div>
    </header>
  );
}
