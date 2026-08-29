import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { RunHistoryModal } from "./RunHistoryModal";
import { PipelinePreviewModal } from "./PipelinePreviewModal";
import { PipelineDetailFooter } from "./PipelineDetailFooter";
import { PipelineRiverView } from "./PipelineRiverView";
import { PipelineDetailHeader } from "./PipelineDetailHeader";
import { PipelineScheduleDialog } from "./schedule/PipelineScheduleDialog";
import { PipelineShareDialog } from "./PipelineShareDialog";
import { PipelineDetailSkeleton } from "./PipelineDetailSkeleton";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { ERROR_KIND_ICON } from "../../../shared/chrome/InlineError";

import { extractErrorMessage } from "../../../services/extractErrorMessage";

import "./PipelineDetailPage.css";
import { fetchSources } from "../../sources/state/sourcesSlice";
import { fetchDataTypes } from "../../dataTypes/state/dataTypesSlice";
import { markDataTypeRowsStale } from "../../panels/state/panelsSlice";
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
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { usePipelineRunEvents } from "../hooks/usePipelineRunEvents";
import type { RunStatusEventData } from "../hooks/usePipelineRunEvents";
import {
  createPipelineStep,
  deletePipelineStep,
  duplicatePipelineStep,
  reorderPipelineSteps,
  updatePipelineStepEnabled,
} from "../services/pipelineService";
import { useToast } from "../../toasts/hooks/useToast";
import type { PipelineStepConfig, PipelineStepKind, SchemaField } from "../types/pipelineStep";
import type { ShapeStepExpansion } from "../types/pipelineShape";
import type { OpType, Step } from "../types/step";

// F-146 — module-level (not per-render) so a step with no analyze data yet
// gets the same empty-array reference on every call, not a fresh `[]` per
// lookup; see `analyzeByStepId` below for why that reference stability
// matters for `StepCard`'s `React.memo`.
const EMPTY_ANALYZE_COLUMNS: string[] = [];
const EMPTY_ANALYZE_SCHEMA: SchemaField[] = [];

