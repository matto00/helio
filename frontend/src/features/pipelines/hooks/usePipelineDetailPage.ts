import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { useToast } from "../../toasts/hooks/useToast";
import type { PipelineRoot } from "../types/pipelineStep";
import { hasRootChange, replayRoots } from "../state/draftRoots";
import { selectOutputsForPipeline } from "../state/outputsSlice";
import { DRAFT_BLOCK_REASON, usePipelineDraft } from "./usePipelineDraft";
import { createDraftFrameMemory } from "./usePipelineDraftFrames";
import { usePipelineAnalyzeState } from "./usePipelineAnalyzeState";
import { usePipelineDetailAnalyze } from "./usePipelineDetailAnalyze";
import { usePipelineDetailSaveWiring } from "./usePipelineDetailSaveWiring";
import { usePipelineDetailStepActions } from "./usePipelineDetailStepActions";
import { usePipelineDetailUiState } from "./usePipelineDetailUiState";
import { isPipelineOwner, usePipelineDirtyAndOwner } from "./usePipelineDirtyAndOwner";
import { canEditFromUi, usePipelineRunRole } from "./usePipelineRunRole";
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
const EMPTY_REMAP: ReadonlyMap<string, string> = new Map();

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
  // HEL-1733 (D15): effect-free selector moved above the draft; the same selector `usePipelineOutputSheets` reads, so identity is shared.
  const savedOutputs = useAppSelector((state) => selectOutputsForPipeline(state, id ?? ""));
  // HEL-1661/HEL-1794 (design.md D2): the caller's role is resolved BEFORE the draft, so the draft's mutators know whether the page is
  // editable. Selector-only hooks: no effect moves.
  const currentUser = useAppSelector((state) => state.auth.currentUser);
  const isOwner = isPipelineOwner(currentPipeline, currentUser);
  const runRole = usePipelineRunRole(id, isOwner);
  const canEdit = canEditFromUi(runRole);
  const draft = usePipelineDraft({
    baseSteps: steps,
    baseStepsRef: stepsRef,
    baseOutputs: savedOutputs,
    outputsStatus: editor.outputsFetch,
    pipelineId: id,
    ready: stepsInitialized && !stepsLoading && !stepsFailed,
    editable: canEdit,
  });
  const draftSteps = draft.draftSteps;
  // Lives here, not in a layout, so the last good draft frames survive the 768px layout swap.
  const [draftFrameMemory] = useState(createDraftFrameMemory);
  const ui = usePipelineDetailUiState(currentPipeline);
  // HEL-1354: run history is loaded on demand (modal open, truncated-banner boot, post-run
  // refresh) rather than on every page open; see `useRunHistory`.
  const history = useRunHistory(id);
  const { refreshRunHistoryAfterRun } = history;

  const draftSaveInFlightRef = useRef(false);
  // HEL-1733 D10: set by Save & run's settle; keeps an explicit pick of a created Output on the saved Output it became.
  const [outputPickRemap, setOutputPickRemap] = useState<ReadonlyMap<string, string>>(EMPTY_REMAP);
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

  // HEL-1734: `savedRoots` are the pipeline's stored roots; `roots` what the page shows, with the draft's added and removed sources
  // applied (the saved list itself, same identity, while the draft changes no root).
  const savedRoots = currentPipeline?.roots ?? EMPTY_ROOTS;
  const draftOps = draft.overlay.ops;
  const roots = useMemo(
    () => (hasRootChange(draftOps) ? replayRoots(savedRoots, draftOps).roots : savedRoots),
    [savedRoots, draftOps],
  );
  const analyze = usePipelineDetailAnalyze({
    id,
    dispatch,
    editor,
    analyzeState,
    draft,
    draftSteps,
    roots,
  });

  const { isDirty, pipelineName, sourceByRootId } = usePipelineDirtyAndOwner({
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
    canEdit,
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
    sources: own.sources,
    editable: canEdit,
  });

  const saveWiring = usePipelineDetailSaveWiring({
    id,
    dispatch,
    navigate,
    pushToast,
    editor,
    draft,
    roots: savedRoots,
    draftSaveInFlightRef,
    setOutputPickRemap,
    refreshRunHistoryAfterRun,
    outputName: ui.outputName,
    isDirty,
    setIsConfirmingCancel: ui.setIsConfirmingCancel,
    runRole,
    canEdit,
  });

  const { analyzeResult } = analyzeState;
  const outputBlockReason =
    !draft.hasDraft || draft.outputsStatus === "loaded"
      ? null
      : draft.outputsStatus === "failed"
        ? "Outputs could not be loaded"
        : "Outputs are still loading";
  const outputEdits = draft.overlay.outputEdits;
  const draftOutputEditedIds = useMemo(() => new Set(Object.keys(outputEdits)), [outputEdits]);
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
    /** HEL-1732: the saved analyze's per-root source schemas: a root's declared column order for the draft grid. */
    analyzeSourceSchemas: analyzeResult?.sourceSchemas,
    /** Why structural controls are unavailable while a draft exists; `null` otherwise (design.md D2). */
    draftBlockReason: draft.hasDraft ? DRAFT_BLOCK_REASON : null,
    // HEL-1733 D3/D15 (HEL-1734: adding and removing a source are draft entries too): Output, shape and aggregate-tail actions wait
    // only while the page's own Outputs fetch has not landed (never judged against an Output list that has not loaded).
    draftOutputBlockReason: outputBlockReason,
    /** The Outputs the page shows: the saved ones with the draft laid over them (the saved list itself with no draft). */
    draftOutputs: draft.draftOutputs,
    draftOutputEditedIds,
    outputPickRemap,
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
    runRowCount: own.runRowCount,
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
    runRole,
    /** HEL-1794: the page offers edit affordances (owner or editor); a viewer and a not-yet-known role get none. */
    canEdit,
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
    savedRoots,
    ...stepActions,
    ...saveWiring,
  };
}
