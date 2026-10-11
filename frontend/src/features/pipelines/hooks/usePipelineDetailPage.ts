import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import type { DataSource } from "../../sources/types/dataSource";
import { usePipelineAnalyzeDeferWatchdog } from "./usePipelineAnalyzeDeferWatchdog";
import { usePipelineAnalyzeLookups } from "./usePipelineAnalyzeLookups";
import { usePipelineDebouncedAnalyze } from "./usePipelineDebouncedAnalyze";
import { usePipelineRootAndToggleActions } from "./usePipelineRootAndToggleActions";
import { usePipelineStepMutations } from "./usePipelineStepMutations";
import { usePipelineStepStructure } from "./usePipelineStepStructure";
import { useRunHistory } from "./useRunHistory";
import type { PendingDraftMeta } from "./usePipelineStepCreation";
import { clearRunState } from "../state/pipelinesSlice";
import { pipelineStepToStep } from "../state/stepNarrowing";
import { buildLaneGraph } from "../state/stepTree";
// HEL-878 (task 2.4): dispatched alongside `clearRunState` at every reset call
// site so the run-scoped Output preview cache never drifts out of sync with
// the run-scoped pipeline state -- see `outputsSlice.ts`'s doc comment on the
// reducer itself for the full unification rationale.
import { resetRunScopedState } from "../state/outputsSlice";
import type { Output } from "../types/output";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { usePipelineOutputSheets } from "./usePipelineOutputSheets";
import { usePipelinePageLoad } from "./usePipelinePageLoad";
import { usePipelineRunAndSaveActions } from "./usePipelineRunAndSaveActions";
import { usePipelineRunStream } from "./usePipelineRunStream";
import { usePipelineSourceScheduleActions } from "./usePipelineSourceScheduleActions";
import { useToast } from "../../toasts/hooks/useToast";
import type { PipelineRoot } from "../types/pipelineStep";
import type { Step } from "../types/step";

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

  const { items: sources, status: sourcesStatus } = useAppSelector((state) => state.sources);
  const {
    runStatus,
    runError,
    runIsDry,
    runResult,
    runStepRowCounts,
    runSourceRowCount,
    runSourceTruncated,
    runTruncationNotice,
    currentPipeline: storedPipeline,
    currentPipelineStatus: storedPipelineStatus,
    currentPipelineError: storedPipelineError,
    currentPipelineErrorKind: storedPipelineErrorKind,
    currentPipelineRequestedId,
    updateStatus,
    updateError,
    steps: reduxSteps,
  } = useAppSelector((state) => state.pipelines);
  // HEL-1483 -- `currentPipeline` and its status/error are singletons in the slice, so right after an
  // in-app switch they still describe the PREVIOUS pipeline. Expose them only for the page's own id:
  // another id's pipeline reads as "not loaded" (loading skeleton, never A's name or header) and
  // another id's status/error as idle/none (so B's load is never skipped by A's failed latch, and
  // A's "couldn't load" never shows on B).
  // Once THIS mount has seen its own pipeline it keeps it (`ownPipeline`, only ever this mount's id)
  // while another id's late request holds the singleton, so a loaded editor is never swapped for the
  // page skeleton -- which would unmount its cards and drop a pending debounced edit -- during the
  // convergence refetch below.
  const singletonIsOwn = storedPipeline?.id === id;
  const [ownPipeline, setOwnPipeline] = useState<typeof storedPipeline>(() =>
    singletonIsOwn ? storedPipeline : null,
  );
  if (singletonIsOwn && storedPipeline !== ownPipeline) setOwnPipeline(storedPipeline);
  // (Not once this page's own request has failed: the error view must replace the kept editor.)
  const ownRequestFailed =
    (!currentPipelineRequestedId || currentPipelineRequestedId === id) &&
    storedPipelineStatus === "failed";
  const currentPipeline = singletonIsOwn ? storedPipeline : ownRequestFailed ? null : ownPipeline;
  // (`null` = nothing requested yet, so there is no other pipeline's status to disown.)
  const ownsPipelineStatus = !currentPipelineRequestedId || currentPipelineRequestedId === id;
  const currentPipelineStatus = ownsPipelineStatus ? storedPipelineStatus : "idle";
  const currentPipelineError = ownsPipelineStatus ? storedPipelineError : null;
  const currentPipelineErrorKind = ownsPipelineStatus ? storedPipelineErrorKind : null;

  // Per-pipeline analyze result (schema-inferred fields per step).
  const analyzeResult = useAppSelector((state) =>
    id ? (state.pipelines.analyzeResult?.[id] ?? null) : null,
  );
  // HEL-972 — read inside the debounced re-analyze effect's `setTimeout`
  // callback below (see `sseActiveRef`'s comment): an already-in-flight
  // `/analyze` request (this pipeline's own PRIOR debounced or mount-time
  // dispatch, still pending) is exactly the kind of concurrent backend
  // request the probe found competing with a run's own completion. Skipping
  // a redundant second dispatch while one is already loading caps this
  // pipeline's `/analyze` concurrency at 1, on top of `sseActiveRef`'s guard
  // against overlapping a live run.
  const analyzeStatus = useAppSelector((state) =>
    id ? (state.pipelines.analyzeStatus?.[id] ?? null) : null,
  );
  const analyzeStatusRef = useRef(analyzeStatus);
  // HEL-1478 -- committed with the render that produced it (a layout effect with no deps runs on every
  // commit), never written during render: a render React discards must not publish its value.
  useLayoutEffect(() => {
    analyzeStatusRef.current = analyzeStatus;
  });

  // Per-pipeline schedule (HEL-416) — `undefined` while not yet fetched,
  // `null` once fetched and confirmed absent.
  const pipelineSchedule = useAppSelector((state) =>
    id ? (state.pipelines.schedule?.[id] ?? null) : null,
  );

  const persistedSteps = id ? (reduxSteps[id] ?? []) : [];

  const [steps, setSteps] = useState<Step[]>([]);
  // F-146 — lets the step-mutation callbacks below read the current `steps`
  // without closing over it directly, so their `useCallback` identity stays
  // stable across the edits that change `steps` most often (every keystroke
  // in one step's config). A `useCallback([..., steps])` dependency would
  // defeat the point: it would get a new identity on exactly the renders
  // this is meant to guard against, which — since these callbacks are
  // `StepCard` props — would keep every *other*, unrelated `StepCard`
  // re-rendering via `React.memo`'s prop comparison (see `StepCard.tsx`).
  const stepsRef = useRef(steps);
  useLayoutEffect(() => {
    stepsRef.current = steps;
  });
  // HEL-1109 (design.md D3) — metadata for a step whose create was deferred
  // (an AI kind whose seed config the backend would reject): keyed by the
  // temp id, holds whatever `handleInsertStep`/`handleAddLaneStep` would
  // otherwise have passed straight to `createPipelineStep` at add-time.
  // Consumed once, by `handleStepConfigChange`, the moment the draft's local
  // config first satisfies `isCompleteAiStepConfig`.
  const pendingDraftMetaRef = useRef(new Map<string, PendingDraftMeta>());
  // HEL-1478 -- the key set of `pendingDraftMetaRef`, mirrored into state so `stepsFingerprint` can
  // exclude pending drafts without reading the ref during render. `usePipelineStepCreation` updates
  // it at every mutation site of the ref, in the same synchronous batch as a re-render-causing
  // setState, so a render always sees the ref and this set in step.
  const [pendingDraftIds, setPendingDraftIds] = useState<ReadonlySet<string>>(() => new Set());
  // HEL-1340 — the anchor meta of a draft whose create has been SENT. `pendingDraftMetaRef` is
  // emptied at send (the create-exactly-once guard and `stepsFingerprint` depend on that), which
  // left the in-flight draft with neither an analyze entry nor meta, so its field picker lost its
  // schema. Keyed by the temp id while in flight, re-keyed to the persisted id on the swap, and
  // dropped once the step has its own analyze entry (or is gone) or the create fails. Consulted
  // by the schema fallback only, never by the guard or the fingerprint.
  const draftFallbackMetaRef = useRef(new Map<string, PendingDraftMeta>());
  // HEL-908 Cycle 13 -- read inside the SSE `onTerminal` closure (defined in
  // `usePipelineRunStream.ts`, which runs before `allOutputs` itself is
  // computed) so a completed run can re-fetch every visible Output's
  // preview without a stale closure over an empty initial `allOutputs`.
  // Updated on every commit (layout effect), mirroring `stepsRef` above.
  const allOutputsRef = useRef<Output[]>([]);
  const [stepsInitialized, setStepsInitialized] = useState(false);
  // HEL-1483 (design D2a) -- true once the steps fetch THIS mount issued has fulfilled. The editor
  // seeds `steps` only then, never from a `reduxSteps[id]` entry that pre-dates the mount (a revisit
  // would otherwise seed the cached, pre-edit steps and `stepsInitialized` would block the reseed).
  // "pending" until it settles; "failed" shows what a base cold open shows (the empty editor).
  const [stepsFetch, setStepsFetch] = useState<"pending" | "fulfilled" | "failed">("pending");
  const stepsFetchedThisMount = stepsFetch === "fulfilled";
  const stepsLoading = stepsFetch === "pending";
  // F-105 — bumped (in the derived-state block below, batched into the same re-render as
  // `stepsInitialized`) the one time `steps` is seeded from `persistedSteps`. The debounced
  // re-analyze effect compares it with `consumedSeedTokenRef` (written only in that effect) so the
  // seeding doesn't count as a "genuine edit" and duplicate the mount effect's own immediate
  // `analyzePipeline`. HEL-1478: state + an effect-written ref instead of a ref written in render.
  const [seedToken, setSeedToken] = useState(0);
  const consumedSeedTokenRef = useRef(0);
  const [dropdownOpenAt, setDropdownOpenAt] = useState<"bottom" | null>(null);
  const [sseActive, setSseActive] = useState(false);
  // HEL-972 — read inside the debounced re-analyze effect's `setTimeout`
  // callback (a stale closure otherwise), which fires up to 300ms after the
  // render that scheduled it: mirrors `stepsRef`'s pattern above so the
  // callback sees the CURRENT sseActive value, not the one captured when the
  // effect last ran.
  const sseActiveRef = useRef(sseActive);
  useLayoutEffect(() => {
    sseActiveRef.current = sseActive;
  });
  // HEL-972 CR2 — `pendingAnalyzeRef` is set when the debounced re-analyze
  // effect's `setTimeout` callback finds the guard active and defers instead
  // of dispatching. `lastAnalyzedFingerprintRef` guards against the OTHER
  // failure mode adding `sseActive`/`analyzeStatus` to the effect's deps
  // creates on its own: since dispatching sets `analyzeStatus` to "loading"
  // and its own resolution sets it back, `analyzeStatus` changing is BOTH
  // the effect's own dependency AND a side effect of the dispatch it
  // performs — without this ref, every dispatch's own settle re-triggers the
  // effect and (guard now clear) dispatches again, forever. Dispatch only
  // when the guard is clear AND (the fingerprint changed since the last
  // dispatch OR a dispatch was genuinely deferred) breaks that loop.
  const pendingAnalyzeRef = useRef(false);
  const lastAnalyzedFingerprintRef = useRef<string | null>(null);
  // HEL-972 final-gate CR1 — `sseActive` is only ever cleared by the SSE
  // `onTerminal` handler or a submit-failure catch. `usePipelineRunEvents`
  // reports a failed/dropped connection via `connectionError` instead of a
  // terminal event, which has NO consumer that clears `sseActive` (confirmed:
  // `connectionError` has no non-test reader anywhere in `frontend/src`), and
  // `PipelineRunStreamRoutes`'s live (non-replaying) subscribe can miss a
  // terminal event outright if it fires before the browser's subscription
  // lands. Either failure mode leaves `sseActive` (and so this guard) stuck
  // true for the rest of the page's lifetime, silently dropping every future
  // edit's analyze forever -- the exact permanent-staleness outcome
  // deferral (vs. the cycle-1 drop) exists to prevent. Rather than plumbing
  // `connectionError` through this hook's several run-lifecycle call sites
  // (a wider, riskier change touching the SSE/run-submit surface this ticket
  // doesn't otherwise touch), bound the deferral in TIME: no single stuck
  // flag can suppress re-analyze for longer than `MAX_ANALYZE_DEFER_MS`,
  // regardless of why the guard never cleared.
  const pendingSinceRef = useRef<number | null>(null);
  const deferWatchdogHandleRef = useRef<number | null>(null);
  // Mirrors `stepsRef`'s pattern: read inside the watchdog's `setTimeout`
  // callback, which can fire long after the render that scheduled it.
  const stepsFingerprintRef = useRef("");
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
    [],
  );
  const { retryPipelineLoad } = usePipelinePageLoad({
    id,
    dispatch,
    currentPipeline,
    singletonIsOwn,
    currentPipelineStatus,
    sourcesStatus,
    loadRunHistoryWhenTruncated,
    onStepsSettled,
  });

  // Re-run /analyze whenever the steps change (add / remove / config edit) so
  // each StepCard's inputSchema (and the available-fields hints inside the op
  // editors) stays in sync without a manual refresh. Debounced so a stream of
  // keystrokes in a TextField doesn't fire a request per character.
  // We key on the SHAPE of steps (id, op, config) — not the array reference —
  // so transient setState calls that don't change content don't trigger
  // re-analyze.
  // Serialize the typed config for the fingerprint — JSON.stringify here
  // is purely a comparison-shape helper, not a wire-format serialization.
  // HEL-412 (design.md Decision 8): `enabled` is folded in too — a toggle
  // changes the analyze endpoint's step list (a disabled step drops out
  // entirely), so it must re-trigger analyze exactly like a config edit does.
  // HEL-1109 (design.md Risks) — a not-yet-created AI draft (still a local
  // temp id, per `pendingDraftIds`) is excluded entirely: it has no
  // server-side representation yet for /analyze to reflect, so folding it in
  // would either 404 the analyze call or dispatch one for a step the backend
  // has never seen.
  const stepsFingerprint = steps
    .filter((s) => !pendingDraftIds.has(s.id))
    .map((s) => `${s.id}:${s.opType.id}:${s.enabled}:${JSON.stringify(s.config)}`)
    .join("|");
  useLayoutEffect(() => {
    stepsFingerprintRef.current = stepsFingerprint;
  });

  // HEL-912 task 1.1 — n-lane grouping (design.md decision 1), recomputed
  // only when the steps array or the pipeline's roots change. HEL-968 D1 —
  // `roots` is now required: it's what lets a root with zero steps still
  // render as an empty lane, which `steps` alone could never reveal.
  const roots = currentPipeline?.roots ?? EMPTY_ROOTS;
  const laneGraph = useMemo(() => buildLaneGraph(steps, roots), [steps, roots]);
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

  // Clear run state when navigating to a different pipeline
  useEffect(() => {
    return () => {
      dispatch(clearRunState());
      // HEL-878 (task 2.4): navigating away is also run-scoped-state-invalidating
      // -- otherwise a stale preview from pipeline A's last run can leak into
      // pipeline B's rail if B's Outputs happen to share a `stepId`-shaped key.
      dispatch(resetRunScopedState());
    };
  }, [dispatch, id]);

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

  const isDirty = outputNamePipelineId !== null && outputName !== (currentPipeline?.name ?? "");

  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const pipelineName = currentPipeline?.name ?? id ?? "Pipeline";
  // HEL-1022 — "which source(s) is this pipeline bound to" used to name only
  // `roots[0]` (D2's old display convention); the header now shows one chip
  // per root, so "is this source editable by the current user" is a PER-ROOT
  // question, not a single global boolean. Keyed by root id (not source id)
  // since two roots can't share a `dataSourceId` but the lookup site always
  // has the root, not the source, at hand.
  const sourceByRootId = useMemo(() => {
    const map: Record<string, DataSource | undefined> = {};
    for (const root of roots) {
      map[root.id] = sources.find((s) => s.id === root.dataSourceId);
    }
    return map;
  }, [roots, sources]);
  const isOwner =
    currentPipeline?.ownerId != null &&
    currentUser?.id != null &&
    currentUser.id === currentPipeline.ownerId;

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
