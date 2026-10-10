import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { fetchSources } from "../../sources/state/sourcesSlice";
import type { DataSource } from "../../sources/types/dataSource";
import { useRunToUpdate } from "./useRunToUpdate";
import { usePipelineAnalyzeDeferWatchdog } from "./usePipelineAnalyzeDeferWatchdog";
import { usePipelineAnalyzeLookups } from "./usePipelineAnalyzeLookups";
import { usePipelineRootAndToggleActions } from "./usePipelineRootAndToggleActions";
import { usePipelineStepMutations } from "./usePipelineStepMutations";
import { usePipelineStepStructure } from "./usePipelineStepStructure";
import { useRunHistory } from "./useRunHistory";
import type { PendingDraftMeta } from "./usePipelineStepCreation";
import {
  analyzePipeline,
  clearRunState,
  fetchPipelineById,
  fetchPipelineSchedule,
  fetchPipelineSteps,
  savePipelineSchedule,
  submitPipelineRun,
  updatePipeline,
} from "../state/pipelinesSlice";
import { pipelineStepToStep } from "../state/stepNarrowing";
import { buildLaneGraph } from "../state/stepTree";
// HEL-878 (task 2.4): dispatched alongside `clearRunState` at every reset call
// site so the run-scoped Output preview cache never drifts out of sync with
// the run-scoped pipeline state -- see `outputsSlice.ts`'s doc comment on the
// reducer itself for the full unification rationale.
import {
  fetchOutputs,
  previewOutput,
  resetRunScopedState,
  selectOutputsByStepId,
  selectOutputsForPipeline,
  selectPreviewRowCountByOutputId,
} from "../state/outputsSlice";
import type { Output } from "../types/output";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { usePipelineRunEvents } from "./usePipelineRunEvents";
import type { RunStatusEventData } from "./usePipelineRunEvents";
import { useToast } from "../../toasts/hooks/useToast";
import type { PipelineRoot } from "../types/pipelineStep";
import type { Step } from "../types/step";

