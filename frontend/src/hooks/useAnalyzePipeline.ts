import { useEffect } from "react";

import { analyzePipeline } from "../features/pipelines/pipelinesSlice";
import type { PipelineAnalyzeResponse } from "../types/models";
import { useAppDispatch, useAppSelector } from "./reduxHooks";

export interface AnalyzePipelineResult {
  analyzeResult: PipelineAnalyzeResponse | null;
  analyzeStatus: "idle" | "loading" | "succeeded" | "failed";
  analyzeError: string | null;
}

/** Dispatches the analyzePipeline thunk on mount (and when pipelineId changes).
 *  Returns the cached result, current status, and any error. */
export function useAnalyzePipeline(pipelineId: string | undefined): AnalyzePipelineResult {
  const dispatch = useAppDispatch();

  const analyzeResult = useAppSelector((state) =>
    pipelineId ? (state.pipelines.analyzeResult[pipelineId] ?? null) : null,
  );
  const analyzeStatus = useAppSelector((state) =>
    pipelineId ? (state.pipelines.analyzeStatus[pipelineId] ?? "idle") : "idle",
  );
  const analyzeError = useAppSelector((state) =>
    pipelineId ? (state.pipelines.analyzeError[pipelineId] ?? null) : null,
  );

  useEffect(() => {
    if (!pipelineId) return;
    // Only fetch when idle — do not re-fetch on every render.
    // PipelineDetailPage re-dispatches when steps change via the analyze endpoint.
    if (analyzeStatus === "idle") {
      void dispatch(analyzePipeline(pipelineId));
    }
  }, [dispatch, pipelineId, analyzeStatus]);

  return { analyzeResult, analyzeStatus, analyzeError };
}
