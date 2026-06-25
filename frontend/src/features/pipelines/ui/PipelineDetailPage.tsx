import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { RunHistoryModal } from "./RunHistoryModal";
import { PipelinePreviewModal } from "./PipelinePreviewModal";
import { PipelineDetailFooter } from "./PipelineDetailFooter";
import { PipelineRiverView } from "./PipelineRiverView";
import { SourceSelectorBar } from "./SourceSelectorBar";
import { PipelineShareDialog } from "./PipelineShareDialog";

import { formatRelativeTime } from "../../../utils/formatRelativeTime";

import "./PipelineDetailPage.css";
import { fetchSources } from "../../sources/state/sourcesSlice";
import { markDataTypeRowsStale } from "../../panels/state/panelsSlice";
import {
  analyzePipeline,
  clearRunState,
  fetchPipelineById,
  fetchPipelineRunHistory,
  fetchPipelineSteps,
  submitPipelineRun,
  updatePipeline,
} from "../state/pipelinesSlice";
import { defaultConfigFor, makeStep, pipelineStepToStep } from "../state/stepNarrowing";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { usePipelineRunEvents } from "../hooks/usePipelineRunEvents";
import type { RunStatusEventData } from "../hooks/usePipelineRunEvents";
import { createPipelineStep } from "../services/pipelineService";
import type {
  AnalyzeStepResult,
  PipelineStepConfig,
  PipelineStepKind,
  SchemaField,
} from "../types/pipelineStep";
import type { OpType, Step } from "../types/step";

// ── Main page ────────────────────────────────────────────────────────────────

