import { useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { PipelineDetailFooter } from "./PipelineDetailFooter";
import { PipelineRiverView } from "./PipelineRiverView";
import { PipelineDetailHeader } from "./PipelineDetailHeader";
import { PipelineRiverSkeleton } from "./PipelineRiverSkeleton";
import { PipelineDetailSkeleton } from "./PipelineDetailSkeleton";
import { OutputsGalleryTab } from "./OutputsGalleryTab";
import { PageShell } from "../../../shared/ui/PageShell";
import { PageStatus } from "../../../shared/ui/PageStatus";
import { ERROR_KIND_ICON } from "../../../shared/chrome/InlineError";
import { useIsPhoneShell } from "../../../app/shell/useIsPhoneShell";
import { PipelineDetailDialogs } from "./PipelineDetailDialogs";
import { PipelineSpineLayout } from "./spine/PipelineSpineLayout";

import "./PipelineDetailPage.css";
import { usePipelineDetailPage } from "../hooks/usePipelineDetailPage";

/** HEL-1501: shown in place of the step river when this mount's steps fetch failed. Mirrors the
 *  page-level title "Couldn't load this pipeline"; the raw rejection text is not user copy. */
const STEPS_LOAD_ERROR = "Couldn't load this pipeline's steps.";

type DetailTab = "steps" | "outputs";

// HEL-682 — this component is now a pure page shell: all state, effects, and
// mutation handlers live in `usePipelineDetailPage` (frontend/src/features/
// pipelines/hooks/usePipelineDetailPage.ts). Split is strictly
// behavior-preserving — see that hook's F-146/F-105 comments for the
// ref/memo-identity invariants carried over unchanged.
//
// HEL-1483 -- the router reuses this component instance when only `:id` changes (list/sidebar,
// command palette, recents, back/forward all navigate `/pipelines/A` -> `/pipelines/B` in place), so
// the page is keyed by the route id: a pipeline switch becomes "leave A, open B", the same unmount
// -> mount every other navigation already is. That drops everything pipeline-local at once -- the
// seeded/edited step list, unsaved AI drafts, pending debounced step saves (the StepCards' timers
// clear on unmount), the analyze fingerprint/defer watchdog, the SSE subscription, the run-history
// modal, the share/schedule dialogs, the Output sheet/history, the output-name field and the
// Steps/Outputs tab -- instead of a reset effect that must name every one of them.
export function PipelineDetailPage() {
  const { id } = useParams<{ id: string }>();
  return <PipelineDetailPageContent key={id} />;
}

function PipelineDetailPageContent() {
  // HEL-1579 (design.md D1): above the 768px phone boundary the page is the step spine; the phone keeps
  // today's header + tabs + river + footer exactly as before (HEL-1582 replaces it separately).
  const isPhoneShell = useIsPhoneShell();
  const page = usePipelineDetailPage();
  const {
    id,
    stepsLoading,
    stepsFailed,
    retryStepsLoad,
    steps,
    dropdownOpenAt,
    setDropdownOpenAt,
    sseData,
    outputName,
    setOutputName,
    editingOutputName,
    setEditingOutputName,
    openRunHistory,
    retryPipelineLoad,
    setShareOpen,
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
    sourceByRootId,
    isOwner,
    estimatedRows,
    costVerdict,
    handleRunToUpdate,
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
    handleOpenOutputHistory,
    handleAddOutput,
    handleEditSource,
    handleToggleScheduleEnabled,
    laneGraph,
    roots,
    handleAddRoot,
    handleRemoveRoot,
    handleAddStep,
    handleAddLaneStep,
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
  } = page;

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
          onRetry={kind === "error" && id !== undefined ? retryPipelineLoad : undefined}
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

  // The dialogs (Output sheet, History views, share, schedule) are a SIBLING of the layout, not inside it, so
  // crossing the 768px boundary while one is open does not remount it and lose its state (HEL-1579).
  const phoneLayout = (
    <div className="pipeline-detail-page">
      {/* ── Header: bound source(s) + bound type + schedule ── */}
      <PipelineDetailHeader
        roots={roots}
        pipelineId={currentPipeline.id}
        sourceByRootId={sourceByRootId}
        onEditSource={handleEditSource}
        onAddRoot={(sourceId) => void handleAddRoot(sourceId)}
        onRemoveRoot={(rootId) => void handleRemoveRoot(rootId)}
        outputsCount={allOutputs.length}
        lastRunStatus={currentPipeline.lastRunStatus}
        schedule={pipelineSchedule}
        onEditSchedule={() => setScheduleOpen(true)}
        onToggleScheduleEnabled={handleToggleScheduleEnabled}
        onOpenHistory={openRunHistory}
        isOwner={isOwner}
        onOpenShare={() => setShareOpen(true)}
      />

      {/* ── HEL-861: run-truncation warning — shown only when the last run's source read (or a
          join/union/lookup secondary read) was capped. Renders the server-composed notice
          verbatim (design.md D7) so the human sees exactly what an MCP agent reads.
          HEL-873 (design.md task 5.3): falls back to the PERSISTED signal when no live Redux
          run state is present (a fresh page load) — `runs[0]` is the most recent run (the
          backend sorts `startedAt` descending), so its recomposed `truncation.notice` is what a
          reloaded page shows instead of nothing. A fresh run in THIS session always supersedes
          the persisted value, since `runSourceTruncated`/`runTruncationNotice` are checked first. ── */}
      {(() => {
        const persistedNotice = runs[0]?.truncation?.notice ?? null;
        const showLive = runSourceTruncated && runTruncationNotice;
        const showPersisted =
          !showLive && currentPipeline.lastRunTruncated === true && persistedNotice;
        const noticeText = showLive ? runTruncationNotice : persistedNotice;
        return (
          (showLive || showPersisted) && (
            <div className="pipeline-detail-page__truncation-banner" role="alert">
              <span className="pipeline-detail-page__truncation-banner-icon" aria-hidden="true">
                ⚠
              </span>
              <span className="pipeline-detail-page__truncation-banner-text">{noticeText}</span>
            </div>
          )
        );
      })()}

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
          className="pipeline-detail-page__tabpanel"
        >
          {stepsLoading ? (
            // HEL-1483 (D2a): this mount's steps fetch hasn't landed, so "No steps yet" (and its
            // live Add buttons) would be false. Same placeholder the page-level load shows.
            <PipelineRiverSkeleton ariaLabel="Loading steps" />
          ) : stepsFailed ? (
            // HEL-1501: the steps are unknown, so the empty editor ("No steps yet" + live Add
            // buttons) would be false. A section error with Retry (DESIGN.md §7).
            // Same frame as the skeleton and the river, so it gets their inset and centred column.
            <div className="pipeline-detail-page__river">
              <div className="pipeline-detail-page__river-inner">
                <PageStatus
                  status="failed"
                  size="section"
                  message={STEPS_LOAD_ERROR}
                  onRetry={retryStepsLoad}
                />
              </div>
            </div>
          ) : (
            <PipelineRiverView
              steps={steps}
              isOwner={isOwner}
              laneGraph={laneGraph}
              roots={roots}
              onRemoveRoot={(rootId) => void handleRemoveRoot(rootId)}
              pipelineId={id ?? ""}
              dropdownOpen={dropdownOpenAt === "bottom"}
              openDropdown={() => setDropdownOpenAt("bottom")}
              closeDropdown={() => setDropdownOpenAt(null)}
              onAddStep={handleAddStep}
              onInsertStep={(opType, index) => void handleInsertStep(opType, index)}
              onAddLaneStep={(opType, parentStepId) => void handleAddLaneStep(opType, parentStepId)}
              onRemoveStep={handleRemoveStep}
              getAnalyzeColumns={getAnalyzeColumns}
              getAnalyzeSchema={getAnalyzeSchema}
              getAnalyzeOutputSchema={getAnalyzeOutputSchema}
              hasOwnAnalyzeEntry={hasOwnAnalyzeEntry}
              getAnalyzeValidationError={getAnalyzeValidationError}
              getAnalyzeWarnings={getAnalyzeWarnings}
              estimatedRows={estimatedRows}
              draftCreateErrors={draftCreateErrors}
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
              duplicatingStepIds={duplicatingStepIds}
              creatingStepIds={creatingStepIds}
              outputsByStepId={outputsByStepId}
              previewRowCountByOutputId={previewRowCountByOutputId}
              onOpenOutput={handleOpenOutput}
              onAddOutput={handleAddOutput}
            />
          )}
        </div>
      ) : (
        <div
          role="tabpanel"
          id="pipeline-detail-page__tabpanel-outputs"
          aria-labelledby="pipeline-detail-page__tab-outputs"
          className="pipeline-detail-page__tabpanel"
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
            laneGraph={laneGraph}
            previewRowCountByOutputId={previewRowCountByOutputId}
            onOpenOutput={handleOpenOutput}
            onOpenHistory={handleOpenOutputHistory}
            onAddOutput={() => handleAddOutput()}
          />
        </div>
      )}

      {/* ── Footer bar ── */}
      <PipelineDetailFooter
        editingOutputName={editingOutputName}
        outputName={outputName}
        pipelineName={pipelineName}
        setOutputName={setOutputName}
        setEditingOutputName={setEditingOutputName}
        stepCount={stepsLoading || stepsFailed ? null : steps.length}
        outputSchema={steps.length > 0 ? getAnalyzeOutputSchema(steps[steps.length - 1].id) : []}
        sseData={sseData}
        runStatus={runStatus}
        runError={runError}
        runIsDry={runIsDry}
        runResult={runResult}
        costVerdict={costVerdict}
        handleRunToUpdate={handleRunToUpdate}
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
        lastRunTruncated={currentPipeline.lastRunTruncated ?? null}
      />

      {/* In-page back breadcrumb removed — the section breadcrumb in the top
       * command bar already shows "Data Pipelines / <pipeline name>". */}
    </div>
  );

  return (
    <>
      {isPhoneShell ? phoneLayout : <PipelineSpineLayout page={page} />}
      <PipelineDetailDialogs page={page} />
    </>
  );
}
