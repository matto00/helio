import { useCallback } from "react";

import type { useAppDispatch } from "../../../hooks/reduxHooks";
import { pipelineStepToStep } from "../state/stepNarrowing";
import type { PipelineStep } from "../types/pipelineStep";
import type { PipelineEditorState } from "./usePipelineEditorState";
import type { PipelineOwnPipeline } from "./usePipelineOwnPipeline";
import type { PipelineAnalyzeState } from "./usePipelineAnalyzeState";
import { usePipelinePageLoad } from "./usePipelinePageLoad";

/**
 * Seeds the local steps from the persisted Redux steps on first load and runs the page load (HEL-1704 split of
 * `usePipelineDetailPage`). The seeding is a render-time state update; `usePipelinePageLoad` carries the effects.
 */
export function usePipelineStepsSeed({
  id,
  dispatch,
  editor,
  own,
  analyzeState,
  persistedSteps,
  loadRunHistoryWhenTruncated,
}: {
  id: string | undefined;
  dispatch: ReturnType<typeof useAppDispatch>;
  editor: PipelineEditorState;
  own: PipelineOwnPipeline;
  analyzeState: PipelineAnalyzeState;
  persistedSteps: PipelineStep[];
  loadRunHistoryWhenTruncated: Parameters<
    typeof usePipelinePageLoad
  >[0]["loadRunHistoryWhenTruncated"];
}) {
  const {
    setSteps,
    stepsInitialized,
    setStepsInitialized,
    setStepsFetch,
    stepsFetchedThisMount,
    onStepsRetry,
    setSeedToken,
    setOutputsFetch,
  } = editor;
  // Initialize local steps from persisted Redux data on first load.
  if (!stepsInitialized && stepsFetchedThisMount && persistedSteps.length > 0) {
    setStepsInitialized(true);
    setSteps(persistedSteps.map(pipelineStepToStep));
    // F-105 — this transition changes `stepsFingerprint` from "" to a
    // real value, which the debounced re-analyze effect can't tell apart
    // from a genuine edit. Without this token it fires its own /analyze
    // ~300ms after the mount effect's own immediate one (two identical
    // requests on every page open). Consumed by that effect's next run;
    // it changes only in the render where `stepsFingerprint` also changes.
    setSeedToken((token) => token + 1);
  }

  const onStepsSettled = useCallback(
    (ok: boolean) => setStepsFetch(ok ? "fulfilled" : "failed"),
    [setStepsFetch],
  );
  const onOutputsSettled = useCallback(
    (ok: boolean) => setOutputsFetch(ok ? "loaded" : "failed"),
    [setOutputsFetch],
  );
  return usePipelinePageLoad({
    id,
    dispatch,
    currentPipeline: own.currentPipeline,
    singletonIsOwn: own.singletonIsOwn,
    currentPipelineStatus: own.currentPipelineStatus,
    sourcesStatus: own.sourcesStatus,
    loadRunHistoryWhenTruncated,
    onStepsSettled,
    onStepsRetry,
    onOutputsSettled,
    analyzeStatusRef: analyzeState.analyzeStatusRef,
  });
}
