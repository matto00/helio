import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { usePipelineAnalyzeDeferWatchdog } from "./usePipelineAnalyzeDeferWatchdog";
import { usePipelineAnalyzeLookups } from "./usePipelineAnalyzeLookups";
import { usePipelineAnalyzeState } from "./usePipelineAnalyzeState";
import { usePipelineClearRunOnLeave } from "./usePipelineClearRunOnLeave";
import { usePipelineDirtyAndOwner } from "./usePipelineDirtyAndOwner";
import { usePipelineEditorState } from "./usePipelineEditorState";
import { usePipelineOwnPipeline } from "./usePipelineOwnPipeline";
import { usePipelineStepsFingerprint } from "./usePipelineStepsFingerprint";
import { usePipelineDebouncedAnalyze } from "./usePipelineDebouncedAnalyze";
import { usePipelineRootAndToggleActions } from "./usePipelineRootAndToggleActions";
import { usePipelineStepMutations } from "./usePipelineStepMutations";
import { usePipelineStepStructure } from "./usePipelineStepStructure";
import { useRunHistory } from "./useRunHistory";
import { pipelineStepToStep } from "../state/stepNarrowing";
import { buildLaneGraph } from "../state/stepTree";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { usePipelineOutputSheets } from "./usePipelineOutputSheets";
import { usePipelinePageLoad } from "./usePipelinePageLoad";
import { usePipelineRunAndSaveActions } from "./usePipelineRunAndSaveActions";
import { usePipelineRunStream } from "./usePipelineRunStream";
import { usePipelineSourceScheduleActions } from "./usePipelineSourceScheduleActions";
import { useToast } from "../../toasts/hooks/useToast";
import { useSourceSamples } from "../../sources/hooks/useSourceSamples";
import type { PipelineRoot } from "../types/pipelineStep";

// HEL-968 — stable empty-roots reference so `buildLaneGraph`'s `useMemo`
// dependency doesn't churn on every render before `currentPipeline` loads.
const EMPTY_ROOTS: PipelineRoot[] = [];

/**
 * All `PipelineDetailPage` state, effects, and handlers (HEL-682 split,
 * task 3.1). Extracted behavior-preserving: this hook is called exactly
 * once per `PipelineDetailPage` render, so every ref/memo/callback
 * identity-stability invariant documented inline (F-146, F-105) holds
 * exactly as it did when this lived directly in the component.
 */
