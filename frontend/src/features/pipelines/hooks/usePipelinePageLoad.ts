import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";

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
  /** Whether the shared `currentPipeline` singleton currently holds THIS page's pipeline. */
  singletonIsOwn: boolean;
  currentPipelineStatus: "idle" | "loading" | "succeeded" | "failed";
  sourcesStatus: "idle" | "loading" | "succeeded" | "failed";
  loadRunHistoryWhenTruncated: ReturnType<typeof useRunHistory>["loadRunHistoryWhenTruncated"];
  /** HEL-1483: called once the steps fetch this mount dispatched settles (`ok` = fulfilled). */
  onStepsSettled: (ok: boolean) => void;
  /** HEL-1501: puts the steps-fetch phase back to "pending" when the steps error's Retry is used. */
  onStepsRetry: () => void;
  /** HEL-1501: the page's own analyze status, read at settle time to decide whether Retry must also
   *  re-request analyze (a same-outage failure would otherwise leave the recovered cards schema-less). */
  analyzeStatusRef: MutableRefObject<"idle" | "loading" | "succeeded" | "failed" | null>;
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
  singletonIsOwn,
  currentPipelineStatus,
  sourcesStatus,
  loadRunHistoryWhenTruncated,
  onStepsSettled,
  onStepsRetry,
  analyzeStatusRef,
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
    void dispatch(fetchPipelineSteps(id)).then((action) => {
      onStepsSettled(fetchPipelineSteps.fulfilled.match(action));
    });
    void dispatch(analyzePipeline(id));
    void dispatch(fetchPipelineSchedule(id));
    // task 3.3 / design.md decision 2 — fetched alongside the pipeline
    // detail/steps fetch, NOT embedded in `PipelineSummaryResponse` (verified:
    // that response carries no `outputs` field).
    void dispatch(fetchOutputs({ pipelineId: id }));
  }, [
    dispatch,
    id,
    currentPipelineStatus,
    currentPipelineId,
    loadRunHistoryWhenTruncated,
    onStepsSettled,
  ]);

  // HEL-1483 -- the page for `id` must converge to `id`'s pipeline whichever stale request lands
  // when. `currentPipeline` and its status are slice singletons, so a request for ANOTHER id (e.g. the
  // unmounted previous page's root add/remove continuation refetching it) can supersede this page's
  // own in-flight fetch and replace the singleton. The hook then reads the page's pipeline as
  // missing with an "idle" status; once this page has itself requested its pipeline (`requestedRef`)
  // that state means "lost to another request", so re-request it. Each loss needs a fresh foreign
  // request, so this cannot loop on its own.
  const requestedRef = useRef(false);
  useEffect(() => {
    if (!id) return;
    if (currentPipelineStatus !== "idle") {
      requestedRef.current = true;
      return;
    }
    if (!requestedRef.current || singletonIsOwn) return;
    loadRunHistoryWhenTruncated(id, dispatch(fetchPipelineById(id)));
  }, [dispatch, id, singletonIsOwn, currentPipelineStatus, loadRunHistoryWhenTruncated]);

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

  // HEL-1501: the steps error's Retry. Re-issues ONLY the steps fetch (no pipeline refetch) and
  // routes its settle through `onStepsSettled`, so seeding after a recovered fetch is the same
  // derived-state path a first open uses. The seed bumps `seedToken`, which the debounced
  // re-analyze effect consumes without dispatching, so when this pipeline's mount-time analyze had
  // also failed it is re-requested here -- exactly once, and never when analyze already succeeded
  // (F-105: no duplicate analyze). Both run only while this page is still mounted, like the
  // continuations in `usePipelineRootAndToggleActions`.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const retryStepsLoad = useCallback(() => {
    if (!id) return;
    onStepsRetry();
    void dispatch(fetchPipelineSteps(id)).then((action) => {
      if (!mountedRef.current) return;
      const ok = fetchPipelineSteps.fulfilled.match(action);
      onStepsSettled(ok);
      if (ok && analyzeStatusRef.current === "failed") void dispatch(analyzePipeline(id));
    });
  }, [dispatch, id, onStepsRetry, onStepsSettled, analyzeStatusRef]);
  return { retryPipelineLoad, retryStepsLoad };
}
