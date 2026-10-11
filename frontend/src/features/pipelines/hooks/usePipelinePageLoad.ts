import { useCallback, useEffect, useRef } from "react";

import { fetchSources } from "../../sources/state/sourcesSlice";
import type { useAppDispatch } from "../../../hooks/reduxHooks";
import {
  analyzePipeline,
  fetchPipelineById,
  fetchPipelineSchedule,
  fetchPipelineSteps,
} from "../state/pipelinesSlice";
import { fetchOutputs } from "../state/outputsSlice";
import type { PipelineSummary } from "../types/pipelineStep";
import type { useRunHistory } from "./useRunHistory";

type UsePipelinePageLoadArgs = {
  id: string | undefined;
  dispatch: ReturnType<typeof useAppDispatch>;
  currentPipeline: PipelineSummary | null;
  currentPipelineStatus: "idle" | "loading" | "succeeded" | "failed";
  sourcesStatus: "idle" | "loading" | "succeeded" | "failed";
  loadRunHistoryWhenTruncated: ReturnType<typeof useRunHistory>["loadRunHistoryWhenTruncated"];
};

/**
 * The page-open fetches extracted from `usePipelineDetailPage` (HEL-1478 D3, C6): the pipeline /
 * steps / analyze / schedule / Outputs fetch on mount or id change, the sources fetch, and the
 * error state's Retry.
 */
export function usePipelinePageLoad({
  id,
  dispatch,
  currentPipeline,
  currentPipelineStatus,
  sourcesStatus,
  loadRunHistoryWhenTruncated,
}: UsePipelinePageLoadArgs) {
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
    loadRunHistoryWhenTruncated(id, dispatch(fetchPipelineById(id)));
    void dispatch(fetchPipelineSteps(id));
    void dispatch(analyzePipeline(id));
    void dispatch(fetchPipelineSchedule(id));
    // task 3.3 / design.md decision 2 — fetched alongside the pipeline
    // detail/steps fetch, NOT embedded in `PipelineSummaryResponse` (verified:
    // that response carries no `outputs` field).
    void dispatch(fetchOutputs({ pipelineId: id }));
  }, [dispatch, id, currentPipelineStatus, currentPipelineId, loadRunHistoryWhenTruncated]);

  // HEL-1354: the status stays "idle" until the thunk's `pending` lands, so React StrictMode's
  // dev-only effect double-invoke saw "idle" twice and issued two `GET /api/data-sources`. A
  // per-mount ref makes the second run a no-op; it never blocks a later legitimate refetch,
  // which other callers issue directly.
  const sourcesRequestedRef = useRef(false);
  useEffect(() => {
    if (sourcesStatus === "idle" && !sourcesRequestedRef.current) {
      sourcesRequestedRef.current = true;
      void dispatch(fetchSources());
    }
  }, [dispatch, sourcesStatus]);

  // The error state's Retry: re-issues the pipeline fetch only (today's retry scope) plus the same
  // truncated-banner history chain boot uses, so a retried open behaves exactly like a first open.
  const retryPipelineLoad = useCallback(() => {
    if (!id) return;
    loadRunHistoryWhenTruncated(id, dispatch(fetchPipelineById(id)));
  }, [dispatch, id, loadRunHistoryWhenTruncated]);
  return { retryPipelineLoad };
}
