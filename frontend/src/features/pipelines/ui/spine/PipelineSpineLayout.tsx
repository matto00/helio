// PipelineSpineLayout -- HEL-1579 (design.md D1/D2): the desktop pipeline page body. One compact header,
// then three grid regions: the step spine (left), the selected step's focused editor above its preview
// table (centre) and the `live-output` track holding the live Output column (HEL-1632; a collapsible section under the
// centre column when the page is too narrow for three).
// It owns only the selection, the save seam and the preview dedupe; all state and handlers come from
// `usePipelineDetailPage()` (the same result the phone layout reads, so no handler is duplicated).

import { GitBranch } from "lucide-react";
import { useRef, useState } from "react";

import { EmptyState } from "../../../../shared/ui/EmptyState";
import { PageStatus } from "../../../../shared/ui/PageStatus";
import { usePipelineDraftPresentation } from "../../hooks/usePipelineDraftPresentation";
import { useStepSaveSeam } from "../../hooks/useStepSaveSeam";
import type { usePipelineDetailPage } from "../../hooks/usePipelineDetailPage";
import { selectAfterRemoval, useStepSelection } from "../../hooks/useStepSelection";
import { createInFlightDedupe } from "../../state/inFlightDedupe";
import { StepSaveContext } from "../../state/stepSaveContext";
import { stepRowCount, stepRowCountSource } from "../../state/stepRowCount";
import { stepRenderKey } from "../../state/stepTree";
import { PipelineDraftNotices } from "../PipelineDraftNotices";
import { PipelineRiverSkeleton } from "../PipelineRiverSkeleton";
import { StepCardFocused } from "../StepCardFocused";
import { LiveOutputColumn } from "../liveOutput/LiveOutputColumn";
import { useThreeColumnLayout } from "../liveOutput/useThreeColumnLayout";
import { PipelineSpine } from "./PipelineSpine";
import { PipelineSpineHeader } from "./PipelineSpineHeader";
import { useSpineStepActions } from "./useSpineStepActions";
import { SpineStatusStrip } from "./SpineStatusStrip";
import { StepPreviewTable } from "./StepPreviewTable";
import "./PipelineSpineLayout.css";
import "./PipelineSpineAccent.css";

/** Shown in place of the spine when this mount's steps fetch failed (HEL-1501); the raw rejection
 *  text is not user copy. */
const STEPS_LOAD_ERROR = "Couldn't load this pipeline's steps.";

export type PipelinePageState = ReturnType<typeof usePipelineDetailPage>;

