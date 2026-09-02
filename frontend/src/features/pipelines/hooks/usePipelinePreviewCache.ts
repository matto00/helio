import { useCallback } from "react";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import {
  previewOutput,
  previewUnsavedOutputStep,
  selectOutputPreview,
  selectUnsavedStepPreview,
} from "../state/outputsSlice";
import type { RunResult } from "../types/output";

export interface PipelinePreviewCacheEntry {
  result: RunResult | undefined;
  refresh: () => Promise<void>;
}

/** Rail chip / sheet preview for a SAVED Output, keyed by `outputId` (task
 *  2.2). A real hook (called unconditionally at each call site's top level,
 *  e.g. once per rendered rail chip) rather than a hook-returning-closure --
 *  the latter would call `useAppSelector` from inside a plain callback,
 *  violating React's rules of hooks the moment the number of rendered chips
 *  changes between renders. */
export function useOutputPreview(pipelineId: string, outputId: string): PipelinePreviewCacheEntry {
  const dispatch = useAppDispatch();
  const result = useAppSelector((state) => selectOutputPreview(state, outputId));
  const refresh = useCallback(async () => {
    await dispatch(previewOutput({ pipelineId, outputId }));
  }, [dispatch, pipelineId, outputId]);
  return { result, refresh };
}

/** Sheet preview for an UNSAVED Output (no persisted id yet) -- previews its
 *  target step instead (design.md decision 5). */
export function useUnsavedStepPreview(
  pipelineId: string,
  stepId: string,
): PipelinePreviewCacheEntry {
  const dispatch = useAppDispatch();
  const result = useAppSelector((state) => selectUnsavedStepPreview(state, stepId));
  const refresh = useCallback(async () => {
    await dispatch(previewUnsavedOutputStep({ pipelineId, stepId }));
  }, [dispatch, pipelineId, stepId]);
  return { result, refresh };
}
