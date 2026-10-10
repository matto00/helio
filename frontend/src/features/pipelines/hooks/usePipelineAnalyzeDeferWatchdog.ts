import { useCallback, useEffect } from "react";
import type { MutableRefObject } from "react";

import { analyzePipeline } from "../state/pipelinesSlice";
import type { useAppDispatch } from "../../../hooks/reduxHooks";

type UsePipelineAnalyzeDeferWatchdogArgs = {
  id: string | undefined;
  dispatch: ReturnType<typeof useAppDispatch>;
  pendingAnalyzeRef: MutableRefObject<boolean>;
  lastAnalyzedFingerprintRef: MutableRefObject<string | null>;
  pendingSinceRef: MutableRefObject<number | null>;
  deferWatchdogHandleRef: MutableRefObject<number | null>;
  stepsFingerprintRef: MutableRefObject<string>;
};

/**
 * The HEL-972 defer watchdog extracted from `usePipelineDetailPage` (HEL-1465): the timer-clearing
 * callback, the forced deferred `/analyze` dispatch and the unmount-only cleanup. The debounced
 * re-analyze effect that consumes both stays in the page hook, right after this call (see design.md
 * D2b: its existing hooks-lint suppression must stay in a file that ALSO owns the render-time ref
 * writes, or moving it exposes them to the compiler lint).
 */
export function usePipelineAnalyzeDeferWatchdog({
  id,
  dispatch,
  pendingAnalyzeRef,
  lastAnalyzedFingerprintRef,
  pendingSinceRef,
  deferWatchdogHandleRef,
  stepsFingerprintRef,
}: UsePipelineAnalyzeDeferWatchdogArgs) {
  // HEL-972 final-gate CR1 — cancels any scheduled watchdog (the deferral it
  // was guarding against has been resolved, one way or another) and clears
  // its bookkeeping. Called both when a dispatch actually fires (normally OR
  // via the watchdog itself) and on unmount.
  const clearDeferWatchdog = useCallback(() => {
    if (deferWatchdogHandleRef.current !== null) {
      window.clearTimeout(deferWatchdogHandleRef.current);
      deferWatchdogHandleRef.current = null;
    }
    pendingSinceRef.current = null;
  }, [deferWatchdogHandleRef, pendingSinceRef]);
  // The watchdog's own callback: fires `MAX_ANALYZE_DEFER_MS` after a defer
  // began, independent of whether `sseActive`/`analyzeStatus` ever change
  // again (a genuinely stuck guard produces NO further dependency changes to
  // re-run the debounce effect at all, so this cannot rely on that effect
  // re-firing on its own). Forces the dispatch unconditionally -- the guard
  // that was supposed to clear did not, so contention-avoidance loses to
  // "never permanently stale" past this point.
  const forceDeferredAnalyze = useCallback(() => {
    if (!id || !pendingAnalyzeRef.current) return;
    pendingAnalyzeRef.current = false;
    lastAnalyzedFingerprintRef.current = stepsFingerprintRef.current;
    clearDeferWatchdog();
    void dispatch(analyzePipeline(id));
  }, [
    id,
    dispatch,
    clearDeferWatchdog,
    pendingAnalyzeRef,
    lastAnalyzedFingerprintRef,
    stepsFingerprintRef,
  ]);
  // Unmount-only cleanup -- the debounce effect below clears its OWN 300ms
  // `handle` on every dependency change, but the watchdog is deliberately
  // NOT tied to that effect's lifecycle (it must keep counting down across
  // `sseActive`/`analyzeStatus` changes that don't resolve the defer); it
  // only needs clearing when the component itself goes away.
  useEffect(() => clearDeferWatchdog, [clearDeferWatchdog]);

  return { clearDeferWatchdog, forceDeferredAnalyze };
}
