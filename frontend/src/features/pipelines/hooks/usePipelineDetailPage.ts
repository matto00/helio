import { useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { useToast } from "../../toasts/hooks/useToast";
import type { PipelineRoot } from "../types/pipelineStep";
import { DRAFT_BLOCK_REASON, usePipelineDraft } from "./usePipelineDraft";
import { createDraftFrameMemory } from "./usePipelineDraftFrames";
import { usePipelineAnalyzeState } from "./usePipelineAnalyzeState";
import { usePipelineDetailAnalyze } from "./usePipelineDetailAnalyze";
import { usePipelineDetailSaveWiring } from "./usePipelineDetailSaveWiring";
import { usePipelineDetailStepActions } from "./usePipelineDetailStepActions";
import { usePipelineDetailUiState } from "./usePipelineDetailUiState";
import { usePipelineDirtyAndOwner } from "./usePipelineDirtyAndOwner";
import { usePipelineEditorState } from "./usePipelineEditorState";
import { usePipelineOutputSheets } from "./usePipelineOutputSheets";
import { usePipelineOwnPipeline } from "./usePipelineOwnPipeline";
import { usePipelineRunStream } from "./usePipelineRunStream";
import { usePipelineSourceScheduleActions } from "./usePipelineSourceScheduleActions";
import { usePipelineStepsSeed } from "./usePipelineStepsSeed";
import { useRunHistory } from "./useRunHistory";

// HEL-968 — stable empty-roots reference so `buildLaneGraph`'s `useMemo`
// dependency doesn't churn on every render before `currentPipeline` loads.
const EMPTY_ROOTS: PipelineRoot[] = [];

/**
 * All `PipelineDetailPage` state, effects, and handlers (HEL-682 split,
 * task 3.1). Extracted behavior-preserving: this hook is called exactly
 * once per `PipelineDetailPage` render, so every ref/memo/callback
 * identity-stability invariant documented inline (F-146, F-105) holds
 * exactly as it did when this lived directly in the component.
 *
 * HEL-1704: the page wiring over focused hooks. The relative order of every effect-bearing call is the order they had when
 * they were all inline (design.md D1); effect-free state moved into `usePipelineDetailUiState`.
 */
export function usePipelineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { push: pushToast } = useToast();

  const own = usePipelineOwnPipeline({ id });
  const { currentPipeline } = own;
  const analyzeState = usePipelineAnalyzeState({ id });
  const persistedSteps = id ? (own.reduxSteps[id] ?? []) : [];

  const editor = usePipelineEditorState();
  const { steps, stepsRef, stepsInitialized, stepsLoading, stepsFailed } = editor;
  // HEL-1631: the client-only draft overlays the saved `steps`; everything the layouts render reads the draft steps.
  const draft = usePipelineDraft({
    baseSteps: steps,
    baseStepsRef: stepsRef,
    pipelineId: id,
    ready: stepsInitialized && !stepsLoading && !stepsFailed,
  });
  const draftSteps = draft.draftSteps;
  // Lives here, not in a layout, so the last good draft frames survive the 768px layout swap.
  const [draftFrameMemory] = useState(createDraftFrameMemory);
  const ui = usePipelineDetailUiState(currentPipeline);
  // HEL-1354: run history is loaded on demand (modal open, truncated-banner boot, post-run
  // refresh) rather than on every page open; see `useRunHistory`.
  const history = useRunHistory(id);
  const { refreshRunHistoryAfterRun } = history;
  const currentUser = useAppSelector((state) => state.auth.currentUser);

  const draftSaveInFlightRef = useRef(false);
  const sseData = usePipelineRunStream({
    id,
    dispatch,
    sseActive: editor.sseActive,
    setSseActive: editor.setSseActive,
    draftSaveInFlightRef,
    refreshRunHistoryAfterRun,
  });

  const { retryPipelineLoad, retryStepsLoad } = usePipelineStepsSeed({
    id,
    dispatch,
    editor,
    own,
    analyzeState,
    persistedSteps,
    loadRunHistoryWhenTruncated: history.loadRunHistoryWhenTruncated,
  });

  const roots = currentPipeline?.roots ?? EMPTY_ROOTS;
  const analyze = usePipelineDetailAnalyze({
    id,
    dispatch,
    editor,
    analyzeState,
    draft,
    draftSteps,
    roots,
  });

  const { isDirty, pipelineName, sourceByRootId, isOwner } = usePipelineDirtyAndOwner({
    id,
    outputNamePipelineId: ui.outputNamePipelineId,
    outputName: ui.outputName,
    currentPipeline,
    currentUser,
    roots,
    sources: own.sources,
  });

  const outputSheets = usePipelineOutputSheets({ id, allOutputsRef: editor.allOutputsRef });

  const { handleEditSource, handleToggleScheduleEnabled } = usePipelineSourceScheduleActions({
    id,
    dispatch,
    navigate,
    pipelineSchedule: analyzeState.pipelineSchedule,
  });

  const stepActions = usePipelineDetailStepActions({
    id,
    dispatch,
    roots,
    editor,
    setSteps: editor.setSteps,
    pushToast,
    draft,
    draftSteps,
  });

  const saveWiring = usePipelineDetailSaveWiring({
    id,
    dispatch,
    navigate,
    pushToast,
    editor,
    draft,
    roots,
    draftSaveInFlightRef,
    refreshRunHistoryAfterRun,
    outputName: ui.outputName,
    isDirty,
    setIsConfirmingCancel: ui.setIsConfirmingCancel,
  });

  const { analyzeResult } = analyzeState;
  return {
    stepsLoading,
    stepsFailed,
    retryStepsLoad,
    id,
    dispatch,
    // The steps the page shows: the saved ones, with the draft (if any) laid over them (design.md D1).
    steps: draftSteps,
    baseSteps: steps,
    draft,
    draftFrameMemory,
    /** Why structural controls are unavailable while a draft exists; `null` otherwise (design.md D2). */
    draftBlockReason: draft.hasDraft ? DRAFT_BLOCK_REASON : null,
    dropdownOpenAt: editor.dropdownOpenAt,
    setDropdownOpenAt: editor.setDropdownOpenAt,
    sseActive: editor.sseActive,
    sseData,
    outputName: ui.outputName,
    setOutputName: ui.setOutputName,
    editingOutputName: ui.editingOutputName,
    setEditingOutputName: ui.setEditingOutputName,
    historyOpen: history.historyOpen,
    openRunHistory: history.openRunHistory,
    ensureRunHistoryLoaded: history.ensureRunHistoryLoaded,
    closeRunHistory: history.closeRunHistory,
    retryRunHistory: history.retryRunHistory,
    runHistoryView: history.runHistoryView,
    retryPipelineLoad,
    shareOpen: ui.shareOpen,
    setShareOpen: ui.setShareOpen,
    scheduleOpen: ui.scheduleOpen,
    setScheduleOpen: ui.setScheduleOpen,
    isConfirmingCancel: ui.isConfirmingCancel,
    runStatus: own.runStatus,
    runError: own.runError,
    runIsDry: own.runIsDry,
    runResult: own.runResult,
    runStepRowCounts: own.runStepRowCounts,
    runSourceRowCount: own.runSourceRowCount,
    runSourceTruncated: own.runSourceTruncated,
    runTruncationNotice: own.runTruncationNotice,
    currentPipeline,
    currentPipelineStatus: own.currentPipelineStatus,
    currentPipelineError: own.currentPipelineError,
    currentPipelineErrorKind: own.currentPipelineErrorKind,
    updateStatus: own.updateStatus,
    updateError: own.updateError,
    pipelineSchedule: analyzeState.pipelineSchedule,
    runs: history.runs,
    isDirty,
    pipelineName,
    sourceByRootId,
    isOwner,
    // HEL-1109 (design.md D5) — the pipeline's own estimated row count, when
    // known, threaded through to the AI step cards' cost disclosure. Never
    // presented as a per-step call count -- see `AiStepCostDisclosure`'s doc.
    estimatedRows: analyzeResult?.costVerdict.estimatedRows,
    // HEL-1096 design.md D5 — the whole verdict, so the footer's denial block can render
    // `reasons`/`canRun` itself; `null` while analyze hasn't returned yet (renders nothing).
    costVerdict: analyzeResult?.costVerdict ?? null,
    ...analyze,
    ...outputSheets,
    handleEditSource,
    handleToggleScheduleEnabled,
    roots,
    ...stepActions,
    ...saveWiring,
  };
}