// HEL-968 — stable empty-roots reference so `buildLaneGraph`'s `useMemo`
// dependency doesn't churn on every render before `currentPipeline` loads.
const EMPTY_ROOTS: PipelineRoot[] = [];
// HEL-972 final-gate CR1 — the longest a deferred analyze may be suppressed
// by the sseActive/analyzeStatus guard before it fires regardless. Chosen to
// comfortably exceed a normal run's duration (measured ~6-10s wall time for
// the dry-run flow this ticket's own e2e guard exercises) while still
// bounding a genuinely stuck guard (a dropped/never-opened SSE stream, or a
// missed terminal event -- see `pendingSinceRef`'s comment) to a fixed,
// short window rather than "forever". Matches the 15s window
// `hel912-lanes-rejoin.spec.ts` itself uses for the run-status assertion, so
// a run slow enough to make deferral fire anyway is a run already outside
// what this page's own e2e guard treats as timely.
const MAX_ANALYZE_DEFER_MS = 15000;

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
    currentPipeline,
    currentPipelineStatus,
    currentPipelineError,
    currentPipelineErrorKind,
    updateStatus,
    updateError,
    steps: reduxSteps,
  } = useAppSelector((state) => state.pipelines);

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
  analyzeStatusRef.current = analyzeStatus;

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
  stepsRef.current = steps;
  // HEL-1109 (design.md D3) — metadata for a step whose create was deferred
  // (an AI kind whose seed config the backend would reject): keyed by the
  // temp id, holds whatever `handleInsertStep`/`handleAddLaneStep` would
  // otherwise have passed straight to `createPipelineStep` at add-time.
  // Consumed once, by `handleStepConfigChange`, the moment the draft's local
  // config first satisfies `isCompleteAiStepConfig`.
  const pendingDraftMetaRef = useRef(new Map<string, PendingDraftMeta>());
  // HEL-1340 — the anchor meta of a draft whose create has been SENT. `pendingDraftMetaRef` is
  // emptied at send (the create-exactly-once guard and `stepsFingerprint` depend on that), which
  // left the in-flight draft with neither an analyze entry nor meta, so its field picker lost its
  // schema. Keyed by the temp id while in flight, re-keyed to the persisted id on the swap, and
  // dropped once the step has its own analyze entry (or is gone) or the create fails. Consulted
  // by the schema fallback only, never by the guard or the fingerprint.
  const draftFallbackMetaRef = useRef(new Map<string, PendingDraftMeta>());
  // HEL-908 Cycle 13 -- read inside the SSE `onTerminal` closure (defined
  // below, before `allOutputs` itself is computed) so a completed run can
  // re-fetch every visible Output's preview without a stale closure over an
  // empty initial `allOutputs`. Updated unconditionally on every render,
  // mirroring `stepsRef` above.
  const allOutputsRef = useRef<Output[]>([]);
  const [stepsInitialized, setStepsInitialized] = useState(false);
  // F-105 — set (during render, alongside `stepsInitialized`) the one time
  // `steps` is seeded from `persistedSteps`; consumed by the debounced
  // re-analyze effect below so that seeding doesn't count as a "genuine
  // edit" and duplicate the mount effect's own immediate `analyzePipeline`.
  const skipNextAnalyzeRef = useRef(false);
  const [dropdownOpenAt, setDropdownOpenAt] = useState<"bottom" | null>(null);
  const [sseActive, setSseActive] = useState(false);
  // HEL-972 — read inside the debounced re-analyze effect's `setTimeout`
  // callback (a stale closure otherwise), which fires up to 300ms after the
  // render that scheduled it: mirrors `stepsRef`'s pattern above so the
  // callback sees the CURRENT sseActive value, not the one captured when the
  // effect last ran.
  const sseActiveRef = useRef(sseActive);
  sseActiveRef.current = sseActive;
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

  const sseData = usePipelineRunEvents({
    pipelineId: id,
    active: sseActive,
    onTerminal: (event: RunStatusEventData) => {
      setSseActive(false);
      // HEL-878 (task 2.4): the SSE half of the single-reset-path unification --
      // covers a run that was already in flight when this page mounted (the
      // submitPipelineRun.pending reset in outputsSlice only fires for a run
      // started from THIS page). Every rail/sheet preview is stale the moment
      // the run finishes.
      dispatch(resetRunScopedState());
      // HEL-908 Cycle 13 -- resetting the cache alone leaves every rail chip
      // showing "-" until its own sheet is reopened (`OutputsRail` is
      // presentational-only and never fetches on its own -- see its file
      // doc comment). Re-fetch every currently-known Output's preview right
      // away so the chips repopulate as soon as the run actually finishes,
      // without requiring the user to reopen anything. A failed run leaves
      // the reset cache empty (nothing to show) rather than re-fetching
      // against rows that a failed run may not have touched. `dry_run` is
      // its own terminal status (see `usePipelineRunEvents.ts`'s
      // `TERMINAL_STATUSES`), distinct from `succeeded` -- a dry run must
      // refresh the rail exactly like a live run does (design.md decision 2
      // draws no rail-thumbnail distinction between the two).
      if (id && (event.status === "succeeded" || event.status === "dry_run")) {
        for (const output of allOutputsRef.current) {
          void dispatch(previewOutput({ pipelineId: id, outputId: output.id }));
        }
      }
      refreshRunHistoryAfterRun();
      // HEL-242's DataType-row-invalidation dispatch (`markDataTypeRowsStale`)
      // was removed here as evaluation-1 cycle-2 CR3: the backend no longer
      // serves `outputDataTypeId` on `PipelineSummaryResponse` (that field is
      // gone), so `currentPipeline?.outputDataTypeId` was permanently
      // `undefined` and the dispatch was unreachable dead code.
    },
  });

  // ── Derived-state initialization (React recommended pattern) ──
  // Sync outputName whenever a different pipeline becomes current.
  if (currentPipeline && currentPipeline.id !== outputNamePipelineId) {
    setOutputNamePipelineId(currentPipeline.id);
    setOutputName(currentPipeline.name);
  }
  // Initialize local steps from persisted Redux data on first load.
  if (!stepsInitialized && persistedSteps.length > 0) {
    setStepsInitialized(true);
    setSteps(persistedSteps.map(pipelineStepToStep));
    // F-105 — this transition changes `stepsFingerprint` below from "" to a
    // real value, which the debounced re-analyze effect can't tell apart
    // from a genuine edit. Without this flag it fires its own /analyze
    // ~300ms after the mount effect's own immediate one (two identical
    // requests on every page open). Consumed by that effect's next run.
    skipNextAnalyzeRef.current = true;
  }

  // 3.1 Fetch pipeline and steps on mount / id change.
  // Use a ref to prevent re-dispatching for the same id (avoids loops).
  // Skip when already in a failed/loading terminal state.
  const lastFetchedIdRef = useRef<string | null>(null);
  const currentPipelineId = currentPipeline?.id;
  useEffect(() => {
    if (!id) return;
    // Do not auto-retry a failed fetch
    if (currentPipelineStatus === "failed" || currentPipelineStatus === "loading") return;
    // Already dispatched for this exact pipeline id in this render cycle
    if (lastFetchedIdRef.current === id) return;
    lastFetchedIdRef.current = id;
    loadRunHistoryWhenTruncated(id, dispatch(fetchPipelineById(id)));
    void dispatch(fetchPipelineSteps(id));
    void dispatch(analyzePipeline(id));
    void dispatch(fetchPipelineSchedule(id));
    // task 3.3 / design.md decision 2 — fetched alongside the pipeline
    // detail/steps fetch, NOT embedded in `PipelineSummaryResponse` (verified:
    // that response carries no `outputs` field).
    void dispatch(fetchOutputs({ pipelineId: id }));
  }, [dispatch, id, currentPipelineStatus, currentPipelineId, loadRunHistoryWhenTruncated]);

  // HEL-1354: the status stays "idle" until the thunk's `pending` lands, so React StrictMode's
  // dev-only effect double-invoke saw "idle" twice and issued two `GET /api/data-sources`. A
  // per-mount ref makes the second run a no-op; it never blocks a later legitimate refetch,
  // which other callers issue directly.
  const sourcesRequestedRef = useRef(false);
  useEffect(() => {
    if (sourcesStatus === "idle" && !sourcesRequestedRef.current) {
      sourcesRequestedRef.current = true;
      void dispatch(fetchSources());
    }
  }, [dispatch, sourcesStatus]);

  // The error state's Retry: re-issues the pipeline fetch only (today's retry scope) plus the same
  // truncated-banner history chain boot uses, so a retried open behaves exactly like a first open.
  const retryPipelineLoad = useCallback(() => {
    if (!id) return;
    loadRunHistoryWhenTruncated(id, dispatch(fetchPipelineById(id)));
  }, [dispatch, id, loadRunHistoryWhenTruncated]);

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
  // temp id, per `pendingDraftMetaRef`) is excluded entirely: it has no
  // server-side representation yet for /analyze to reflect, so folding it in
  // would either 404 the analyze call or dispatch one for a step the backend
  // has never seen.
  const stepsFingerprint = steps
    .filter((s) => !pendingDraftMetaRef.current.has(s.id))
    .map((s) => `${s.id}:${s.opType.id}:${s.enabled}:${JSON.stringify(s.config)}`)
    .join("|");
  stepsFingerprintRef.current = stepsFingerprint;

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
  useEffect(() => {
    if (!id || steps.length === 0) return;
    if (skipNextAnalyzeRef.current) {
      skipNextAnalyzeRef.current = false;
      lastAnalyzedFingerprintRef.current = stepsFingerprint;
      return;
    }
    const handle = window.setTimeout(() => {
      // HEL-972 (probe-findings.md D2/D3) — a run submitted while this
      // debounced dispatch was pending competes with it for the same
      // backend request-handling resources, measurably delaying that run's
      // own completion (confirmed: disabling this dispatch alone dropped
      // `hel912-lanes-rejoin.spec.ts`'s target-signature flake rate from
      // ~10-20% to ~1.7-3.3%). Deferring here, rather than dropping, is
      // deliberate: `state.analyzeResult` is written ONLY by
      // `analyzePipeline.fulfilled` (pipelinesSlice.ts) -- a run's own
      // response does NOT populate it, so an edit suppressed here must still
      // eventually dispatch, or the analyze panel is left showing
      // pre-edit/stale results with no pending request to correct it.
      if (sseActiveRef.current || analyzeStatusRef.current === "loading") {
        // HEL-972 cycle 3 -- only mark a dispatch as genuinely PENDING when
        // this is a NEW, not-yet-analyzed fingerprint. Setting this
        // unconditionally (the cycle-2 bug) also fires when the effect is
        // re-entered by `analyzeStatus` flipping to "loading" as a side
        // effect of the dispatch THIS SAME fingerprint already made -- that
        // spuriously re-arms `pendingAnalyzeRef`, which defeats the
        // fingerprint bail-out below and causes an unbounded redispatch
        // loop (measured: ~1 dispatch/830ms, indefinitely, whenever
        // /analyze resolves slower than the 300ms debounce window --
        // invisible under a fast-resolving mock, which is exactly how this
        // escaped cycle-2's own verification).
        if (lastAnalyzedFingerprintRef.current !== stepsFingerprint) {
          pendingAnalyzeRef.current = true;
          // HEL-972 final-gate CR1 — a stuck guard (SSE stream that never
          // opens/drops/misses its terminal event -- see `pendingSinceRef`'s
          // comment above) would otherwise suppress this edit's analyze,
          // and every later edit's, for the rest of the page's lifetime.
          // Start the clock on the FIRST defer for this fingerprint only
          // (don't restart it on every re-entry while still blocked).
          if (pendingSinceRef.current === null) {
            pendingSinceRef.current = Date.now();
          }
          if (deferWatchdogHandleRef.current === null) {
            deferWatchdogHandleRef.current = window.setTimeout(
              forceDeferredAnalyze,
              MAX_ANALYZE_DEFER_MS,
            );
          }
        }
        return;
      }
      // The guard is clear -- but only dispatch if there is something to
      // dispatch FOR: either a genuinely new edit since the last dispatch,
      // or an edit that was deferred while the guard was active. Without
      // this check, `analyzeStatus` clearing on its own (a side effect of
      // the PREVIOUS dispatch settling, not of any new edit) would
      // re-trigger this same effect via its own dependency and dispatch
      // again indefinitely.
      if (lastAnalyzedFingerprintRef.current === stepsFingerprint && !pendingAnalyzeRef.current) {
        return;
      }
      pendingAnalyzeRef.current = false;
      lastAnalyzedFingerprintRef.current = stepsFingerprint;
      clearDeferWatchdog();
      void dispatch(analyzePipeline(id));
    }, 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    id,
    stepsFingerprint,
    dispatch,
    sseActive,
    analyzeStatus,
    forceDeferredAnalyze,
    clearDeferWatchdog,
  ]);

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

  // task 3.3 — one array per trunk/tail step id, memoized (see
  // `selectOutputsByStepId`'s doc comment); `EMPTY_OUTPUTS` mirrors the
  // `EMPTY_ANALYZE_COLUMNS` pattern above so a step with zero Outputs gets a
  // stable `[]` reference rather than defeating `StepCard`'s `React.memo`.
  const outputsByStepId = useAppSelector((state) => selectOutputsByStepId(state, id ?? ""));
  const previewRowCountByOutputId = useAppSelector(selectPreviewRowCountByOutputId);
  // task 4.1/4.2 -- flat list feeding the "Outputs (N)" tab/gallery. Distinct
  // from `outputsByStepId` (grouped, feeds the rail): the gallery is one flat
  // grid regardless of which step each Output is off of.
  const allOutputs = useAppSelector((state) => selectOutputsForPipeline(state, id ?? ""));
  allOutputsRef.current = allOutputs;

  // task 5.1 — `OutputEditorSheet.tsx` opens against either an existing
  // Output (edit) or a target step id with no Output yet (create, `stepId`
  // omitted = pipeline root; the sheet's own step-picker, task 4.4, then
  // lets the user change it before the first save).
  const [outputSheet, setOutputSheet] = useState<{
    output: Output | null;
    createTargetStepId?: string;
  } | null>(null);
  const handleOpenOutput = useCallback((output: Output) => {
    setOutputSheet({ output });
  }, []);
  // HEL-1277 — the per-Output History view (scrubber); separate from the editor sheet above.
  const [historyOutput, setHistoryOutput] = useState<Output | null>(null);
  const handleOpenOutputHistory = useCallback((output: Output) => setHistoryOutput(output), []);
  const handleCloseOutputHistory = useCallback(() => setHistoryOutput(null), []);
  const handleAddOutput = useCallback((stepId?: string) => {
    setOutputSheet({ output: null, createTargetStepId: stepId });
  }, []);
  const handleCloseOutputSheet = useCallback(() => {
    setOutputSheet(null);
  }, []);

  // HEL-909 — the Panel sheet's "Output link" deep-links here as
  // `/pipelines/:id?outputId=<id>` (no pre-existing OutputEditorSheet
  // deep-link convention exists to follow — this is the new one). Opens the
  // sheet once the matching Output has loaded into `allOutputs`; clears the
  // param afterward so a later manual close doesn't immediately reopen it.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const targetOutputId = searchParams.get("outputId");
    if (!targetOutputId) return;
    const target = allOutputs.find((o) => o.id === targetOutputId);
    if (!target) return;
    setOutputSheet({ output: target });
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("outputId");
        return next;
      },
      { replace: true },
    );
  }, [searchParams, allOutputs, setSearchParams]);

  // HEL-1022 — takes the target source's id explicitly rather than closing
  // over a single "the bound source" (there can be several now); the caller
  // (`PipelineDetailHeader`) resolves which root's source this is per chip.
  const handleEditSource = useCallback(
    (sourceId: string) => {
      // Deep-links straight to the source now that `/sources/:id` exists; this
      // previously set a Redux selection and landed on `/sources`, relying on
      // that page to resolve it.
      void navigate(`/sources/${sourceId}`);
    },
    [navigate],
  );

  // Toggles `enabled` from the bar without opening the dialog — persists the
  // same kind/expression/timezone (spec: "Disabling from the bar").
  const handleToggleScheduleEnabled = useCallback(
    (nextEnabled: boolean) => {
      if (!id || !pipelineSchedule) return;
      void dispatch(
        savePipelineSchedule({
          pipelineId: id,
          request: {
            kind: pipelineSchedule.kind,
            expression: pipelineSchedule.expression,
            enabled: nextEnabled,
            timezone: pipelineSchedule.timezone,
          },
        }),
      );
    },
    [dispatch, id, pipelineSchedule],
  );

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

  // HEL-908 Cycle 13 -- `submitPipelineRun`'s own HTTP response already
  // carries the finished run's result (it's a synchronous POST, not a
  // fire-and-forget kickoff); the SSE stream (`usePipelineRunEvents`) is a
  // best-effort progress channel layered on top, and `PipelineDetailFooter`'s
  // "Run status" label already falls back to this thunk's own status the
  // moment it resolves (`sseData.status ?? runStatus`) rather than waiting
  // on an SSE terminal event. A probe run confirmed the SSE `onTerminal`
  // callback (below, in `usePipelineRunEvents`'s options) can fire well
  // after this thunk already resolved, or not at all within a normal dry
  // run's lifetime in dev -- so it alone is not a reliable trigger for
  // refreshing rail-chip previews. This dispatches the refresh right where
  // the run is actually known to be done; the SSE `onTerminal` handler below
  // still does the same thing too, for the one case this can't cover (a run
  // that was already in flight when the page mounted, submitted from
  // elsewhere).
  const refreshVisibleOutputPreviews = useCallback(
    (targetPipelineId: string) => {
      for (const output of allOutputsRef.current) {
        void dispatch(previewOutput({ pipelineId: targetPipelineId, outputId: output.id }));
      }
    },
    [dispatch],
  );

  const handleRunPipeline = useCallback(async () => {
    if (!id) return;
    setSseActive(true);
    try {
      await dispatch(submitPipelineRun({ pipelineId: id })).unwrap();
      refreshRunHistoryAfterRun();
      refreshVisibleOutputPreviews(id);
    } catch {
      setSseActive(false);
      // runError is displayed via Redux state
    }
  }, [dispatch, id, refreshVisibleOutputPreviews, refreshRunHistoryAfterRun]);

  const handleDryRun = useCallback(async () => {
    if (!id) return;
    setSseActive(true);
    try {
      await dispatch(submitPipelineRun({ pipelineId: id, dryRun: true })).unwrap();
      refreshRunHistoryAfterRun();
      refreshVisibleOutputPreviews(id);
    } catch {
      setSseActive(false);
      // runError is displayed via Redux state
    }
  }, [dispatch, id, refreshVisibleOutputPreviews, refreshRunHistoryAfterRun]);

  // HEL-1096 design.md D5/D7 — the denial block's own "Run to update" control, shown when
  // `costVerdict.autoRunnable` is false and `costVerdict.canRun` is true (see the returned
  // `costVerdict` below). Reuses the SAME shared handler the denial toast's action uses
  // (`useRunToUpdate`) rather than `handleRunPipeline` above — this is a distinct manual-run
  // trigger for the gate-denial case, not a retrofit of the pre-existing always-visible "Run
  // pipeline" button (design.md Non-Goals).
  const runToUpdateAction = useRunToUpdate();
  const handleRunToUpdate = useCallback(() => {
    if (!id) return;
    runToUpdateAction(id);
  }, [id, runToUpdateAction]);

  const handleSave = useCallback(async () => {
    if (!id) return;
    try {
      await dispatch(updatePipeline({ id, name: outputName })).unwrap();
      void navigate("/pipelines");
    } catch {
      // updateError is shown via Redux state
    }
  }, [dispatch, id, outputName, navigate]);

  const handleCancel = useCallback(() => {
    if (isDirty) {
      setIsConfirmingCancel(true);
    } else {
      void navigate("/pipelines");
    }
  }, [isDirty, navigate]);

  const confirmCancelDiscard = useCallback(() => {
    setIsConfirmingCancel(false);
    void navigate("/pipelines");
  }, [navigate]);

  const dismissCancelConfirm = useCallback(() => {
    setIsConfirmingCancel(false);
  }, []);

  return {
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
