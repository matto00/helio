import { useCallback, useEffect, useRef, useState } from "react";

import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { fetchPipelineById, fetchPipelineRunHistory } from "../state/pipelinesSlice";
import type { PipelineRunRecord } from "../types/pipelineStep";

/**
 * HEL-1354: page-open token source. A module-level counter (not `Math.random`/`randomUUID`: those
 * fail `react-hooks/purity` when called during render) so every page open — a fresh mount AND an
 * in-place `id` change (A -> B -> A gets three distinct tokens) — owns a distinct number.
 */
let openTokenCounter = 0;
function nextOpenToken(): number {
  openTokenCounter += 1;
  return openTokenCounter;
}

const NO_RUNS: PipelineRunRecord[] = [];

/** What the run-history modal should render. */
export type RunHistoryView = "fresh" | "loading" | "failed";

/**
 * Owns the pipeline detail page's run-history loading (HEL-1354). Run history is no longer fetched
 * on every page open: it is fetched when the modal opens, on boot only when the persisted
 * truncation banner needs it (`lastRunTruncated === true`), and after a run finishes.
 *
 * Freshness is per page open: the slice records the token of the latest fulfilled request
 * (`runHistoryLoadedOpenId`) and records are "fresh" only when it equals this open's token, so a
 * previous visit's list — or a previous visit's late response — is never shown and never
 * suppresses a fetch. There is deliberately no cleanup-time reset: a reset would race with
 * StrictMode's simulated unmount.
 */
export function useRunHistory(id: string | undefined) {
  const dispatch = useAppDispatch();

  const [pageOpen, setPageOpen] = useState(() => ({ id, token: nextOpenToken() }));
  const [historyOpen, setHistoryOpen] = useState(false);
  // Derived-state-during-render (React's recommended pattern, same as `outputNamePipelineId` in
  // `usePipelineDetailPage`): a new `id` is a new page open, and the modal closes with it so it can
  // never show one pipeline's runs (or an unfetched state) under another pipeline's page.
  if (pageOpen.id !== id) {
    setPageOpen({ id, token: nextOpenToken() });
    setHistoryOpen(false);
  }
  const openId = pageOpen.token;

  // Read by async callbacks (boot chain, post-run refreshes) that outlive the render they were
  // created in; written in an effect so it is lint-legal and runs before the page's boot effect.
  const openIdRef = useRef(openId);
  useEffect(() => {
    openIdRef.current = openId;
  }, [openId]);

  // Optional chaining on the maps mirrors `usePipelineDetailPage`'s other per-pipeline selectors
  // (`analyzeResult?.[id]`): a hand-built `pipelines` state in a test may predate these fields.
  const records = useAppSelector((state) => (id ? state.pipelines.runHistory?.[id] : undefined));
  const loadedOpenId = useAppSelector((state) =>
    id ? state.pipelines.runHistoryLoadedOpenId?.[id] : undefined,
  );
  const status = useAppSelector((state) =>
    id ? state.pipelines.runHistoryStatus?.[id] : undefined,
  );
  const requestOpenId = useAppSelector((state) =>
    id ? state.pipelines.runHistoryOpenId?.[id] : undefined,
  );

  const fresh = loadedOpenId === openId;
  const runs = fresh ? (records ?? NO_RUNS) : NO_RUNS;
  const view: RunHistoryView = fresh
    ? "fresh"
    : status === "failed" && requestOpenId === openId
      ? "failed"
      : "loading";

  /** Non-forced fetch for this page open; the thunk's `condition` skips an in-flight duplicate. */
  const load = useCallback(() => {
    if (!id) return;
    void dispatch(fetchPipelineRunHistory({ pipelineId: id, openId: openIdRef.current }));
  }, [dispatch, id]);

  /** Post-run refresh: `force` so a fetch still in flight cannot swallow it. */
  const refreshAfterRun = useCallback(() => {
    if (!id) return;
    void dispatch(
      fetchPipelineRunHistory({ pipelineId: id, openId: openIdRef.current, force: true }),
    );
  }, [dispatch, id]);

  /**
   * Boot hook: chained off THIS open's own `fetchPipelineById` promise (never off store state a
   * previous visit left behind). Fetches history only when the pipeline's last run was truncated,
   * the one first-paint element that needs it. No cleanup/cancel flag: StrictMode's simulated
   * cleanup would cancel the chain while the ref-guarded second effect run dispatches nothing.
   */
  const loadWhenTruncated = useCallback(
    (pipelineId: string, pipelineFetch: PromiseLike<unknown>) => {
      const bootOpenId = openIdRef.current;
      void pipelineFetch.then((action) => {
        if (openIdRef.current !== bootOpenId) return;
        if (
          fetchPipelineById.fulfilled.match(action) &&
          action.meta.arg === pipelineId &&
          action.payload.lastRunTruncated === true
        ) {
          void dispatch(fetchPipelineRunHistory({ pipelineId, openId: bootOpenId }));
        }
      });
    },
    [dispatch],
  );

  /** The ONLY way to open the modal: click-time, fetches when this open has no fresh list. */
  const openRunHistory = useCallback(() => {
    setHistoryOpen(true);
    if (!fresh) load();
  }, [fresh, load]);

  const closeRunHistory = useCallback(() => setHistoryOpen(false), []);

  return {
    historyOpen,
    openRunHistory,
    closeRunHistory,
    retryRunHistory: load,
    runs,
    runHistoryView: view,
    refreshRunHistoryAfterRun: refreshAfterRun,
    loadRunHistoryWhenTruncated: loadWhenTruncated,
  };
}
