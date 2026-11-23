import type { Dispatch, SetStateAction } from "react";

import type { useAppDispatch } from "../../../hooks/reduxHooks";
import type { useToast } from "../../toasts/hooks/useToast";
import type { DataSource } from "../../sources/types/dataSource";
import type { PipelineRoot } from "../types/pipelineStep";
import type { Step } from "../types/step";
import type { PipelineEditorState } from "./usePipelineEditorState";
import type { PipelineDraft } from "./usePipelineDraft";
import { useOutputImmediateActions } from "./useOutputImmediateActions";
import { usePipelineDraftRouting } from "./usePipelineDraftRouting";
import { usePipelineRootAndToggleActions } from "./usePipelineRootAndToggleActions";
import { usePipelineStepMutations } from "./usePipelineStepMutations";
import { usePipelineStepStructure } from "./usePipelineStepStructure";

/**
 * The step structure, mutation, root and toggle actions the page exposes, routed through the draft (HEL-1704 split of
 * `usePipelineDetailPage`; the call order of the effect-bearing hooks is the order they had inline).
 */
export function usePipelineDetailStepActions({
  id,
  dispatch,
  roots,
  editor,
  setSteps,
  pushToast,
  draft,
  draftSteps,
  sources,
  editable,
}: {
  id: string | undefined;
  dispatch: ReturnType<typeof useAppDispatch>;
  roots: PipelineRoot[];
  editor: PipelineEditorState;
  setSteps: Dispatch<SetStateAction<Step[]>>;
  pushToast: ReturnType<typeof useToast>["push"];
  draft: PipelineDraft;
  draftSteps: Step[];
  /** The caller's sources, for naming a source the draft adds as a root. */
  sources: DataSource[];
  /** HEL-1794: false for a viewer or an unknown role (the routing's edit guard). */
  editable: boolean;
}) {
  const {
    stepsRef,
    setStepsInitialized,
    pendingDraftMetaRef,
    setPendingDraftIds,
    draftFallbackMetaRef,
  } = editor;
  const {
    syncStepsFromServer,
    draftCreateErrors,
    creatingStepIds,
    handleInsertStep: handleInsertStepNow,
    handleAddStep: handleAddStepNow,
    handleAddLaneStep: handleAddLaneStepNow,
    clearDraftCreateError,
    createDraftIfComplete,
    markTempRemoved,
    handleAddOutputViaAggregateTail: handleAddOutputViaAggregateTailNow,
    handleInstantiateShape: handleInstantiateShapeNow,
  } = usePipelineStepStructure({
    id,
    dispatch,
    roots,
    stepsRef,
    setSteps,
    setStepsInitialized,
    pushToast,
    pendingDraftMetaRef,
    setPendingDraftIds,
    draftFallbackMetaRef,
  });

  const {
    handleStepConfigChange: handleTempStepConfigChange,
    handleRemoveStep: handleRemoveSavedStep,
    handleReorderSteps: handleReorderStepsNow,
  } = usePipelineStepMutations({
    id,
    roots,
    stepsRef,
    setSteps,
    pushToast,
    clearDraftCreateError,
    createDraftIfComplete,
    markTempRemoved,
    syncStepsFromServer,
  });

  const {
    handleAddRoot: handleAddRootNow,
    handleRemoveRoot: handleRemoveRootNow,
    handleToggleStepEnabled: handleToggleTempStepEnabled,
    handleDuplicateStep: handleDuplicateStepNow,
    duplicatingStepIds,
  } = usePipelineRootAndToggleActions({
    id,
    dispatch,
    stepsRef,
    setSteps,
    pushToast,
    syncStepsFromServer,
  });

  const outputActionsNow = useOutputImmediateActions(id ?? "");
  const routed = usePipelineDraftRouting({
    draft,
    roots,
    draftSteps,
    sources,
    editable,
    handlers: {
      handleAddRootNow,
      handleRemoveRootNow,
      handleTempStepConfigChange,
      handleRemoveSavedStep,
      handleToggleTempStepEnabled,
      handleAddStepNow,
      handleInsertStepNow,
      handleAddLaneStepNow,
      handleDuplicateStepNow,
      handleReorderStepsNow,
      handleInstantiateShapeNow,
      handleAddOutputViaAggregateTailNow,
      outputActionsNow,
    },
  });

  return {
    draftCreateErrors,
    creatingStepIds,
    duplicatingStepIds,
    ...routed,
  };
}
