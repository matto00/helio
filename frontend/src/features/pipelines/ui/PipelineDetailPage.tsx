import { useRef, useState } from "react";

import { RunHistoryModal } from "./RunHistoryModal";
import { PipelineDetailFooter } from "./PipelineDetailFooter";
import { PipelineRiverView } from "./PipelineRiverView";
import { PipelineDetailHeader } from "./PipelineDetailHeader";
import { PipelineScheduleDialog } from "./schedule/PipelineScheduleDialog";
import { PipelineShareDialog } from "./PipelineShareDialog";
import { PipelineDetailSkeleton } from "./PipelineDetailSkeleton";
import { OutputsGalleryTab } from "./OutputsGalleryTab";
import { OutputEditorSheet } from "./outputEditor/OutputEditorSheet";
import { PageShell } from "../../../shared/ui/PageShell";
import { PageStatus } from "../../../shared/ui/PageStatus";
import { ERROR_KIND_ICON } from "../../../shared/chrome/InlineError";

import "./PipelineDetailPage.css";
import { fetchPipelineById } from "../state/pipelinesSlice";
import { usePipelineDetailPage } from "../hooks/usePipelineDetailPage";

type DetailTab = "steps" | "outputs";

// HEL-682 — this component is now a pure page shell: all state, effects, and
// mutation handlers live in `usePipelineDetailPage` (frontend/src/features/
// pipelines/hooks/usePipelineDetailPage.ts). Split is strictly
// behavior-preserving — see that hook's F-146/F-105 comments for the
// ref/memo-identity invariants carried over unchanged.
export function PipelineDetailPage() {
  const {
    id,
    dispatch,
    steps,
    dropdownOpenAt,
    setDropdownOpenAt,
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
  } = usePipelineDetailPage();

  // task 4.1 -- "Steps" (the river view) vs "Outputs (N)" (the gallery tab).
  // Local UI state, not run-scoped/persisted -- resets to "steps" on every
  // navigation, which matches every other page-local `useState` in this
  // component (e.g. `historyOpen`).
  const [activeTab, setActiveTab] = useState<DetailTab>("steps");
  // CR6 (evaluation-1 cycle-2) — roving-tabindex focus targets for the
  // Steps/Outputs tab strip's Left/Right arrow-key navigation.
  const stepsTabRef = useRef<HTMLButtonElement>(null);
  const outputsTabRef = useRef<HTMLButtonElement>(null);

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
      <PageShell className="pipeline-detail-page">
        <PageStatus
          status="failed"
          icon={<Icon />}
          title="Couldn't load this pipeline"
          message={description}
          onRetry={
            kind === "error" && id !== undefined ? () => dispatch(fetchPipelineById(id)) : undefined
          }
          retrying={currentPipelineStatus === "loading"}
        />
      </PageShell>
    );
  }

  // Show loading when we have no pipeline data yet
  if (currentPipeline === null) {
    return (
      <PageShell className="pipeline-detail-page">
        <PageStatus status="loading" variant="skeleton" loadingLabel="Loading pipeline">
          <PipelineDetailSkeleton />
        </PageStatus>
      </PageShell>
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
        outputsCount={allOutputs.length}
        lastRunStatus={currentPipeline.lastRunStatus}
        schedule={pipelineSchedule}
        onEditSchedule={() => setScheduleOpen(true)}
        onToggleScheduleEnabled={handleToggleScheduleEnabled}
        onOpenHistory={() => setHistoryOpen(true)}
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

      {/* ── Steps / Outputs tab bar (task 4.1). Evaluation-1 cycle-2 CR6:
          completed the ARIA tabs pattern -- `id`/`aria-controls` linking each
          tab to its panel, `role="tabpanel"` + `aria-labelledby` on the
          panel containers, and roving `tabindex` with Left/Right arrow-key
          navigation (kept local rather than extracted into `shared/ui/`:
          this is still the only `role="tablist"` in the codebase, and a
          shared primitive with a single concrete consumer would be a
          premature abstraction -- worth revisiting once a second tab strip
          exists to validate the shape against). ── */}
      <div className="pipeline-detail-page__tabs" role="tablist" aria-label="Pipeline sections">
        <button
          type="button"
          id="pipeline-detail-page__tab-steps"
          role="tab"
          aria-selected={activeTab === "steps"}
          aria-controls="pipeline-detail-page__tabpanel-steps"
          tabIndex={activeTab === "steps" ? 0 : -1}
          ref={stepsTabRef}
          className={`pipeline-detail-page__tab${activeTab === "steps" ? " pipeline-detail-page__tab--active" : ""}`}
          onClick={() => setActiveTab("steps")}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              setActiveTab("outputs");
              outputsTabRef.current?.focus();
            }
          }}
        >
          Steps
        </button>
        <button
          type="button"
          id="pipeline-detail-page__tab-outputs"
          role="tab"
          aria-selected={activeTab === "outputs"}
          aria-controls="pipeline-detail-page__tabpanel-outputs"
          tabIndex={activeTab === "outputs" ? 0 : -1}
          ref={outputsTabRef}
          className={`pipeline-detail-page__tab${activeTab === "outputs" ? " pipeline-detail-page__tab--active" : ""}`}
          onClick={() => setActiveTab("outputs")}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              setActiveTab("steps");
              stepsTabRef.current?.focus();
            }
          }}
        >
          Outputs ({allOutputs.length})
        </button>
      </div>

      {/* ── River view ── */}
      {activeTab === "steps" ? (
        <div
          role="tabpanel"
          id="pipeline-detail-page__tabpanel-steps"
          aria-labelledby="pipeline-detail-page__tab-steps"
        >
          <PipelineRiverView
            steps={steps}
            stepTree={stepTree}
            pipelineId={id ?? ""}
            dropdownOpen={dropdownOpenAt === "bottom"}
            openDropdown={() => setDropdownOpenAt("bottom")}
            closeDropdown={() => setDropdownOpenAt(null)}
            onAddStep={handleAddStep}
            onInsertStep={(opType, index) => void handleInsertStep(opType, index)}
            onAddTailStep={(opType, parentStepId) => void handleAddTailStep(opType, parentStepId)}
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
            outputsByStepId={outputsByStepId}
            previewRowCountByOutputId={previewRowCountByOutputId}
            onOpenOutput={handleOpenOutput}
            onAddOutput={handleAddOutput}
          />
        </div>
      ) : (
        <div
          role="tabpanel"
          id="pipeline-detail-page__tabpanel-outputs"
          aria-labelledby="pipeline-detail-page__tab-outputs"
        >
          {/* task 4.4 -- "+ New output" should ask which step the Output binds
            to; that step-picker (and the Output sheet it opens into) is task
            5.1, not yet built. Defaults to the pipeline's last step for now
            (`handleAddOutput` itself is still the toast stub from 3.3/4.4
            until 5.1 lands), matching the rail's existing per-step
            "+ output" behavior; the sheet itself now offers a real step picker
            (task 4.4), so "+ New output" opens against no pre-chosen step. */}
          <OutputsGalleryTab
            outputs={allOutputs}
            steps={steps}
            previewRowCountByOutputId={previewRowCountByOutputId}
            onOpenOutput={handleOpenOutput}
            onAddOutput={() => handleAddOutput()}
          />
        </div>
      )}

      {/* ── Output editor sheet (task 5.1) ── */}
      {outputSheet && (
        <OutputEditorSheet
          open
          onClose={handleCloseOutputSheet}
          pipelineId={id ?? ""}
          output={outputSheet.output}
          createTargetStepId={outputSheet.createTargetStepId}
          steps={steps}
          onAddAsTailWithAggregate={handleAddOutputViaAggregateTail}
        />
      )}

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
