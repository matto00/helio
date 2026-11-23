import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { NavigateFunction } from "react-router-dom";

import { getSessionEpoch } from "../../../shared/session/sessionEpoch";
import type { useAppDispatch } from "../../../hooks/reduxHooks";
import { previewOutput } from "../state/outputsSlice";
import { submitPipelineRun, updatePipeline } from "../state/pipelinesSlice";
import type { Output } from "../types/output";
import type { PipelineRunRole } from "./usePipelineRunRole";
import { useRunToUpdate } from "./useRunToUpdate";
import type { useRunHistory } from "./useRunHistory";

type UsePipelineRunAndSaveActionsArgs = {
  id: string | undefined;
  dispatch: ReturnType<typeof useAppDispatch>;
  navigate: NavigateFunction;
  setSseActive: Dispatch<SetStateAction<boolean>>;
  allOutputsRef: MutableRefObject<Output[]>;
  refreshRunHistoryAfterRun: ReturnType<typeof useRunHistory>["refreshRunHistoryAfterRun"];
  outputName: string;
  isDirty: boolean;
  setIsConfirmingCancel: Dispatch<SetStateAction<boolean>>;
  /** HEL-1661: a viewer cannot run; the handlers return early for one (their run entries are not rendered either). */
  runRole: PipelineRunRole;
  /** HEL-1794: false for a viewer or an unknown role: the rename save returns at once. */
  canEdit: boolean;
};

/**
 * The run, dry-run, save and cancel handlers extracted from `usePipelineDetailPage` (HEL-1478 D3,
 * C9), with the post-run Output preview refresh they share.
 */
export function usePipelineRunAndSaveActions({
  id,
  dispatch,
  navigate,
  setSseActive,
  allOutputsRef,
  refreshRunHistoryAfterRun,
  outputName,
  isDirty,
  setIsConfirmingCancel,
  runRole,
  canEdit,
}: UsePipelineRunAndSaveActionsArgs) {
  const mayRun = runRole !== "viewer";
  // HEL-908 Cycle 13 -- `submitPipelineRun`'s own HTTP response already
  // carries the finished run's result (it's a synchronous POST, not a
  // fire-and-forget kickoff); the SSE stream (`usePipelineRunEvents`) is a
  // best-effort progress channel layered on top, and `PipelineDetailFooter`'s
  // "Run status" label already falls back to this thunk's own status the
  // moment it resolves (`sseData.status ?? runStatus`) rather than waiting
  // on an SSE terminal event. A probe run confirmed the SSE `onTerminal`
  // callback (in `usePipelineRunStream.ts`) can fire well
  // after this thunk already resolved, or not at all within a normal dry
  // run's lifetime in dev -- so it alone is not a reliable trigger for
  // refreshing rail-chip previews. This dispatches the refresh right where
  // the run is actually known to be done; the SSE `onTerminal` handler (in `usePipelineRunStream.ts`)
  // still does the same thing too, for the one case this can't cover (a run
  // that was already in flight when the page mounted, submitted from
  // elsewhere).
  const refreshVisibleOutputPreviews = useCallback(
    (targetPipelineId: string, outputIds?: readonly string[]) => {
      // `outputIds` is the just-saved definition's Outputs: `allOutputsRef` still holds the pre-save list on that tick.
      const ids = outputIds ?? allOutputsRef.current.map((o) => o.id);
      for (const outputId of ids) {
        void dispatch(previewOutput({ pipelineId: targetPipelineId, outputId }));
      }
    },
    [dispatch, allOutputsRef],
  );

  const handleRunPipeline = useCallback(async () => {
    if (!id || !mayRun) return;
    setSseActive(true);
    const startEpoch = getSessionEpoch();
    try {
      await dispatch(submitPipelineRun({ pipelineId: id })).unwrap();
      if (getSessionEpoch() !== startEpoch) return;
      refreshRunHistoryAfterRun();
      refreshVisibleOutputPreviews(id);
    } catch {
      setSseActive(false);
      // runError is displayed via Redux state
    }
  }, [dispatch, id, mayRun, setSseActive, refreshVisibleOutputPreviews, refreshRunHistoryAfterRun]);

  const handleDryRun = useCallback(async () => {
    if (!id || !mayRun) return;
    setSseActive(true);
    const startEpoch = getSessionEpoch();
    try {
      await dispatch(submitPipelineRun({ pipelineId: id, dryRun: true })).unwrap();
      if (getSessionEpoch() !== startEpoch) return;
      refreshRunHistoryAfterRun();
      refreshVisibleOutputPreviews(id);
    } catch {
      setSseActive(false);
      // runError is displayed via Redux state
    }
  }, [dispatch, id, mayRun, setSseActive, refreshVisibleOutputPreviews, refreshRunHistoryAfterRun]);

  // HEL-1096 design.md D5/D7 — the denial block's own "Run to update" control, shown when
  // `costVerdict.autoRunnable` is false and `costVerdict.canRun` is true (see the returned
  // `costVerdict` below). Reuses the SAME shared handler the denial toast's action uses
  // (`useRunToUpdate`) rather than `handleRunPipeline` above — this is a distinct manual-run
  // trigger for the gate-denial case, not a retrofit of the pre-existing always-visible "Run
  // pipeline" button (design.md Non-Goals).
  const runToUpdateAction = useRunToUpdate();
  const handleRunToUpdate = useCallback(() => {
    if (!id || !mayRun) return;
    runToUpdateAction(id);
  }, [id, mayRun, runToUpdateAction]);

  const handleSave = useCallback(async () => {
    if (!id || !canEdit) return;
    try {
      await dispatch(updatePipeline({ id, name: outputName })).unwrap();
      void navigate("/pipelines");
    } catch {
      // updateError is shown via Redux state
    }
  }, [dispatch, id, canEdit, outputName, navigate]);

  const handleCancel = useCallback(() => {
    if (isDirty) {
      setIsConfirmingCancel(true);
    } else {
      void navigate("/pipelines");
    }
  }, [isDirty, navigate, setIsConfirmingCancel]);

  const confirmCancelDiscard = useCallback(() => {
    setIsConfirmingCancel(false);
    void navigate("/pipelines");
  }, [navigate, setIsConfirmingCancel]);

  const dismissCancelConfirm = useCallback(() => {
    setIsConfirmingCancel(false);
  }, [setIsConfirmingCancel]);

  return {
    handleRunPipeline,
    handleDryRun,
    handleRunToUpdate,
    handleSave,
    handleCancel,
    confirmCancelDiscard,
    dismissCancelConfirm,
    refreshVisibleOutputPreviews,
  };
}