export function PipelineSpineLayout({ page }: { page: PipelinePageState }) {
  const {
    id,
    steps,
    laneGraph,
    roots,
    currentPipeline,
    stepsLoading,
    stepsFailed,
    runStepRowCounts,
    outputName,
    editingOutputName,
  } = page;
  const pipelineId = id ?? "";
  const stepsLoaded = !stepsLoading && !stepsFailed;
  const firstRootId = roots[0]?.id;

  const { selectedStepId, selectStep } = useStepSelection({
    steps,
    laneGraph,
    firstRootId,
    stepsLoaded,
  });
  const { contextValue, tracker, stepSaveErrors } = useStepSaveSeam(steps);
  const [dedupe] = useState(createInFlightDedupe);
  const actions = useSpineStepActions({
    laneGraph,
    roots,
    onAddStep: page.handleAddStep,
    onInsertStep: (opType, index) => void page.handleInsertStep(opType, index),
    onAddLaneStep: (opType, parentStepId) => void page.handleAddLaneStep(opType, parentStepId),
    onAddOutput: page.handleAddOutput,
    onAddRoot: (sourceId) => void page.handleAddRoot(sourceId),
    onInstantiateShape: page.handleInstantiateShape,
    onReorderSteps: page.handleReorderSteps,
    structuralBlockedReason: page.draftBlockReason,
  });
  const presentation = usePipelineDraftPresentation(page, selectedStepId);
  const bodyRef = useRef<HTMLDivElement>(null);
  const threeColumns = useThreeColumnLayout(bodyRef);
  // The narrow-desktop Output section is collapsed until opened, per page session.
  const [outputOpen, setOutputOpen] = useState(false);

  const selectedStep =
    selectedStepId !== null ? steps.find((s) => s.id === selectedStepId) : undefined;
  const selectedDraftSchema = selectedStep ? presentation.inputSchemaFor(selectedStep) : null;
  const selectedLane = selectedStep
    ? laneGraph.lanes.find((l) => l.id === laneGraph.laneOfStepId[selectedStep.id])
    : undefined;
  const selectedIndex = selectedLane
    ? selectedLane.steps.findIndex((s) => s.id === selectedStepId)
    : -1;

  // The saved-preview fetch follows the SAVED enabled flags, so a draft toggle never refetches (design.md D7a).
  const enabledBits = presentation.savedEnabledBits;

  // Counts: the in-session run's, else the persisted latest run's (design.md D9). Truncation context
  // follows whichever source is shown (`pipeline-run-truncation-reporting`).
  const persistedCounts = currentPipeline?.lastRunStepRowCounts ?? null;
  const countsSource = stepRowCountSource(runStepRowCounts, persistedCounts);
  const countsPartial =
    countsSource === "session"
      ? page.runSourceTruncated
      : countsSource === "persisted" && currentPipeline?.lastRunTruncated === true;

  if (currentPipeline === null) return null;

  // HEL-861/HEL-873: the live run's truncation notice wins; otherwise the persisted latest run's.
  const persistedNotice = page.runs[0]?.truncation?.notice ?? null;
  const showLive = page.runSourceTruncated && page.runTruncationNotice;
  const showPersisted = !showLive && currentPipeline.lastRunTruncated === true && persistedNotice;
  const truncationNotice = showLive
    ? page.runTruncationNotice
    : showPersisted
      ? persistedNotice
      : null;

  const onlyRootSource = roots.length === 1 ? page.sourceByRootId[roots[0].id] : undefined;

  function handleRemoveStep(stepId: string) {
    // Removing the selected step selects its predecessor (design.md D6) before the step goes away.
    if (stepId === selectedStepId)
      selectStep(selectAfterRemoval(laneGraph, stepId, firstRootId) ?? null);
    page.handleRemoveStep(stepId);
  }

  function handleToggleEnabled(stepId: string, enabled: boolean) {
    // The enable flip changes what a preview returns, so the table waits on it too (design.md D8).
    tracker.register(Promise.resolve(page.handleToggleStepEnabled(stepId, enabled)));
  }

  return (
    <StepSaveContext.Provider value={contextValue}>
      <div className="pipeline-detail-page pipeline-detail-page--spine">
        <PipelineSpineHeader
          pipelineName={page.pipelineName}
          outputName={outputName}
          setOutputName={page.setOutputName}
          editingName={editingOutputName}
          setEditingName={page.setEditingOutputName}
          isDirty={page.isDirty}
          updateError={page.updateError}
          updateStatus={page.updateStatus}
          isConfirmingCancel={page.isConfirmingCancel}
          onSave={() => void page.handleSave()}
          onCancel={page.handleCancel}
          onConfirmDiscard={page.confirmCancelDiscard}
          onDismissConfirm={page.dismissCancelConfirm}
          run={{
            sseStatus: page.sseData.status,
            sseRowCount: page.sseData.rowCount,
            sseErrorLog: page.sseData.errorLog,
            runStatus: page.runStatus,
            runError: page.runError,
            runIsDry: page.runIsDry,
            runResult: page.runResult,
          }}
          lastRunAt={currentPipeline.lastRunAt}
          lastRunRowCount={currentPipeline.lastRunRowCount}
          lastRunStatus={currentPipeline.lastRunStatus}
          lastRunTruncated={currentPipeline.lastRunTruncated ?? null}
          schedule={page.pipelineSchedule}
          onEditSchedule={() => page.setScheduleOpen(true)}
          onToggleScheduleEnabled={page.handleToggleScheduleEnabled}
          onOpenHistory={page.openRunHistory}
          isOwner={page.isOwner}
          onOpenShare={() => page.setShareOpen(true)}
          onEditOnlySource={onlyRootSource ? () => page.handleEditSource(onlyRootSource.id) : null}
          onDryRun={() => void page.handleDryRun()}
          onRun={() => void page.handleRunPipeline()}
          draft={{
            hasDraft: page.draft.hasDraft,
            saving: page.draftSave.saving,
            onDiscard: page.draft.discard,
            onSaveAndRun: () => void page.draftSave.saveAndRun(),
          }}
        />
        <PipelineDraftNotices page={page} />
        <div className="spine-strip-slot">
          <SpineStatusStrip
            costVerdict={page.costVerdict}
            onRunToUpdate={page.handleRunToUpdate}
            truncationNotice={truncationNotice}
          />
        </div>

        <div
          className="spine-body"
          ref={bodyRef}
          data-live-layout={threeColumns ? "column" : "disclosure"}
        >
          <aside className="spine-body__spine" aria-label="Steps and outputs">
            {stepsLoading ? (
              <PipelineRiverSkeleton ariaLabel="Loading steps" />
            ) : stepsFailed ? (
              <PageStatus
                status="failed"
                size="section"
                message={STEPS_LOAD_ERROR}
                onRetry={page.retryStepsLoad}
              />
            ) : (
              <PipelineSpine
                actions={actions}
                steps={steps}
                laneGraph={laneGraph}
                roots={roots}
                pipelineId={pipelineId}
                sourceByRootId={page.sourceByRootId}
                outputs={page.allOutputs}
                selectedStepId={selectedStepId}
                stepCount={steps.length}
                rowCountFor={(stepId) => stepRowCount(stepId, runStepRowCounts, persistedCounts)}
                draftFor={presentation.draftFor}
                draftCountsOverSample={presentation.draftCountsOverSample}
                structuralBlockedReason={presentation.structuralBlockedReason}
                countsPartial={countsPartial}
                getAnalyzeValidationError={page.getAnalyzeValidationError}
                getAnalyzeWarnings={page.getAnalyzeWarnings}
                stepSaveErrors={stepSaveErrors}
                creatingStepIds={page.creatingStepIds}
                onSelectStep={selectStep}
                onEditSource={page.handleEditSource}
                onRemoveRoot={(rootId) => void page.handleRemoveRoot(rootId)}
                onAddOutput={page.handleAddOutput}
                onOpenOutput={page.handleOpenOutput}
                onOpenOutputHistory={page.handleOpenOutputHistory}
              />
            )}
          </aside>

          <section className="spine-body__main" aria-label="Step editor and preview">
            {selectedStep ? (
              <>
                <div className="spine-body__editor">
                  <StepCardFocused
                    key={stepRenderKey(selectedStep)}
                    step={selectedStep}
                    allSteps={steps}
                    isOwner={page.isOwner}
                    stepNumber={selectedIndex + 1}
                    onRemove={handleRemoveStep}
                    analyzeColumns={
                      selectedDraftSchema?.map((f) => f.name) ??
                      page.getAnalyzeColumns(selectedStep.id)
                    }
                    analyzeSchema={selectedDraftSchema ?? page.getAnalyzeSchema(selectedStep.id)}
                    validationError={page.getAnalyzeValidationError(selectedStep.id)}
                    warnings={page.getAnalyzeWarnings(selectedStep.id)}
                    onConfigChange={page.handleStepConfigChange}
                    onToggleEnabled={handleToggleEnabled}
                    onDuplicate={page.handleDuplicateStep}
                    isDuplicating={page.duplicatingStepIds.has(selectedStep.id)}
                    estimatedRows={page.estimatedRows}
                    draftError={page.draftCreateErrors[selectedStep.id]}
                    isCreating={page.creatingStepIds.has(selectedStep.id)}
                    savedError={stepSaveErrors[selectedStep.id]}
                    structuralBlockedReason={presentation.structuralBlockedReason}
                    draftPreviewError={presentation.previewErrorFor(selectedStep.id)}
                  />
                </div>
                <StepPreviewTable
                  key={selectedStep.id}
                  pipelineId={pipelineId}
                  step={selectedStep}
                  stepNumber={selectedIndex + 1}
                  stepIndex={selectedIndex}
                  enabledBits={enabledBits}
                  analyzeSchema={page.getAnalyzeSchema(selectedStep.id)}
                  analyzeOutputSchema={page.getAnalyzeOutputSchema(selectedStep.id)}
                  hasOwnAnalyze={page.hasOwnAnalyzeEntry(selectedStep.id)}
                  isCreating={page.creatingStepIds.has(selectedStep.id)}
                  dedupe={dedupe}
                  beforeFetch={tracker.whenIdle}
                  draft={presentation.previewDraftFor(selectedStep.id)}
                />
              </>
            ) : (
              stepsLoaded && (
                <div className="spine-body__placeholder">
                  <EmptyState
                    variant="main"
                    icon={<GitBranch />}
                    title={steps.length === 0 ? "Nothing to edit yet" : "Select a step"}
                    description={
                      steps.length === 0
                        ? "Add a step on the left, then edit it here and see the rows it produces."
                        : "Pick a step on the left to edit it and see the rows it produces."
                    }
                  />
                </div>
              )
            )}
          </section>

          <div className="spine-body__live-output">
            <LiveOutputColumn
              page={page}
              presentation={presentation}
              selectedStepId={selectedStepId}
              layout={threeColumns ? "column" : "disclosure"}
              expanded={outputOpen}
              onToggle={() => setOutputOpen((open) => !open)}
            />
          </div>
        </div>
        {actions.dialogs}
      </div>
    </StepSaveContext.Provider>
  );
}
