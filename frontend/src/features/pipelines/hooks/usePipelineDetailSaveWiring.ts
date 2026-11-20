import type { Dispatch, SetStateAction } from "react";

import type { useAppDispatch } from "../../../hooks/reduxHooks";
import type { useToast } from "../../toasts/hooks/useToast";
import type { PipelineRoot } from "../types/pipelineStep";
import type { PipelineDraft } from "./usePipelineDraft";
import type { PipelineEditorState } from "./usePipelineEditorState";
import { usePipelineDraftSave } from "./usePipelineDraftSave";
import { usePipelineRunAndSaveActions } from "./usePipelineRunAndSaveActions";
import { canRunFromUi, type PipelineRunRole } from "./usePipelineRunRole";

/**
 * Run, save, cancel and Save & run wiring (HEL-1704 split of `usePipelineDetailPage`). `navigate` is passed in, not read
 * here, so the page's `useNavigate` keeps its place among the effect-bearing hooks.
 */
export function usePipelineDetailSaveWiring({
  id,
  dispatch,
  navigate,
  pushToast,
  editor,
  draft,
  roots,
  draftSaveInFlightRef,
  setOutputPickRemap,
  refreshRunHistoryAfterRun,
  outputName,
  isDirty,
  setIsConfirmingCancel,
  runRole,
}: {
  id: string | undefined;
  dispatch: ReturnType<typeof useAppDispatch>;
  navigate: Parameters<typeof usePipelineRunAndSaveActions>[0]["navigate"];
  pushToast: ReturnType<typeof useToast>["push"];
  editor: PipelineEditorState;
  draft: PipelineDraft;
  roots: PipelineRoot[];
  draftSaveInFlightRef: Parameters<typeof usePipelineDraftSave>[0]["draftSaveInFlightRef"];
  setOutputPickRemap: Parameters<typeof usePipelineDraftSave>[0]["setOutputPickRemap"];
  refreshRunHistoryAfterRun: () => void;
  outputName: string;
  isDirty: boolean;
  setIsConfirmingCancel: Dispatch<SetStateAction<boolean>>;
  runRole: PipelineRunRole;
}) {
  const { stepsRef, setSteps, allOutputsRef, setSseActive } = editor;
  const {
    handleRunPipeline,
    handleDryRun,
    handleRunToUpdate,
    handleSave,
    handleCancel,
    confirmCancelDiscard,
    dismissCancelConfirm,
    refreshVisibleOutputPreviews,
  } = usePipelineRunAndSaveActions({
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
  });

  // One source of truth for "loaded" (D15): this page's own fetch, the same status the draft judges Output ops by.
  const outputsLoaded = draft.outputsStatus === "loaded";
  const draftSave = usePipelineDraftSave({
    id,
    dispatch,
    pushToast,
    draft,
    stepsRef,
    setSteps,
    roots,
    allOutputsRef,
    draftSaveInFlightRef,
    setOutputPickRemap,
    outputsLoaded,
    setSseActive,
    refreshRunHistoryAfterRun,
    refreshVisibleOutputPreviews,
    runRole,
    onRunNow: canRunFromUi(runRole) ? () => void handleRunPipeline() : undefined,
  });

  return {
    handleRunPipeline,
    handleDryRun,
    handleRunToUpdate,
    handleSave,
    handleCancel,
    confirmCancelDiscard,
    dismissCancelConfirm,
    draftSave,
  };
}
