import { useMemo } from "react";

import type { useAppDispatch } from "../../../hooks/reduxHooks";
import { canSampleShared } from "../../sources/hooks/useSourceSampleAccess";
import { useSourceSamples } from "../../sources/hooks/useSourceSamples";
import { buildLaneGraph } from "../state/stepTree";
import type { PipelineRoot } from "../types/pipelineStep";
import type { Step } from "../types/step";
import type { PipelineDraft } from "./usePipelineDraft";
import { usePipelineAnalyzeDeferWatchdog } from "./usePipelineAnalyzeDeferWatchdog";
import { usePipelineAnalyzeLookups } from "./usePipelineAnalyzeLookups";
import type { PipelineAnalyzeState } from "./usePipelineAnalyzeState";
import { usePipelineClearRunOnLeave } from "./usePipelineClearRunOnLeave";
import { usePipelineDebouncedAnalyze } from "./usePipelineDebouncedAnalyze";
import type { PipelineEditorState } from "./usePipelineEditorState";
import { usePipelineStepsFingerprint } from "./usePipelineStepsFingerprint";

/**
 * Everything the page does to keep `analyze` and the per-source samples current (HEL-1704 split of `usePipelineDetailPage`):
 * the steps fingerprint, lane graph, root source samples, defer watchdog, debounced analyze, clear-run-on-leave and the
 * analyze lookups, in the order they were called inline.
 */
export function usePipelineDetailAnalyze({
  id,
  dispatch,
  editor,
  analyzeState,
  draft,
  draftSteps,
  roots,
}: {
  id: string | undefined;
  dispatch: ReturnType<typeof useAppDispatch>;
  editor: PipelineEditorState;
  analyzeState: PipelineAnalyzeState;
  draft: PipelineDraft;
  draftSteps: Step[];
  roots: PipelineRoot[];
}) {
  const { analyzeResult, analyzeStatus, analyzeStatusRef } = analyzeState;
  const {
    steps,
    pendingDraftIds,
    stepsFingerprintRef,
    seedToken,
    sseActive,
    sseActiveRef,
    consumedSeedTokenRef,
    lastAnalyzedFingerprintRef,
    pendingAnalyzeRef,
    pendingSinceRef,
    deferWatchdogHandleRef,
    pendingDraftMetaRef,
    draftFallbackMetaRef,
  } = editor;
  const stepsFingerprint = usePipelineStepsFingerprint({
    steps,
    pendingDraftIds,
    stepsFingerprintRef,
  });

  // HEL-912 task 1.1 — n-lane grouping (design.md decision 1), recomputed
  // only when the steps array or the pipeline's roots change. HEL-968 D1 —
  // `roots` is now required: it's what lets a root with zero steps still
  // render as an empty lane, which `steps` alone could never reveal.
  const laneGraph = useMemo(() => buildLaneGraph(draftSteps, roots), [draftSteps, roots]);
  // HEL-1628: one sample capture per root source when the page opens with nothing cached (both layouts); the
  // label's refresh button is the only other fetch. Never from a step editor, so edits do not re-fetch.
  const rootSourceIds = useMemo(() => roots.map((r) => r.dataSourceId), [roots]);
  // HEL-1648: a non-owned (shared) source is sampled through this pipeline once analyze says the caller is its
  // owner or an editor; `callerRole` is permission-only, so an invalid step does not withdraw it.
  useSourceSamples(
    rootSourceIds,
    id
      ? { pipelineId: id, canSampleShared: canSampleShared(analyzeResult?.callerRole) }
      : undefined,
  );
  const { clearDeferWatchdog, forceDeferredAnalyze } = usePipelineAnalyzeDeferWatchdog({
    id,
    dispatch,
    pendingAnalyzeRef,
    lastAnalyzedFingerprintRef,
    pendingSinceRef,
    deferWatchdogHandleRef,
    stepsFingerprintRef,
  });
  usePipelineDebouncedAnalyze({
    id,
    dispatch,
    steps,
    stepsFingerprint,
    seedToken,
    sseActive,
    analyzeStatus,
    forceDeferredAnalyze,
    clearDeferWatchdog,
    consumedSeedTokenRef,
    lastAnalyzedFingerprintRef,
    sseActiveRef,
    analyzeStatusRef,
    pendingAnalyzeRef,
    pendingSinceRef,
    deferWatchdogHandleRef,
    suspended: draft.hasDraft,
  });

  usePipelineClearRunOnLeave({ dispatch, id });

  const lookups = usePipelineAnalyzeLookups({
    analyzeResult,
    steps,
    pendingDraftMetaRef,
    draftFallbackMetaRef,
  });

  return { laneGraph, ...lookups };
}