export function PipelineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const { items: sources, status: sourcesStatus } = useAppSelector((state) => state.sources);
  const {
    runStatus,
    runError,
    runHistory,
    runIsDry,
    runResult,
    runStepRowCounts,
    runSourceRowCount,
    currentPipeline,
    currentPipelineStatus,
    currentPipelineError,
    updateStatus,
    updateError,
    steps: reduxSteps,
  } = useAppSelector((state) => state.pipelines);

  // Per-pipeline analyze result (schema-inferred fields per step).
  const analyzeResult = useAppSelector((state) =>
    id ? (state.pipelines.analyzeResult?.[id] ?? null) : null,
  );

  const runs = id ? (runHistory[id] ?? []) : [];
  const persistedSteps = id ? (reduxSteps[id] ?? []) : [];

  const [steps, setSteps] = useState<Step[]>([]);
  const [stepsInitialized, setStepsInitialized] = useState(false);
  const [dropdownOpenAt, setDropdownOpenAt] = useState<"bottom" | null>(null);
  const [sseActive, setSseActive] = useState(false);
  const [outputName, setOutputName] = useState("");
  const [editingOutputName, setEditingOutputName] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Track which pipeline id the outputName was last initialized from
  const [outputNamePipelineId, setOutputNamePipelineId] = useState<string | null>(null);
  // Inline discard-confirm state (replaces window.confirm on dirty cancel).
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);

  const currentUser = useAppSelector((state) => state.auth.currentUser);

  // ── SSE run-status hook ──
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
  }, [dispatch, id, currentPipelineStatus, currentPipelineId]);

  // ── Sources ──
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
  const stepsFingerprint = steps
    .map((s) => `${s.id}:${s.opType.id}:${JSON.stringify(s.config)}`)
    .join("|");
  useEffect(() => {
    if (!id || steps.length === 0) return;
    const handle = window.setTimeout(() => {
      void dispatch(analyzePipeline(id));
    }, 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, stepsFingerprint, dispatch]);

  // Fetch run history on mount
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
  function getAnalyzeColumns(stepId: string): string[] {
    if (!analyzeResult) return [];
    const analyzeStep: AnalyzeStepResult | undefined = analyzeResult.steps.find(
      (s) => s.id === stepId,
    );
    return analyzeStep ? analyzeStep.inputSchema.map((f) => f.name) : [];
  }

  function getAnalyzeSchema(stepId: string): SchemaField[] {
    if (!analyzeResult) return [];
    const analyzeStep: AnalyzeStepResult | undefined = analyzeResult.steps.find(
      (s) => s.id === stepId,
    );
    return analyzeStep ? analyzeStep.inputSchema : [];
  }

  // ── Dirty-state tracking ──
  const isDirty = outputNamePipelineId !== null && outputName !== (currentPipeline?.name ?? "");

  // ── beforeunload guard ──
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
  const isOwner =
    currentPipeline?.ownerId != null &&
    currentUser?.id != null &&
    currentUser.id === currentPipeline.ownerId;

  // ── Handlers ──
  async function handleAddStep(opType: OpType) {
    if (!id) return;
    setStepsInitialized(true);
    const tempStep = makeStep(opType);
    setSteps((prev) => [...prev, tempStep]);
    try {
      const initialConfig = defaultConfigFor(opType.id);
      const persisted = await createPipelineStep(id, opType.id as PipelineStepKind, initialConfig);
      setSteps((prev) =>
        prev.map((s) => (s.id === tempStep.id ? pipelineStepToStep(persisted) : s)),
      );
    } catch {
      // Keep temp step if POST fails; PATCH calls will be no-ops until ID is real.
    }
  }

  function handleStepConfigChange(stepId: string, config: PipelineStepConfig) {
    setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, config } : s)));
  }

  function handleRemoveStep(stepId: string) {
    setSteps((prev) => prev.filter((s) => s.id !== stepId));
  }

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
    return (
      <div className="pipeline-detail-page">
        <div className="pipeline-detail-page__error" role="alert">
          {currentPipelineError}
        </div>
      </div>
    );
  }

  // Show loading when we have no pipeline data yet
  if (currentPipeline === null) {
    return (
      <div className="pipeline-detail-page">
        <div className="pipeline-detail-page__loading" aria-label="Loading pipeline">
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="pipeline-detail-page">
      {/* ── Source selector bar ── */}
      <SourceSelectorBar sources={sources} sourcesStatus={sourcesStatus} />

      {/* ── River view ── */}
      <PipelineRiverView
        steps={steps}
        pipelineId={id ?? ""}
        dropdownOpen={dropdownOpenAt === "bottom"}
        openDropdown={() => setDropdownOpenAt("bottom")}
        closeDropdown={() => setDropdownOpenAt(null)}
        onAddStep={handleAddStep}
        onRemoveStep={handleRemoveStep}
        getAnalyzeColumns={getAnalyzeColumns}
        getAnalyzeSchema={getAnalyzeSchema}
        onStepConfigChange={handleStepConfigChange}
        runStepRowCounts={runStepRowCounts}
      />

      {/* ── Footer bar ── */}
      <PipelineDetailFooter
        editingOutputName={editingOutputName}
        outputName={outputName}
        pipelineName={pipelineName}
        setOutputName={setOutputName}
        setEditingOutputName={setEditingOutputName}
        stepCount={steps.length}
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
        runHistoryCount={runs.length}
        openHistory={() => setHistoryOpen(true)}
        openPreview={() => setPreviewModalOpen(true)}
        handleDryRun={() => void handleDryRun()}
        handleRunPipeline={handleRunPipeline}
      />

      {/* ── Run history modal (button lives in the footer) ── */}
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

      {/* In-page back breadcrumb removed — the section breadcrumb in the top
       * command bar already shows "Data Pipelines / <pipeline name>". */}

      {/* ── Share button (owner-only) ── */}
      {isOwner && (
        <div className="pipeline-detail-page__share-bar">
          <button
            className="pipeline-detail-page__share-btn"
            onClick={() => setShareOpen(true)}
            type="button"
          >
            Share
          </button>
        </div>
      )}

      {/* ── Last-run metadata bar ── */}
      {currentPipeline.lastRunAt != null && (
        <div className="pipeline-detail-page__meta-bar" aria-label="Last run metadata">
          <span className="pipeline-detail-page__meta-bar-item">
            <span className="pipeline-detail-page__meta-bar-label">Last run:</span>{" "}
            {formatRelativeTime(currentPipeline.lastRunAt)}
          </span>
          {currentPipeline.lastRunRowCount != null && (
            <span className="pipeline-detail-page__meta-bar-item">
              <span className="pipeline-detail-page__meta-bar-label">Rows written:</span>{" "}
              {currentPipeline.lastRunRowCount.toLocaleString()}
            </span>
          )}
          {currentPipeline.lastRunStatus != null && (
            <span
              className={`pipeline-detail-page__meta-bar-badge pipeline-detail-page__meta-bar-badge--${currentPipeline.lastRunStatus}`}
            >
              {currentPipeline.lastRunStatus}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
