// PipelineSpineLayout -- HEL-1579 (design.md D1/D2): the desktop pipeline page body. One compact header,
// then three grid regions: the step spine (left), the selected step's focused editor above its preview
// table (centre) and a reserved, empty zero-width `live-output` track that HEL-1581 will size and fill.
// It owns only the selection, the save seam and the preview dedupe; all state and handlers come from
// `usePipelineDetailPage()` (the same result the phone layout reads, so no handler is duplicated).

import { GitBranch } from "lucide-react";
import { useMemo, useState } from "react";

import { EmptyState } from "../../../../shared/ui/EmptyState";
import { PageStatus } from "../../../../shared/ui/PageStatus";
import { useStepSaveSeam } from "../../hooks/useStepSaveSeam";
import type { usePipelineDetailPage } from "../../hooks/usePipelineDetailPage";
import { selectAfterRemoval, useStepSelection } from "../../hooks/useStepSelection";
import { createInFlightDedupe } from "../../state/inFlightDedupe";
import { StepSaveContext } from "../../state/stepSaveContext";
import { stepRowCount, stepRowCountSource } from "../../state/stepRowCount";
import { stepRenderKey } from "../../state/stepTree";
import { PipelineRiverSkeleton } from "../PipelineRiverSkeleton";
import { StepCardFocused } from "../StepCardFocused";
import { PipelineSpine } from "./PipelineSpine";
import { PipelineSpineHeader } from "./PipelineSpineHeader";
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

  const selectedStep =
    selectedStepId !== null ? steps.find((s) => s.id === selectedStepId) : undefined;
  const selectedLane = selectedStep
    ? laneGraph.lanes.find((l) => l.id === laneGraph.laneOfStepId[selectedStep.id])
    : undefined;
  const selectedIndex = selectedLane
    ? selectedLane.steps.findIndex((s) => s.id === selectedStepId)
    : -1;

  const enabledBits = useMemo(() => steps.map((s) => (s.enabled ? "1" : "0")).join(""), [steps]);

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
        />
        <div className="spine-strip-slot">
          <SpineStatusStrip
            costVerdict={page.costVerdict}
            onRunToUpdate={page.handleRunToUpdate}
            truncationNotice={truncationNotice}
          />
        </div>

        <div className="spine-body">
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
                steps={steps}
                laneGraph={laneGraph}
                roots={roots}
                sourceByRootId={page.sourceByRootId}
                outputs={page.allOutputs}
                selectedStepId={selectedStepId}
                stepCount={steps.length}
                rowCountFor={(stepId) => stepRowCount(stepId, runStepRowCounts, persistedCounts)}
                countsPartial={countsPartial}
                getAnalyzeValidationError={page.getAnalyzeValidationError}
                getAnalyzeWarnings={page.getAnalyzeWarnings}
                stepSaveErrors={stepSaveErrors}
                creatingStepIds={page.creatingStepIds}
                onSelectStep={selectStep}
                onEditSource={page.handleEditSource}
                onAddRoot={(sourceId) => void page.handleAddRoot(sourceId)}
                onRemoveRoot={(rootId) => void page.handleRemoveRoot(rootId)}
                onAddStep={page.handleAddStep}
                onInsertStep={(opType, index) => void page.handleInsertStep(opType, index)}
                onAddLaneStep={(opType, parentStepId) =>
                  void page.handleAddLaneStep(opType, parentStepId)
                }
                onAddOutput={page.handleAddOutput}
                onOpenOutput={page.handleOpenOutput}
                onOpenOutputHistory={page.handleOpenOutputHistory}
                onInstantiateShape={page.handleInstantiateShape}
                onReorderSteps={page.handleReorderSteps}
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
                    analyzeColumns={page.getAnalyzeColumns(selectedStep.id)}
                    analyzeSchema={page.getAnalyzeSchema(selectedStep.id)}
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

          {/* Reserved for HEL-1581's live Output render: empty and zero-width until it sets
              --pipeline-live-output-width and renders into it (design.md D2). */}
          <div className="spine-body__live-output" aria-hidden="true" />
        </div>
      </div>
    </StepSaveContext.Provider>
  );
}
