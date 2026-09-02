import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { fetchSources } from "../../sources/state/sourcesSlice";
import {
  analyzePipeline,
  clearRunState,
  fetchPipelineById,
  fetchPipelineRunHistory,
  fetchPipelineSchedule,
  fetchPipelineSteps,
  savePipelineSchedule,
  submitPipelineRun,
  updatePipeline,
} from "../state/pipelinesSlice";
import { defaultConfigFor, makeStep, pipelineStepToStep } from "../state/stepNarrowing";
import { buildStepTree } from "../state/stepTree";
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
import {
  createPipelineStep,
  deletePipelineStep,
  duplicatePipelineStep,
  reorderPipelineSteps,
  updatePipelineStepEnabled,
} from "../services/pipelineService";
import { createOutput } from "../services/outputService";
import { useToast } from "../../toasts/hooks/useToast";
import type {
  AggregateConfig,
  PipelineStepConfig,
  PipelineStepKind,
  SchemaField,
} from "../types/pipelineStep";
import type { ExpandPipelineShapeResponse } from "../types/pipelineShape";
import type { OpType, Step } from "../types/step";

// F-146 — module-level (not per-render) so a step with no analyze data yet
// gets the same empty-array reference on every call, not a fresh `[]` per
// lookup; see `analyzeByStepId` below for why that reference stability
// matters for `StepCard`'s `React.memo`.
const EMPTY_ANALYZE_COLUMNS: string[] = [];
const EMPTY_ANALYZE_SCHEMA: SchemaField[] = [];

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
    runHistory,
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

  // Per-pipeline schedule (HEL-416) — `undefined` while not yet fetched,
  // `null` once fetched and confirmed absent.
  const pipelineSchedule = useAppSelector((state) =>
    id ? (state.pipelines.schedule?.[id] ?? null) : null,
  );

  const runs = id ? (runHistory[id] ?? []) : [];
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
  const [outputName, setOutputName] = useState("");
  const [editingOutputName, setEditingOutputName] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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
      if (id) void dispatch(fetchPipelineRunHistory(id));
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
    void dispatch(fetchPipelineById(id));
    void dispatch(fetchPipelineSteps(id));
    void dispatch(analyzePipeline(id));
    void dispatch(fetchPipelineSchedule(id));
    // task 3.3 / design.md decision 2 — fetched alongside the pipeline
    // detail/steps fetch, NOT embedded in `PipelineSummaryResponse` (verified:
    // that response carries no `outputs` field).
    void dispatch(fetchOutputs({ pipelineId: id }));
  }, [dispatch, id, currentPipelineStatus, currentPipelineId]);

  useEffect(() => {
    if (sourcesStatus === "idle") {
      void dispatch(fetchSources());
    }
  }, [dispatch, sourcesStatus]);

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
  const stepsFingerprint = steps
    .map((s) => `${s.id}:${s.opType.id}:${s.enabled}:${JSON.stringify(s.config)}`)
    .join("|");

  // HEL-908 task 3.4 — trunk/tail grouping (design.md decision 1), recomputed
  // only when the steps array itself changes.
  const stepTree = useMemo(() => buildStepTree(steps), [steps]);
  useEffect(() => {
    if (!id || steps.length === 0) return;
    if (skipNextAnalyzeRef.current) {
      skipNextAnalyzeRef.current = false;
      return;
    }
    const handle = window.setTimeout(() => {
      void dispatch(analyzePipeline(id));
    }, 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, stepsFingerprint, dispatch]);

  useEffect(() => {
    if (id) {
      void dispatch(fetchPipelineRunHistory(id));
    }
  }, [dispatch, id]);

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

  // ── Per-step analyze columns / schema ──
  // Build helpers from step.id → inputSchema data so each StepCard can receive
  // the correct columns/schema without re-running the analyze logic in the UI.
  //
  // F-146 — this used to be 4 separate `.find()` scans over
  // `analyzeResult.steps` per lookup, called fresh for every StepCard on
  // every render (any keystroke in any one step's config re-renders
  // `PipelineDetailPage`, since `steps` state changes). Besides the
  // repeated O(n) scans, every call minted a brand-new array (`.map()` for
  // columns; even the pass-through `inputSchema`/`outputSchema` reads were
  // wrapped in a fresh closure invocation each time) — so even an unrelated
  // step's `StepCard` received new-identity `analyzeColumns`/`analyzeSchema`/
  // `analyzeOutputSchema` props every render, which defeats `React.memo`'s
  // shallow prop comparison (see `StepCard.tsx`) regardless of whether the
  // underlying `analyzeResult` actually changed. Built once per
  // `analyzeResult` change instead; lookups below are O(1) Map reads that
  // return the *same* array reference across renders until analyze data
  // itself changes.
  const analyzeByStepId = useMemo(() => {
    const map = new Map<
      string,
      {
        columns: string[];
        schema: SchemaField[];
        outputSchema: SchemaField[];
        validationError?: string;
      }
    >();
    if (analyzeResult) {
      for (const s of analyzeResult.steps) {
        map.set(s.id, {
          columns: s.inputSchema.map((f) => f.name),
          schema: s.inputSchema,
          outputSchema: s.outputSchema,
          validationError: s.validationError,
        });
      }
    }
    return map;
  }, [analyzeResult]);

  const getAnalyzeColumns = useCallback(
    (stepId: string): string[] => analyzeByStepId.get(stepId)?.columns ?? EMPTY_ANALYZE_COLUMNS,
    [analyzeByStepId],
  );

  const getAnalyzeSchema = useCallback(
    (stepId: string): SchemaField[] => analyzeByStepId.get(stepId)?.schema ?? EMPTY_ANALYZE_SCHEMA,
    [analyzeByStepId],
  );

  // HEL-404 — mirror of getAnalyzeSchema, reading outputSchema instead of
  // inputSchema, so StepCard can render the step's output schema inline in
  // its preview tray without any new backend call.
  const getAnalyzeOutputSchema = useCallback(
    (stepId: string): SchemaField[] =>
      analyzeByStepId.get(stepId)?.outputSchema ?? EMPTY_ANALYZE_SCHEMA,
    [analyzeByStepId],
  );

  const getAnalyzeValidationError = useCallback(
    (stepId: string): string | undefined => analyzeByStepId.get(stepId)?.validationError,
    [analyzeByStepId],
  );

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
  const boundSource = sources.find((s) => s.id === currentPipeline?.sourceDataSourceId);
  const canEditSource = boundSource !== undefined;
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

  const handleEditSource = useCallback(() => {
    if (!boundSource) return;
    // Deep-links straight to the source now that `/sources/:id` exists; this
    // previously set a Redux selection and landed on `/sources`, relying on
    // that page to resolve it.
    void navigate(`/sources/${boundSource.id}`);
  }, [boundSource, navigate]);

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

  // evaluation-2.md CR9 — any create call that passes a `parentStepId` without
  // `attachAsTail` (a trunk splice-insert) can reparent the anchor's OTHER
  // existing children server-side (`spliceInsertAtInternal`); a tail-attach
  // create can't reparent siblings itself, but a later trunk-append past that
  // same anchor can. Patching only the one temp-to-persisted element (the old
  // behavior) leaves every other step's `parentStepId`/`position` in local
  // state stale, so `buildStepTree` — fed stale inputs — renders the wrong
  // tree until a hard reload re-fetches. Refetching the FULL list here after
  // every create keeps local state byte-for-byte what a reload would show
  // (verified live, see execution-progress.md Cycle 3 for HEL-908).
  const syncStepsFromServer = useCallback(async () => {
    if (!id) return;
    const { steps: freshSteps } = await dispatch(fetchPipelineSteps(id)).unwrap();
    setSteps(freshSteps.map(pipelineStepToStep));
  }, [id, dispatch]);

  // HEL-410 — generalizes the former `handleAddStep` to insert at any list
  // index (0 = before the first step): optimistic splice at `index` → create
  // with `position` → reconcile the temp step in place on success → keep the
  // temp + toast on failure (the existing append-failure convention,
  // unchanged). `index === steps.length` at call time is exactly the append
  // case (the gap affordance below never offers an index that high — its
  // last gap sits before the final step, not after it), so `position` is
  // omitted from the network call there and the wire payload stays
  // byte-identical to the pre-HEL-410 append request (design.md Decision 6).
  // `isAppend` and `index` are both read from the same closure snapshot,
  // synchronously before the `await` below, so there is no risk of the
  // append check disagreeing with the index that was actually spliced in.
  const handleInsertStep = useCallback(
    async (opType: OpType, index: number) => {
      if (!id) return;
      setStepsInitialized(true);
      const tempStep = makeStep(opType);
      const isAppend = index >= stepsRef.current.length;
      setSteps((prev) => {
        const next = [...prev];
        next.splice(index, 0, tempStep);
        return next;
      });
      try {
        const initialConfig = defaultConfigFor(opType.id);
        await createPipelineStep(
          id,
          opType.id as PipelineStepKind,
          initialConfig,
          isAppend ? undefined : index,
        );
        // CR9 — a trunk splice-insert (this call, when not appending) can
        // reparent OTHER existing steps server-side; resync the whole list
        // rather than patching just this one element.
        await syncStepsFromServer();
      } catch (err: unknown) {
        // Keep temp step if POST fails; PATCH calls will be no-ops until ID is real.
        // Surface the failure — a silent catch here previously let a step creation
        // 404 vanish with no user feedback (evaluation-1.md change request 3).
        const message = extractErrorMessage(err, "Failed to add step.");
        pushToast({
          variant: "error",
          message: `Failed to add ${opType.label.toLowerCase()} step: ${message}`,
        });
      }
    },
    [id, pushToast, syncStepsFromServer],
  );

  const handleAddStep = useCallback(
    (opType: OpType) => {
      void handleInsertStep(opType, stepsRef.current.length);
    },
    [handleInsertStep],
  );

  // HEL-908 task 3.4/5.6 — "+ tail" create affordance, restored (Cycle 8) on top of the
  // new backend `attachTailInternal` primitive (design.md's non-goal waiver): a first pass of
  // this handler (Cycle 6) called `createPipelineStep` WITHOUT `attachAsTail`, which routes
  // through `spliceInsertAtInternal` (reparents the anchor's existing children — a trunk-insert,
  // not a branch-attach) and was removed after a live probe caught the corruption. This version
  // passes `attachAsTail = true`, which the backend now honors via `attachTailInternal` (attaches
  // as a genuine NEW sibling, no reparenting). Single-tail-per-node is enforced by the caller
  // (`StepCard`'s `hasTail` prop, computed from `buildStepTree`'s `tailsByStepId`) hiding/disabling
  // the "+ tail" affordance once a node already has one, per design.md's Phase-1 invariant.
  const handleAddTailStep = useCallback(
    async (opType: OpType, parentStepId: string) => {
      if (!id) return;
      setStepsInitialized(true);
      const tempStep = makeStep(opType, parentStepId);
      // Must land IMMEDIATELY after the anchor in the flat array, not at the
      // very end: `buildStepTree` derives tail-vs-trunk-continuation purely
      // from array order among a node's children (earlier = tail, later =
      // trunk continuation — mirroring the backend's `executionOrder`,
      // which always emits a node's tail branches directly after it and
      // before its trunk continuation). Appending at the end would put this
      // new tail AFTER the anchor's existing trunk continuation, inverting
      // the classification (reproduced live — see execution-progress.md
      // Cycle 8).
      const anchorIndex = stepsRef.current.findIndex((s) => s.id === parentStepId);
      const insertIndex = anchorIndex === -1 ? stepsRef.current.length : anchorIndex + 1;
      setSteps((prev) => {
        const next = [...prev];
        next.splice(insertIndex, 0, tempStep);
        return next;
      });
      try {
        const initialConfig = defaultConfigFor(opType.id);
        await createPipelineStep(
          id,
          opType.id as PipelineStepKind,
          initialConfig,
          undefined,
          parentStepId,
          true,
        );
        // CR9 — a tail-attach itself never reparents siblings, but keeping
        // this handler symmetric with `handleInsertStep`'s resync means a
        // SUBSEQUENT trunk-append (which CAN reparent this tail's anchor)
        // always starts from server-fresh local state, not a value stale
        // since whichever earlier create last did a one-element patch.
        await syncStepsFromServer();
      } catch (err: unknown) {
        const message = extractErrorMessage(err, "Failed to add tail step.");
        pushToast({
          variant: "error",
          message: `Failed to add ${opType.label.toLowerCase()} tail: ${message}`,
        });
      }
    },
    [id, pushToast, syncStepsFromServer],
  );

  // HEL-908 task 5.6 — "Add as tail with aggregate": issues the two calls
  // design.md decision 5 specifies (`POST /pipelines/:id/steps` with kind
  // `aggregate`/`parentStepId`/`attachAsTail: true`, then
  // `POST /pipelines/:id/outputs` with `nodeStepId` = the new step), and
  // rolls the step back if the Output create fails (no orphaned aggregate
  // tail left behind on a failed save). Mirrors `handleAddTailStep`'s local
  // `steps` state update so the new node renders in the river immediately,
  // and refreshes the Outputs list so the rail/gallery pick up the new
  // Output without a full page reload.
  const handleAddOutputViaAggregateTail = useCallback(
    async (
      parentStepId: string,
      aggregateConfig: AggregateConfig,
      outputPayload: { kind: string; name: string; config: Record<string, unknown> },
    ): Promise<Output> => {
      if (!id) throw new Error("Missing pipeline id");
      const persistedStep = await createPipelineStep(
        id,
        "aggregate",
        aggregateConfig,
        undefined,
        parentStepId,
        true,
      );
      // CR9 — resync from the server rather than appending the new step at
      // the end of the local array: appending doesn't place it after its
      // actual anchor, and (symmetrically with `handleInsertStep`/
      // `handleAddTailStep`) any subsequent trunk-append can reparent this
      // tail's siblings, so local state must already be server-fresh.
      await syncStepsFromServer();
      try {
        const output = await createOutput(id, {
          nodeStepId: persistedStep.id,
          kind: outputPayload.kind,
          name: outputPayload.name,
          config: outputPayload.config,
        });
        void dispatch(fetchOutputs({ pipelineId: id }));
        // HEL-908 Cycle 13 -- same staleness gap as the sheet's create path:
        // without this the new tail's rail chip shows no preview until its
        // sheet is opened once.
        void dispatch(previewOutput({ pipelineId: id, outputId: output.id }));
        return output;
      } catch (err: unknown) {
        // Rollback (design.md decision 5): the step was created but the
        // Output failed to save -- delete the orphaned aggregate tail
        // rather than leaving it behind for the caller to notice later.
        setSteps((prev) => prev.filter((s) => s.id !== persistedStep.id));
        void deletePipelineStep(persistedStep.id).catch(() => {});
        throw err;
      }
    },
    [id, dispatch, syncStepsFromServer],
  );

  // HEL-402 / HEL-908 task 6.3 — "Add Outputs from a shape": persists a
  // shape's `expand` response against a chosen anchor node (design.md
  // decision 11). The response has NO real step ids — `steps[].clientId` is
  // a synthetic intra-response id and `steps[].parentStepId`, when present,
  // references another entry's `clientId`, not a persisted step. So this
  // walks the response in order, maintaining a `clientId -> real id` map:
  // - The FIRST step (no `clientId`-parent inside this response, i.e. the
  //   response's own root) is created with `parentStepId` = `anchorStepId`
  //   (or omitted for the zero-step/new-pipeline case), with plain
  //   trunk-continuation semantics (no `attachAsTail`). `PipelineRiverView`'s
  //   two shape-picker triggers only ever pass an anchor that is either
  //   `undefined` (the empty-pipeline state) or the pipeline's trunk-last
  //   step — never a mid-trunk node — and (skeptic-final-2, round 1) the
  //   button is now gated by `hasTail` so a trunk-last anchor that already
  //   has a tail can never reach here in the first place. A PREVIOUS version
  //   of this handler set `attachAsTail: true` whenever the anchor "had a
  //   child" — which, for the only anchor this code path is ever fed
  //   (trunk-last), can ONLY mean "already has a tail", so that branch
  //   ALWAYS created a structurally-dead SECOND tail (reproduced live by the
  //   skeptic: server `trunkOf` stayed `[A, B]` while the shape's chain
  //   landed at `position >= 2` under B and was silently never executed).
  //   The defensive `anchorHasTail` refusal below is belt-and-suspenders in
  //   case the UI gate is ever bypassed or a future caller reintroduces a
  //   mid-trunk anchor.
  // - Every subsequent step resolves its `parentStepId` (a `clientId`
  //   reference) through the map to a real id, then creates with plain
  //   append semantics (no `attachAsTail`) — it's continuing a chain THIS
  //   batch just created, not attaching to a pre-existing occupied node.
  // - Any `outputs` entries (dormant on the shipped backend today — design.md
  //   decision 14) are created last, each `nodeStepId` resolved the same way.
  // On a mid-loop failure, stop (no further entries attempted), keep
  // whatever already succeeded (no compensating delete — matches
  // `handleRemoveStep`'s existing no-rollback semantics), and surface a
  // visible toast naming how many of N entries were added (design.md
  // Decision 6) — never a silent partial application.
  const handleInstantiateShape = useCallback(
    async (expansion: ExpandPipelineShapeResponse, anchorStepId?: string) => {
      if (!id) return;
      setStepsInitialized(true);
      const { steps: stepExpansions, outputs: outputExpansions = [] } = expansion;
      const totalEntries = stepExpansions.length + outputExpansions.length;
      const clientIdToRealId = new Map<string, string>();
      let createdCount = 0;

      // Defensive refusal (skeptic-final-2, round 1, CR1): a tail root is a
      // child at `position >= 1`. If the anchor already has one, attaching
      // the shape's first step as a plain trunk-continuation child would be
      // fine on its own, but the only legitimate anchor for this handler is
      // trunk-last -- and a trunk-last node with an existing tail is exactly
      // the state the UI gate (`hasTail`) is meant to prevent from reaching
      // here. Refuse rather than guess so this can never again silently
      // create a second, dead tail branch.
      const anchorHasTail =
        anchorStepId !== undefined &&
        stepsRef.current.some(
          (s) => s.parentStepId === anchorStepId && s.position !== undefined && s.position !== 0,
        );
      if (anchorHasTail) {
        pushToast({
          variant: "error",
          message: "Can't add a shape here — this step already has a tail branch.",
        });
        return;
      }

      try {
        for (let i = 0; i < stepExpansions.length; i++) {
          const stepExpansion = stepExpansions[i];
          const parentClientId = stepExpansion.parentStepId;
          const realParentId =
            parentClientId !== undefined ? clientIdToRealId.get(parentClientId) : anchorStepId;
          // Always plain trunk-continuation semantics (no `attachAsTail`):
          // the only anchor this handler is ever fed (trunk-last, or none
          // for an empty pipeline) never already has a trunk-continuation
          // child, so there is no reparenting exposure here -- see the
          // `anchorHasTail` refusal above for the one hazard that DOES
          // apply to this anchor (an existing tail).
          const persisted = await createPipelineStep(
            id,
            stepExpansion.kind,
            stepExpansion.config,
            undefined,
            realParentId,
            false,
          );
          clientIdToRealId.set(stepExpansion.clientId, persisted.id);
          setSteps((prev) => [...prev, pipelineStepToStep(persisted)]);
          createdCount += 1;
        }
        for (const outputExpansion of outputExpansions) {
          const realNodeStepId = clientIdToRealId.get(outputExpansion.nodeStepId);
          await createOutput(id, {
            nodeStepId: realNodeStepId,
            kind: outputExpansion.kind,
            name: outputExpansion.name ?? outputExpansion.kind,
            config: outputExpansion.config,
          });
          createdCount += 1;
        }
      } catch (err: unknown) {
        const message = extractErrorMessage(err, "Failed to apply shape.");
        pushToast({
          variant: "error",
          message: `Shape only partially applied: ${createdCount} of ${totalEntries} entries were added (${message}).`,
        });
        return;
      }
      // CR9 audit, corrected (skeptic-final-2, round 1, CR1) — unlike
      // `handleInsertStep`/`handleAddTailStep`/`handleAddOutputViaAggregateTail`,
      // this loop's own creates carry no reparenting exposure: the only entry
      // that can target a PRE-EXISTING node (`anchorStepId`) is the first,
      // it always uses plain trunk-continuation semantics (never
      // `attachAsTail`), and the `anchorHasTail` refusal above guarantees
      // that anchor never already has a trunk-continuation child to
      // reparent. Every later entry's `realParentId` is a step this same
      // batch just created seconds earlier, which cannot yet have any other
      // children to reparent. No resync needed here.
    },
    [id, pushToast],
  );

  // F-146 — `handleStepConfigChange` through `handleDuplicateStep` below are
  // all `StepCard` props (some via `PipelineRiverView` pass-through, some —
  // `handleReorderSteps` — indirectly, via `PipelineRiverView`'s own
  // `onMoveUp`/`onMoveDown`). Wrapped in `useCallback` with a stable
  // dependency set (reading `steps` through `stepsRef` above instead of
  // closing over it directly) so their identity doesn't change on every
  // `steps` update — the precondition for `React.memo`'s `StepCard` to
  // actually skip re-rendering the steps a given edit didn't touch.
  const handleStepConfigChange = useCallback((stepId: string, config: PipelineStepConfig) => {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, config } : s)));
  }, []);

  // HEL-535 D5 — this used to swallow a rejected DELETE with a bare no-op
  // comment: the step vanished from the view (optimistic removal below) with
  // no toast, no inline error, no console signal, and — unlike every sibling
  // step mutation in this file (reorder/enable/duplicate, all above) — it
  // never restored local state on failure, so the app disagreed with the
  // server about whether the step still existed. Now mirrors those siblings:
  // snapshot before the optimistic change, restore + toast on rejection.
  const handleRemoveStep = useCallback(
    (stepId: string) => {
      const previousSteps = stepsRef.current;
      setSteps((prev) => prev.filter((s) => s.id !== stepId));
      // Persist the deletion for steps that exist server-side. Temp steps created
      // by `makeStep` carry a local `step-N` id and have no backend row yet, so a
      // DELETE would 404. Fire-and-forget mirrors the config-PATCH path in
      // useStepCardState: local state already reflects user intent.
      if (!stepId.startsWith("step-")) {
        void deletePipelineStep(stepId)
          .then(() => {
            // CR11 — `deleteInternal` on the backend mutates steps OTHER than
            // the target: it reparents the deleted step's head child onto the
            // deleted step's own parent, AND cascade-deletes every other
            // child's entire descendant subtree (any tail). The bare local
            // `filter` above only removes the one element the user clicked,
            // leaving a cascade-deleted tail rendered as a live top-level
            // trunk card (a phantom for a row that no longer exists server-
            // side at all) until a hard reload. Resync from the server,
            // mirroring the CR9/CR10 fix on the sibling insert/duplicate
            // handlers above.
            return syncStepsFromServer();
          })
          .catch((err: unknown) => {
            setSteps(previousSteps);
            // skeptic-final-1.md CR2 — the fallback must read as a REASON, not
            // a restatement of the "Failed to delete step:" prefix below,
            // or a bodyless failure (network error, offline, aborted request,
            // non-JSON 5xx — anything extractErrorMessage can't pull a
            // server-supplied reason out of) renders "Failed to delete step:
            // Failed to delete step." — the doubled-sentence "Error" failure
            // mode the ticket's own copy AC forbids.
            const message = extractErrorMessage(err, "the request could not be completed.");
            pushToast({ variant: "error", message: `Failed to delete step: ${message}` });
          });
      }
    },
    [pushToast, syncStepsFromServer],
  );

  // HEL-407 — drag/keyboard reorder handler (design.md Decision 7). `newOrder`
  // is the full reordered `Step[]` computed by `PipelineRiverView` (drop or
  // Move up/down). The page owns persistence, mirroring every other step
  // mutation here (local `setSteps` + a plain service call, not a thunk):
  // (a) snapshot the previous order, (b) reorder optimistically, (c) PUT the
  // *persisted* step ids only, (d) reconcile the response into the optimistic
  // order by id on success, (e) revert + toast on failure — never a silently
  // lost reorder.
  //
  // HEL-908 design.md decision 15 — `PUT /steps/order`'s request-shape
  // contract is now TRUNK-ONLY (no tail ids, exactly the current trunk ids,
  // in the new order) — `reorderTrunkInternal` REJECTS a request containing
  // a tail id. `newOrder` here is still the full flat `Step[]` (trunk + any
  // tails, whatever shape the caller computed it in), so the persisted
  // request is derived via `buildStepTree(newOrder).trunk`, not a raw
  // "every non-temp id" filter — sending a flat non-trunk-filtered array
  // would 422 the instant any pipeline has a tail. A tail's own attachment
  // (`parentStepId` pointing at its trunk node's id) needs no request at
  // all: per the human's ruling ("the tail follows its trunk step"), the
  // backend never touches tail rows during a trunk reorder.
  const handleReorderSteps = useCallback(
    async (newOrder: Step[]) => {
      if (!id) return;
      const previousOrder = stepsRef.current;
      setSteps(newOrder);
      // Temp (`step-N`) steps have no backend row yet — a still-in-flight POST
      // from handleAddStep/handleInstantiateShape. Sending one would fail the
      // server's set-equality check, so exclude them (mirrors handleRemoveStep's
      // temp-id no-op convention above).
      const persistedIds = buildStepTree(newOrder)
        .trunk.filter((s) => !s.id.startsWith("step-"))
        .map((s) => s.id);
      try {
        const response = await reorderPipelineSteps(id, persistedIds);
        // Reconcile by mapping over the *optimistic* newOrder, replacing each
        // persisted entry with its corresponding response entry by id. Never
        // `setSteps(response.map(...))` wholesale — the response contains only
        // persisted steps, so a wholesale replace would drop any temp step
        // still mid-flight.
        setSteps(
          newOrder.map((s) => {
            if (s.id.startsWith("step-")) return s;
            const persisted = response.find((r) => r.id === s.id);
            return persisted ? pipelineStepToStep(persisted) : s;
          }),
        );
      } catch (err: unknown) {
        setSteps(previousOrder);
        const message = extractErrorMessage(err, "Failed to reorder steps.");
        pushToast({ variant: "error", message: `Failed to reorder steps: ${message}` });
      }
    },
    [id, pushToast],
  );

  // HEL-412 — optimistic flip → PATCH `{enabled}` → reconcile from the
  // response; revert + toast on failure (the reorder handler's precedent
  // above: a silently-lost disable is worse than a snap-back).
  const handleToggleStepEnabled = useCallback(
    async (stepId: string, enabled: boolean) => {
      const previousSteps = stepsRef.current;
      setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, enabled } : s)));
      try {
        const persisted = await updatePipelineStepEnabled(stepId, enabled);
        setSteps((prev) => prev.map((s) => (s.id === stepId ? pipelineStepToStep(persisted) : s)));
      } catch (err: unknown) {
        setSteps(previousSteps);
        const message = extractErrorMessage(err, "Failed to update step.");
        pushToast({
          variant: "error",
          message: `Failed to ${enabled ? "enable" : "disable"} step: ${message}`,
        });
      }
    },
    [pushToast],
  );

  // HEL-412 — call the duplicate endpoint, then splice the clone in directly
  // after the original (server already renumbered positions; local order is
  // what renders). Non-optimistic by design (design.md Decision 7) — there's
  // no user-entered config to preserve ahead of the response, so a temp-step
  // placeholder buys nothing for a single fast POST.
  const handleDuplicateStep = useCallback(
    async (stepId: string) => {
      try {
        await duplicatePipelineStep(stepId);
        // CR10 — `duplicatePipelineStep` hits the same server-side
        // `spliceInsertAtInternal` reparenting primitive as `handleInsertStep`:
        // splicing just the clone into local state (the old behavior) leaves
        // every other step's `parentStepId`/`position` stale, so a tailed
        // trunk step's clone renders as a tail branch and the real tail gets
        // promoted to a top-level trunk card until a hard reload. Resync from
        // the server, mirroring the other three CR9 fixes above.
        await syncStepsFromServer();
      } catch (err: unknown) {
        const message = extractErrorMessage(err, "Failed to duplicate step.");
        pushToast({ variant: "error", message: `Failed to duplicate step: ${message}` });
      }
    },
    [pushToast, syncStepsFromServer],
  );

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
      void dispatch(fetchPipelineRunHistory(id));
      refreshVisibleOutputPreviews(id);
    } catch {
      setSseActive(false);
      // runError is displayed via Redux state
    }
  }, [dispatch, id, refreshVisibleOutputPreviews]);

  const handleDryRun = useCallback(async () => {
    if (!id) return;
    setSseActive(true);
    try {
      await dispatch(submitPipelineRun({ pipelineId: id, dryRun: true })).unwrap();
      void dispatch(fetchPipelineRunHistory(id));
      refreshVisibleOutputPreviews(id);
    } catch {
      setSseActive(false);
      // runError is displayed via Redux state
    }
  }, [dispatch, id, refreshVisibleOutputPreviews]);

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
    setHistoryOpen,
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
    boundSource,
    canEditSource,
    isOwner,
    getAnalyzeColumns,
    getAnalyzeSchema,
    getAnalyzeOutputSchema,
    getAnalyzeValidationError,
    outputsByStepId,
    allOutputs,
    previewRowCountByOutputId,
    handleOpenOutput,
    handleAddOutput,
    outputSheet,
    handleCloseOutputSheet,
    handleEditSource,
    handleToggleScheduleEnabled,
    stepTree,
    handleAddStep,
    handleAddTailStep,
    handleAddOutputViaAggregateTail,
    handleInsertStep,
    handleInstantiateShape,
    handleStepConfigChange,
    handleRemoveStep,
    handleReorderSteps,
    handleToggleStepEnabled,
    handleDuplicateStep,
    handleRunPipeline,
    handleDryRun,
    handleSave,
    handleCancel,
    confirmCancelDiscard,
    dismissCancelConfirm,
  };
}
