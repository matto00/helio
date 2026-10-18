// PipelineMobileLayout -- HEL-1582 (design.md D1): the pipeline page body at or below 768px. A compact header, the
// Steps / Preview / Runs tabs, a scrolling tab body, and the floating Dry run / Run pipeline pills above the glass
// nav. Steps is the source card, the numbered step rows on a vertical line, "+ Add step" and the Output cards (the
// spine pieces with `variant="phone"`); tapping a step opens its editor in a full-height bottom sheet. It owns only
// the tab, the open step, the save seam and the preview dedupe; all state and handlers come from
// `usePipelineDetailPage()`, the same result the desktop layout reads. The dialogs stay a sibling of this layout
// (PipelineDetailPage), so crossing the 768px boundary never loses an open one.

import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { PageStatus } from "../../../../shared/ui/PageStatus";
import type { StepDeepLink } from "../../hooks/useStepDeepLink";
import { STEP_PARAM, useAddedStepId } from "../../hooks/useStepSelection";
import { useStepSaveSeam } from "../../hooks/useStepSaveSeam";
import { resolveStepParam } from "../../state/resolveStepParam";
import { createInFlightDedupe } from "../../state/inFlightDedupe";
import { stepRowCount, stepRowCountSource } from "../../state/stepRowCount";
import { StepSaveContext } from "../../state/stepSaveContext";
import { stepRenderKey } from "../../state/stepTree";
import { PipelineRiverSkeleton } from "../PipelineRiverSkeleton";
import { PipelineSpine } from "../spine/PipelineSpine";
import type { PipelinePageState } from "../spine/PipelineSpineLayout";
import { SpineStatusStrip } from "../spine/SpineStatusStrip";
import { useSpineStepActions } from "../spine/useSpineStepActions";
import { MobilePipelineActions } from "./MobilePipelineActions";
import { MobilePipelineHeader } from "./MobilePipelineHeader";
import { MobilePipelineTabs, tabId, tabPanelId } from "./MobilePipelineTabs";
import type { MobileTab } from "./MobilePipelineTabs";
import { MobilePreviewTab } from "./MobilePreviewTab";
import { MobileRunsTab } from "./MobileRunsTab";
import { MobileStepSheet } from "./MobileStepSheet";
import type { OpenStep } from "./MobileStepSheet";
import "../spine/PipelineSpineAccent.css";
import "../spine/PipelineSpine.css";
import "./PipelineMobile.css";

/** Shown in place of the steps when this mount's steps fetch failed (HEL-1501). */
const STEPS_LOAD_ERROR = "Couldn't load this pipeline's steps.";