export function usePipelineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { push: pushToast } = useToast();

  const {
    sources,
    sourcesStatus,
    runStatus,
    runError,
    runIsDry,
    runResult,
    runStepRowCounts,
    runSourceRowCount,
    runSourceTruncated,
    runTruncationNotice,
    updateStatus,
    updateError,
    reduxSteps,
    singletonIsOwn,
    currentPipeline,
    currentPipelineStatus,
    currentPipelineError,
    currentPipelineErrorKind,
  } = usePipelineOwnPipeline({ id });

  const { analyzeResult, analyzeStatus, analyzeStatusRef, pipelineSchedule } =
    usePipelineAnalyzeState({ id });

  const persistedSteps = id ? (reduxSteps[id] ?? []) : [];

  const {
    steps,
    setSteps,
    stepsRef,
    pendingDraftMetaRef,
    pendingDraftIds,
    setPendingDraftIds,
    draftFallbackMetaRef,
    allOutputsRef,
    stepsInitialized,
    setStepsInitialized,
    setStepsFetch,
    stepsFetchedThisMount,
    stepsLoading,
    stepsFailed,
    onStepsRetry,
    seedToken,
    setSeedToken,
    consumedSeedTokenRef,
    dropdownOpenAt,
    setDropdownOpenAt,
    sseActive,
    setSseActive,
    sseActiveRef,
    pendingAnalyzeRef,
    lastAnalyzedFingerprintRef,
    pendingSinceRef,
    deferWatchdogHandleRef,
    stepsFingerprintRef,
  } = usePipelineEditorState();
  const [outputName, setOutputName] = useState("");
  const [editingOutputName, setEditingOutputName] = useState(false);
  // HEL-1354: run history is loaded on demand (modal open, truncated-banner boot, post-run
  // refresh) rather than on every page open; see `useRunHistory`.
  const {
    historyOpen,
    openRunHistory,
    closeRunHistory,
    retryRunHistory,
    runs,
    runHistoryView,
    refreshRunHistoryAfterRun,
    loadRunHistoryWhenTruncated,
  } = useRunHistory(id);
  const [shareOpen, setShareOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // Track which pipeline id the outputName was last initialized from
  const [outputNamePipelineId, setOutputNamePipelineId] = useState<string | null>(null);
  // Inline discard-confirm state (replaces window.confirm on dirty cancel).
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);

  const currentUser = useAppSelector((state) => state.auth.currentUser);

  const sseData = usePipelineRunStream({
    id,
    dispatch,
    sseActive,
    setSseActive,
    allOutputsRef,
    refreshRunHistoryAfterRun,
  });

  // ── Derived-state initialization (React recommended pattern) ──
  // Sync outputName whenever a different pipeline becomes current.
  if (currentPipeline && currentPipeline.id !== outputNamePipelineId) {
    setOutputNamePipelineId(currentPipeline.id);
    setOutputName(currentPipeline.name);
  }
  // Initialize local steps from persisted Redux data on first load.
  if (!stepsInitialized && stepsFetchedThisMount && persistedSteps.length > 0) {
    setStepsInitialized(true);
    setSteps(persistedSteps.map(pipelineStepToStep));
    // F-105 — this transition changes `stepsFingerprint` below from "" to a
    // real value, which the debounced re-analyze effect can't tell apart
    // from a genuine edit. Without this token it fires its own /analyze
    // ~300ms after the mount effect's own immediate one (two identical
    // requests on every page open). Consumed by that effect's next run;
    // it changes only in the render where `stepsFingerprint` also changes.
    setSeedToken((token) => token + 1);
  }

  const onStepsSettled = useCallback(
    (ok: boolean) => setStepsFetch(ok ? "fulfilled" : "failed"),
    [setStepsFetch],
  );
  const { retryPipelineLoad, retryStepsLoad } = usePipelinePageLoad({
    id,
    dispatch,
    currentPipeline,
    singletonIsOwn,
    currentPipelineStatus,
    sourcesStatus,
    loadRunHistoryWhenTruncated,
    onStepsSettled,
    onStepsRetry,
    analyzeStatusRef,
  });

  const stepsFingerprint = usePipelineStepsFingerprint({
    steps,
    pendingDraftIds,
    stepsFingerprintRef,
  });

  // HEL-912 task 1.1 — n-lane grouping (design.md decision 1), recomputed
  // only when the steps array or the pipeline's roots change. HEL-968 D1 —
  // `roots` is now required: it's what lets a root with zero steps still
  // render as an empty lane, which `steps` alone could never reveal.
  const roots = currentPipeline?.roots ?? EMPTY_ROOTS;
  const laneGraph = useMemo(() => buildLaneGraph(steps, roots), [steps, roots]);
  // HEL-1628: one sample capture per root source when the page opens with nothing cached (both layouts); the
  // label's refresh button is the only other fetch. Never from a step editor, so edits do not re-fetch.
  const rootSourceIds = useMemo(() => roots.map((r) => r.dataSourceId), [roots]);
  useSourceSamples(rootSourceIds);
  const { clearDeferWatchdog, forceDeferredAnalyze } = usePipelineAnalyzeDeferWatchdog({
    id,
    dispatch,
    pendingAnalyzeRef,
    lastAnalyzedFingerprintRef,
    pendingSinceRef,
    deferWatchdogHandleRef,
    stepsFingerprintRef,
  });
  usePipelineDebouncedAnalyze({
    id,
    dispatch,
    steps,
    stepsFingerprint,
    seedToken,
    sseActive,
    analyzeStatus,
    forceDeferredAnalyze,
    clearDeferWatchdog,
    consumedSeedTokenRef,
    lastAnalyzedFingerprintRef,
    sseActiveRef,
    analyzeStatusRef,
    pendingAnalyzeRef,
    pendingSinceRef,
    deferWatchdogHandleRef,
  });

  usePipelineClearRunOnLeave({ dispatch, id });

  const {
    getAnalyzeColumns,
    getAnalyzeSchema,
    getAnalyzeOutputSchema,
    hasOwnAnalyzeEntry,
    getAnalyzeValidationError,
    getAnalyzeWarnings,
  } = usePipelineAnalyzeLookups({
    analyzeResult,
    steps,
    pendingDraftMetaRef,
    draftFallbackMetaRef,
  });

  const { isDirty, pipelineName, sourceByRootId, isOwner } = usePipelineDirtyAndOwner({
    id,
    outputNamePipelineId,
    outputName,
    currentPipeline,
    currentUser,
    roots,
    sources,
  });

  const {
    outputsByStepId,
    previewRowCountByOutputId,
    allOutputs,
    outputSheet,
    handleOpenOutput,
    historyOutput,
    handleOpenOutputHistory,
    handleCloseOutputHistory,
    handleAddOutput,
    handleCloseOutputSheet,
  } = usePipelineOutputSheets({ id, allOutputsRef });

  const { handleEditSource, handleToggleScheduleEnabled } = usePipelineSourceScheduleActions({
    id,
    dispatch,
    navigate,
    pipelineSchedule,
  });

  const {
    syncStepsFromServer,
    draftCreateErrors,
    creatingStepIds,
    handleInsertStep,
    handleAddStep,
    handleAddLaneStep,
    clearDraftCreateError,
    createDraftIfComplete,
    markTempRemoved,
    handleAddOutputViaAggregateTail,
    handleInstantiateShape,
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

  const { handleStepConfigChange, handleRemoveStep, handleReorderSteps } = usePipelineStepMutations(
    {
      id,
      roots,
      stepsRef,
      setSteps,
      pushToast,
      clearDraftCreateError,
      createDraftIfComplete,
      markTempRemoved,
      syncStepsFromServer,
    },
  );

  const {
    handleAddRoot,
    handleRemoveRoot,
    handleToggleStepEnabled,
    handleDuplicateStep,
    duplicatingStepIds,
  } = usePipelineRootAndToggleActions({
    id,
    dispatch,
    stepsRef,
    setSteps,
    pushToast,
    syncStepsFromServer,
  });

  const {
    handleRunPipeline,
    handleDryRun,
    handleRunToUpdate,
    handleSave,
    handleCancel,
    confirmCancelDiscard,
    dismissCancelConfirm,
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
  });

  return {
    stepsLoading,
    stepsFailed,
    retryStepsLoad,
    id,
    dispatch,
    steps,
    dropdownOpenAt,
    setDropdownOpenAt,
    sseActive,
    sseData,
    outputName,
    setOutputName,
    editingOutputName,
    setEditingOutputName,
    historyOpen,
    openRunHistory,
    closeRunHistory,
    retryRunHistory,
    runHistoryView,
    retryPipelineLoad,
    shareOpen,
    setShareOpen,
    scheduleOpen,
    setScheduleOpen,
    isConfirmingCancel,
    runStatus,
    runError,
    runIsDry,
    runResult,
    runStepRowCounts,
    runSourceRowCount,
    runSourceTruncated,
    runTruncationNotice,
    currentPipeline,
    currentPipelineStatus,
    currentPipelineError,
    currentPipelineErrorKind,
    updateStatus,
    updateError,
    pipelineSchedule,
    runs,
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
    handleRunToUpdate,
    // HEL-1109 (pipeline-ai-step-authoring spec) — a rejected deferred-create's
    // message, keyed by the draft's (still-temp) step id.
    draftCreateErrors,
    getAnalyzeColumns,
    getAnalyzeSchema,
    getAnalyzeOutputSchema,
    hasOwnAnalyzeEntry,
    getAnalyzeValidationError,
    getAnalyzeWarnings,
    outputsByStepId,
    allOutputs,
    previewRowCountByOutputId,
    handleOpenOutput,
    historyOutput,
    handleOpenOutputHistory,
    handleCloseOutputHistory,
    handleAddOutput,
    outputSheet,
    handleCloseOutputSheet,
    handleEditSource,
    handleToggleScheduleEnabled,
    laneGraph,
    roots,
    handleAddRoot,
    handleRemoveRoot,
    handleAddStep,
    handleAddLaneStep,
    handleAddOutputViaAggregateTail,
    handleInsertStep,
    handleInstantiateShape,
    handleStepConfigChange,
    handleRemoveStep,
    handleReorderSteps,
    handleToggleStepEnabled,
    handleDuplicateStep,
    duplicatingStepIds,
    creatingStepIds,
    handleRunPipeline,
    handleDryRun,
    handleSave,
    handleCancel,
    confirmCancelDiscard,
    dismissCancelConfirm,
  };
}