export function PipelineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { push: pushToast } = useToast();

  const { items: sources, status: sourcesStatus } = useAppSelector((state) => state.sources);
  const { items: dataTypes, status: dataTypesStatus } = useAppSelector((state) => state.dataTypes);
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
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
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
      if (id) void dispatch(fetchPipelineRunHistory(id));
      // HEL-242 — a successful run rewrote the bound DataType's rows via
      // `dataTypeRowRepo.overwriteRows`. Invalidate every panel bound to that
      // DataType so the dashboard view refetches on its next render tick.
      // Failed runs intentionally skip this: `overwriteRows` is transactional,
      // so failed runs did not touch persisted rows.
      const outputDataTypeId = currentPipeline?.outputDataTypeId;
      if (event.status === "succeeded" && outputDataTypeId) {
        dispatch(markDataTypeRowsStale(outputDataTypeId));
      }
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
  }, [dispatch, id, currentPipelineStatus, currentPipelineId]);

  useEffect(() => {
    if (sourcesStatus === "idle") {
      void dispatch(fetchSources());
    }
  }, [dispatch, sourcesStatus]);

  // ── DataTypes (HEL-260 — ownership check for the "Edit Type" button) ──
  useEffect(() => {
    if (dataTypesStatus === "idle") {
      void dispatch(fetchDataTypes());
    }
  }, [dispatch, dataTypesStatus]);

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

  function getAnalyzeColumns(stepId: string): string[] {
    return analyzeByStepId.get(stepId)?.columns ?? EMPTY_ANALYZE_COLUMNS;
  }

  function getAnalyzeSchema(stepId: string): SchemaField[] {
    return analyzeByStepId.get(stepId)?.schema ?? EMPTY_ANALYZE_SCHEMA;
  }

  // HEL-404 — mirror of getAnalyzeSchema, reading outputSchema instead of
  // inputSchema, so StepCard can render the step's output schema inline in
  // its preview tray without any new backend call.
  function getAnalyzeOutputSchema(stepId: string): SchemaField[] {
    return analyzeByStepId.get(stepId)?.outputSchema ?? EMPTY_ANALYZE_SCHEMA;
  }

  function getAnalyzeValidationError(stepId: string): string | undefined {
    return analyzeByStepId.get(stepId)?.validationError;
  }

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
  const boundOutputType = dataTypes.find((dt) => dt.id === currentPipeline?.outputDataTypeId);
  const canEditType = boundOutputType !== undefined;
  const isOwner =
    currentPipeline?.ownerId != null &&
    currentUser?.id != null &&
    currentUser.id === currentPipeline.ownerId;

  function handleEditSource() {
    if (!boundSource) return;
    // Deep-links straight to the source now that `/sources/:id` exists; this
    // previously set a Redux selection and landed on `/sources`, relying on
    // that page to resolve it.
    void navigate(`/sources/${boundSource.id}`);
  }

  function handleEditType() {
    if (!currentPipeline?.outputDataTypeId) return;
    // Deep-links straight to the type now that `/registry/:id` is the detail
    // route; this previously set a Redux selection and landed on `/registry`,
    // which is the section overview and would no longer resolve it.
    void navigate(`/registry/${currentPipeline.outputDataTypeId}`);
  }

  // Toggles `enabled` from the bar without opening the dialog — persists the
  // same kind/expression/timezone (spec: "Disabling from the bar").
  function handleToggleScheduleEnabled(nextEnabled: boolean) {
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
  }

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
  async function handleInsertStep(opType: OpType, index: number) {
    if (!id) return;
    setStepsInitialized(true);
    const tempStep = makeStep(opType);
    const isAppend = index >= steps.length;
    setSteps((prev) => {
      const next = [...prev];
      next.splice(index, 0, tempStep);
      return next;
    });
    try {
      const initialConfig = defaultConfigFor(opType.id);
      const persisted = await createPipelineStep(
        id,
        opType.id as PipelineStepKind,
        initialConfig,
        isAppend ? undefined : index,
      );
      setSteps((prev) =>
        prev.map((s) => (s.id === tempStep.id ? pipelineStepToStep(persisted) : s)),
      );
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
  }

  function handleAddStep(opType: OpType) {
    void handleInsertStep(opType, steps.length);
  }

  // HEL-402 — "Start from a shape": sequentially persists each of a shape's
  // expanded steps, appending after any steps already present (design.md
  // Decision 3). Mirrors `handleAddStep`'s single-step persistence, extended
  // to a loop: on a mid-loop failure, stop (no further steps attempted),
  // keep whatever already succeeded (no compensating delete — matches
  // `handleRemoveStep`'s existing no-rollback semantics), and surface a
  // visible toast naming how many of N steps were added (design.md Decision
  // 6) — never a silent partial application.
  async function handleInstantiateShape(expansions: ShapeStepExpansion[]) {
    if (!id) return;
    setStepsInitialized(true);
    let createdCount = 0;
    for (const expansion of expansions) {
      try {
        const persisted = await createPipelineStep(id, expansion.kind, expansion.config);
        setSteps((prev) => [...prev, pipelineStepToStep(persisted)]);
        createdCount += 1;
      } catch (err: unknown) {
        const message = extractErrorMessage(err, "Failed to create step.");
        pushToast({
          variant: "error",
          message: `Shape only partially applied: ${createdCount} of ${expansions.length} steps were added (${message}).`,
        });
        return;
      }
    }
  }

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
        void deletePipelineStep(stepId).catch((err: unknown) => {
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
    [pushToast],
  );

  // HEL-407 — drag/keyboard reorder handler (design.md Decision 7). `newOrder`
  // is the full reordered `Step[]` computed by `PipelineRiverView` (drop or
  // Move up/down). The page owns persistence, mirroring every other step
  // mutation here (local `setSteps` + a plain service call, not a thunk):
  // (a) snapshot the previous order, (b) reorder optimistically, (c) PUT the
  // *persisted* step ids only, (d) reconcile the response into the optimistic
  // order by id on success, (e) revert + toast on failure — never a silently
  // lost reorder.
  const handleReorderSteps = useCallback(
    async (newOrder: Step[]) => {
      if (!id) return;
      const previousOrder = stepsRef.current;
      setSteps(newOrder);
      // Temp (`step-N`) steps have no backend row yet — a still-in-flight POST
      // from handleAddStep/handleInstantiateShape. Sending one would fail the
      // server's set-equality check, so exclude them (mirrors handleRemoveStep's
      // temp-id no-op convention above).
      const persistedIds = newOrder.filter((s) => !s.id.startsWith("step-")).map((s) => s.id);
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
        const created = await duplicatePipelineStep(stepId);
        setSteps((prev) => {
          const index = prev.findIndex((s) => s.id === stepId);
          if (index === -1) return prev;
          const next = [...prev];
          next.splice(index + 1, 0, pipelineStepToStep(created));
          return next;
        });
      } catch (err: unknown) {
        const message = extractErrorMessage(err, "Failed to duplicate step.");
        pushToast({ variant: "error", message: `Failed to duplicate step: ${message}` });
      }
    },
    [pushToast],
  );

  async function handleRunPipeline() {
    if (!id) return;
    setSseActive(true);
    try {
      await dispatch(submitPipelineRun({ pipelineId: id })).unwrap();
      void dispatch(fetchPipelineRunHistory(id));
    } catch {
      setSseActive(false);
      // runError is displayed via Redux state
    }
  }

  async function handleDryRun() {
    if (!id) return;
    setSseActive(true);
    try {
      await dispatch(submitPipelineRun({ pipelineId: id, dryRun: true })).unwrap();
      void dispatch(fetchPipelineRunHistory(id));
    } catch {
      setSseActive(false);
      // runError is displayed via Redux state
    }
  }

  async function handleSave() {
    if (!id) return;
    try {
      await dispatch(updatePipeline({ id, name: outputName })).unwrap();
      void navigate("/pipelines");
    } catch {
      // updateError is shown via Redux state
    }
  }

  function handleCancel() {
    if (isDirty) {
      setIsConfirmingCancel(true);
    } else {
      void navigate("/pipelines");
    }
  }

  function confirmCancelDiscard() {
    setIsConfirmingCancel(false);
    void navigate("/pipelines");
  }

  function dismissCancelConfirm() {
    setIsConfirmingCancel(false);
  }

  // ── Loading / Error guards ──
  // Show error if we have a known error and no pipeline data yet.
  // This takes priority over loading so a re-fetch does not hide the error.
  if (currentPipeline === null && currentPipelineError !== null) {
    const kind = currentPipelineErrorKind ?? "error";
    const Icon = ERROR_KIND_ICON[kind];
    const description =
      kind === "not-found"
        ? "We couldn't find this pipeline. It may have been deleted, or you may not have access to it."
        : kind === "forbidden"
          ? "You don't have access to this pipeline."
          : currentPipelineError;
    return (
      <div className="pipeline-detail-page">
        <EmptyState
          intent="error"
          icon={<Icon />}
          title="Couldn't load this pipeline"
          description={description}
          cta={
            kind === "error" && id !== undefined
              ? {
                  label: currentPipelineStatus === "loading" ? "Retrying…" : "Retry",
                  onClick: () => dispatch(fetchPipelineById(id)),
                  disabled: currentPipelineStatus === "loading",
                }
              : undefined
          }
        />
      </div>
    );
  }

  // Show loading when we have no pipeline data yet
  if (currentPipeline === null) {
    return (
      <div className="pipeline-detail-page" aria-label="Loading pipeline">
        <PipelineDetailSkeleton />
      </div>
    );
  }

  return (
    <div className="pipeline-detail-page">
      {/* ── Header: bound source + bound type + schedule ── */}
      <PipelineDetailHeader
        sourceName={currentPipeline.sourceDataSourceName}
        source={boundSource}
        canEditSource={canEditSource}
        onEditSource={handleEditSource}
        outputTypeName={currentPipeline.outputDataTypeName}
        canEditType={canEditType}
        onEditType={handleEditType}
        schedule={pipelineSchedule}
        onEditSchedule={() => setScheduleOpen(true)}
        onToggleScheduleEnabled={handleToggleScheduleEnabled}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenPreview={() => setPreviewModalOpen(true)}
        isOwner={isOwner}
        onOpenShare={() => setShareOpen(true)}
      />

      {/* ── HEL-861: run-truncation warning — shown only when the last run's source read (or a
          join/union/lookup secondary read) was capped. Renders the server-composed notice
          verbatim (design.md D7) so the human sees exactly what an MCP agent reads. ── */}
      {runSourceTruncated && runTruncationNotice && (
        <div className="pipeline-detail-page__truncation-banner" role="alert">
          <span className="pipeline-detail-page__truncation-banner-icon" aria-hidden="true">
            ⚠
          </span>
          <span className="pipeline-detail-page__truncation-banner-text">
            {runTruncationNotice}
          </span>
        </div>
      )}

      {/* ── River view ── */}
      <PipelineRiverView
        steps={steps}
        pipelineId={id ?? ""}
        dropdownOpen={dropdownOpenAt === "bottom"}
        openDropdown={() => setDropdownOpenAt("bottom")}
        closeDropdown={() => setDropdownOpenAt(null)}
        onAddStep={handleAddStep}
        onInsertStep={(opType, index) => void handleInsertStep(opType, index)}
        onRemoveStep={handleRemoveStep}
        getAnalyzeColumns={getAnalyzeColumns}
        getAnalyzeSchema={getAnalyzeSchema}
        getAnalyzeOutputSchema={getAnalyzeOutputSchema}
        getAnalyzeValidationError={getAnalyzeValidationError}
        onStepConfigChange={handleStepConfigChange}
        runStepRowCounts={runStepRowCounts}
        onInstantiateShape={handleInstantiateShape}
        // F-146 — passed directly (not `(newOrder) => void handleX(newOrder)`):
        // that wrapper allocated a fresh function every render, which — since
        // `onReorderSteps`/`onToggleStepEnabled`/`onDuplicateStep` feed
        // `StepCard` props (the latter two directly; `onReorderSteps` via
        // `PipelineRiverView`'s own `onMoveUp`/`onMoveDown`) — defeated
        // `StepCard`'s `React.memo` regardless of the `useCallback` above.
        onReorderSteps={handleReorderSteps}
        onToggleStepEnabled={handleToggleStepEnabled}
        onDuplicateStep={handleDuplicateStep}
      />

      {/* ── Footer bar ── */}
      <PipelineDetailFooter
        editingOutputName={editingOutputName}
        outputName={outputName}
        pipelineName={pipelineName}
        setOutputName={setOutputName}
        setEditingOutputName={setEditingOutputName}
        stepCount={steps.length}
        outputSchema={steps.length > 0 ? getAnalyzeOutputSchema(steps[steps.length - 1].id) : []}
        sseData={sseData}
        runStatus={runStatus}
        runError={runError}
        runIsDry={runIsDry}
        runResult={runResult}
        isDirty={isDirty}
        updateError={updateError}
        updateStatus={updateStatus}
        isConfirmingCancel={isConfirmingCancel}
        handleSave={() => void handleSave()}
        confirmCancelDiscard={confirmCancelDiscard}
        dismissCancelConfirm={dismissCancelConfirm}
        handleCancel={handleCancel}
        handleDryRun={() => void handleDryRun()}
        handleRunPipeline={handleRunPipeline}
        lastRunAt={currentPipeline.lastRunAt}
        lastRunRowCount={currentPipeline.lastRunRowCount}
        lastRunStatus={currentPipeline.lastRunStatus}
      />

      {/* ── Run history modal (opened from the header's actions menu) ── */}
      {historyOpen && <RunHistoryModal runs={runs} onClose={() => setHistoryOpen(false)} />}

      {/* ── Pipeline output preview modal ── */}
      {previewModalOpen && (
        <PipelinePreviewModal
          rows={runResult}
          rowCount={
            sseData?.rowCount !== null && sseData?.rowCount !== undefined
              ? sseData.rowCount
              : (runResult?.length ?? null)
          }
          isDry={runIsDry}
          onClose={() => setPreviewModalOpen(false)}
          outputDataTypeId={currentPipeline.outputDataTypeId}
          lastRunAt={currentPipeline.lastRunAt}
          lastRunRowCount={currentPipeline.lastRunRowCount}
          onRunPipeline={handleRunPipeline}
          onDryRun={() => void handleDryRun()}
        />
      )}

      {/* ── Share dialog (owner-only) ── */}
      {id && (
        <PipelineShareDialog
          pipelineId={id}
          pipelineName={pipelineName}
          open={shareOpen}
          onClose={() => setShareOpen(false)}
        />
      )}

      {/* ── Schedule dialog ── */}
      {id && (
        <PipelineScheduleDialog
          pipelineId={id}
          schedule={pipelineSchedule}
          open={scheduleOpen}
          onClose={() => setScheduleOpen(false)}
        />
      )}

      {/* In-page back breadcrumb removed — the section breadcrumb in the top
       * command bar already shows "Data Pipelines / <pipeline name>". */}
    </div>
  );
}