export function PipelineMobileLayout({
  page,
  deepLink,
}: {
  page: PipelinePageState;
  deepLink: StepDeepLink;
}) {
  const { steps, laneGraph, roots, currentPipeline, stepsLoading, stepsFailed, runStepRowCounts } =
    page;
  const stepsLoaded = !stepsLoading && !stepsFailed;

  const [tab, setTab] = useState<MobileTab>("steps");
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
  });

  // The open step is held as its RENDER key, which survives an AI draft's temp -> server id swap. An ordinary create
  // carries no render key, so its temp step vanishes as the server step appears: in that same commit the key moves
  // to the step `useAddedStepId` reports and the sheet stays open (no close, no replayed entrance). It closes only
  // when its key is gone and nothing was added in that commit (a removal). Adjusted during render so the very
  // commit that swaps the ids already shows the new step.
  const { addedStepId } = useAddedStepId(steps, stepsLoaded);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [handledAdded, setHandledAdded] = useState<string | null>(null);
  let nextKey = openKey;
  if (addedStepId !== null && addedStepId !== handledAdded) {
    setHandledAdded(addedStepId);
    const added = steps.find((s) => s.id === addedStepId);
    if (added) nextKey = stepRenderKey(added);
  }
  // HEL-1668 D1: the page's one-shot `?step=` deep link opens its step's sheet (an unknown value opens nothing).
  const [handledDeepLink, setHandledDeepLink] = useState<string | null>(null);
  if (deepLink.step !== null && deepLink.step !== handledDeepLink) {
    setHandledDeepLink(deepLink.step);
    const deepId = resolveStepParam(steps, deepLink.step);
    const deepStep = steps.find((s) => s.id === deepId);
    if (deepStep) nextKey = stepRenderKey(deepStep);
  }
  if (nextKey !== null && !steps.some((s) => stepRenderKey(s) === nextKey)) nextKey = null;
  if (nextKey !== openKey) setOpenKey(nextKey);

  const open: OpenStep | undefined = (() => {
    if (nextKey === null) return undefined;
    for (const lane of laneGraph.lanes) {
      const index = lane.steps.findIndex((s) => stepRenderKey(s) === nextKey);
      if (index >= 0) return { step: lane.steps[index], lane, index };
    }
    return undefined;
  })();

  // The URL is DERIVED from the open step: one replace-sync covers every open/close path (row tap, added step, deep
  // link, close, swipe, removal close, temp -> server id swap). Gated until the deep link is consumed, so a layout
  // mounting while the steps load never deletes `?step=` before it is used.
  const openStepId = open?.step.id ?? null;
  const { consumed: deepLinkConsumed, step: deepLinkStep, clear: clearDeepLink } = deepLink;
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStep = searchParams.get(STEP_PARAM);
  useEffect(() => {
    if (deepLinkStep !== null) clearDeepLink();
  }, [deepLinkStep, clearDeepLink]);
  useEffect(() => {
    if (!deepLinkConsumed || urlStep === openStepId) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (openStepId === null) next.delete(STEP_PARAM);
        else next.set(STEP_PARAM, openStepId);
        return next;
      },
      { replace: true },
    );
  }, [deepLinkConsumed, urlStep, openStepId, setSearchParams]);

  if (currentPipeline === null) return null;

  // Counts: the in-session run's, else the persisted latest run's. Truncation context follows whichever shows.
  const persistedCounts = currentPipeline.lastRunStepRowCounts ?? null;
  const countsSource = stepRowCountSource(runStepRowCounts, persistedCounts);
  const countsPartial =
    countsSource === "session"
      ? page.runSourceTruncated
      : countsSource === "persisted" && currentPipeline.lastRunTruncated === true;

  // HEL-861/HEL-873: the live run's truncation notice wins; otherwise the persisted latest run's.
  const persistedNotice = page.runs[0]?.truncation?.notice ?? null;
  const showLive = page.runSourceTruncated && page.runTruncationNotice;
  const showPersisted = !showLive && currentPipeline.lastRunTruncated === true && persistedNotice;
  const truncationNotice = showLive
    ? page.runTruncationNotice
    : showPersisted
      ? persistedNotice
      : null;

  const runBusy = page.runStatus === "queued" || page.runStatus === "running";

  function handleToggleEnabled(stepId: string, enabled: boolean) {
    // The enable flip changes what a preview returns, so the table waits on it too.
    tracker.register(Promise.resolve(page.handleToggleStepEnabled(stepId, enabled)));
  }

  return (
    <StepSaveContext.Provider value={contextValue}>
      <div className="pipeline-detail-page pipeline-detail-page--mobile">
        <MobilePipelineHeader page={page} actions={actions} />
        <MobilePipelineTabs active={tab} onChange={setTab} />
        <SpineStatusStrip
          costVerdict={page.costVerdict}
          onRunToUpdate={page.handleRunToUpdate}
          truncationNotice={truncationNotice}
        />

        <div
          className="mobile-body"
          role="tabpanel"
          id={tabPanelId(tab)}
          aria-labelledby={tabId(tab)}
        >
          {tab === "steps" &&
            (stepsLoading ? (
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
                variant="phone"
                actions={actions}
                steps={steps}
                laneGraph={laneGraph}
                roots={roots}
                pipelineId={page.id ?? ""}
                sourceByRootId={page.sourceByRootId}
                outputs={page.allOutputs}
                selectedStepId={open?.step.id ?? null}
                stepCount={steps.length}
                rowCountFor={(stepId) => stepRowCount(stepId, runStepRowCounts, persistedCounts)}
                countsPartial={countsPartial}
                getAnalyzeValidationError={page.getAnalyzeValidationError}
                getAnalyzeWarnings={page.getAnalyzeWarnings}
                stepSaveErrors={stepSaveErrors}
                creatingStepIds={page.creatingStepIds}
                onSelectStep={(stepId) => {
                  const step = steps.find((s) => s.id === stepId);
                  if (step) setOpenKey(stepRenderKey(step));
                }}
                onEditSource={page.handleEditSource}
                onRemoveRoot={(rootId) => void page.handleRemoveRoot(rootId)}
                onAddOutput={page.handleAddOutput}
                onOpenOutput={page.handleOpenOutput}
                onOpenOutputHistory={page.handleOpenOutputHistory}
              />
            ))}
          {tab === "preview" &&
            (stepsLoaded ? (
              <MobilePreviewTab page={page} dedupe={dedupe} beforeFetch={tracker.whenIdle} />
            ) : stepsLoading ? (
              <PipelineRiverSkeleton ariaLabel="Loading steps" />
            ) : (
              <PageStatus
                status="failed"
                size="section"
                message={STEPS_LOAD_ERROR}
                onRetry={page.retryStepsLoad}
              />
            ))}
          {tab === "runs" && <MobileRunsTab page={page} />}
        </div>

        <MobilePipelineActions
          busy={runBusy}
          onDryRun={() => void page.handleDryRun()}
          onRun={() => void page.handleRunPipeline()}
        />

        <MobileStepSheet
          open={open}
          onClosed={() => setOpenKey(null)}
          page={page}
          actions={actions}
          dedupe={dedupe}
          beforeFetch={tracker.whenIdle}
          stepSaveErrors={stepSaveErrors}
          onToggleEnabled={handleToggleEnabled}
        />
        {actions.dialogs}
      </div>
    </StepSaveContext.Provider>
  );
}
