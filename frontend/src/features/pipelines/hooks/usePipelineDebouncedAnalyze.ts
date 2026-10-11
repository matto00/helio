import { useEffect } from "react";
import type { MutableRefObject } from "react";

import { analyzePipeline } from "../state/pipelinesSlice";
import type { useAppDispatch } from "../../../hooks/reduxHooks";
import type { Step } from "../types/step";

// HEL-972 final-gate CR1 — the longest a deferred analyze may be suppressed
// by the sseActive/analyzeStatus guard before it fires regardless. Chosen to
// comfortably exceed a normal run's duration (measured ~6-10s wall time for
// the dry-run flow this ticket's own e2e guard exercises) while still
// bounding a genuinely stuck guard (a dropped/never-opened SSE stream, or a
// missed terminal event -- see `pendingSinceRef`'s comment) to a fixed,
// short window rather than "forever". Matches the 15s window
// `hel912-lanes-rejoin.spec.ts` itself uses for the run-status assertion, so
// a run slow enough to make deferral fire anyway is a run already outside
// what this page's own e2e guard treats as timely.
const MAX_ANALYZE_DEFER_MS = 15000;

type UsePipelineDebouncedAnalyzeArgs = {
  id: string | undefined;
  dispatch: ReturnType<typeof useAppDispatch>;
  steps: Step[];
  stepsFingerprint: string;
  seedToken: number;
  sseActive: boolean;
  analyzeStatus: "idle" | "loading" | "succeeded" | "failed" | null;
  forceDeferredAnalyze: () => void;
  clearDeferWatchdog: () => void;
  consumedSeedTokenRef: MutableRefObject<number>;
  lastAnalyzedFingerprintRef: MutableRefObject<string | null>;
  sseActiveRef: MutableRefObject<boolean>;
  analyzeStatusRef: MutableRefObject<UsePipelineDebouncedAnalyzeArgs["analyzeStatus"]>;
  pendingAnalyzeRef: MutableRefObject<boolean>;
  pendingSinceRef: MutableRefObject<number | null>;
  deferWatchdogHandleRef: MutableRefObject<number | null>;
};

/**
 * The HEL-972 debounced re-analyze effect extracted from `usePipelineDetailPage` (HEL-1478 D2),
 * called right after `usePipelineAnalyzeDeferWatchdog`, whose `clearDeferWatchdog` and
 * `forceDeferredAnalyze` it consumes. The effect body is moved byte-for-byte.
 */
export function usePipelineDebouncedAnalyze({
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
}: UsePipelineDebouncedAnalyzeArgs) {
  useEffect(() => {
    if (!id || steps.length === 0) return;
    if (consumedSeedTokenRef.current !== seedToken) {
      consumedSeedTokenRef.current = seedToken;
      lastAnalyzedFingerprintRef.current = stepsFingerprint;
      return;
    }
    const handle = window.setTimeout(() => {
      // HEL-972 (probe-findings.md D2/D3) — a run submitted while this
      // debounced dispatch was pending competes with it for the same
      // backend request-handling resources, measurably delaying that run's
      // own completion (confirmed: disabling this dispatch alone dropped
      // `hel912-lanes-rejoin.spec.ts`'s target-signature flake rate from
      // ~10-20% to ~1.7-3.3%). Deferring here, rather than dropping, is
      // deliberate: `state.analyzeResult` is written ONLY by
      // `analyzePipeline.fulfilled` (pipelinesSlice.ts) -- a run's own
      // response does NOT populate it, so an edit suppressed here must still
      // eventually dispatch, or the analyze panel is left showing
      // pre-edit/stale results with no pending request to correct it.
      if (sseActiveRef.current || analyzeStatusRef.current === "loading") {
        // HEL-972 cycle 3 -- only mark a dispatch as genuinely PENDING when
        // this is a NEW, not-yet-analyzed fingerprint. Setting this
        // unconditionally (the cycle-2 bug) also fires when the effect is
        // re-entered by `analyzeStatus` flipping to "loading" as a side
        // effect of the dispatch THIS SAME fingerprint already made -- that
        // spuriously re-arms `pendingAnalyzeRef`, which defeats the
        // fingerprint bail-out below and causes an unbounded redispatch
        // loop (measured: ~1 dispatch/830ms, indefinitely, whenever
        // /analyze resolves slower than the 300ms debounce window --
        // invisible under a fast-resolving mock, which is exactly how this
        // escaped cycle-2's own verification).
        if (lastAnalyzedFingerprintRef.current !== stepsFingerprint) {
          pendingAnalyzeRef.current = true;
          // HEL-972 final-gate CR1 — a stuck guard (SSE stream that never
          // opens/drops/misses its terminal event -- see `pendingSinceRef`'s
          // comment in `usePipelineDetailPage.ts`) would otherwise suppress this edit's analyze,
          // and every later edit's, for the rest of the page's lifetime.
          // Start the clock on the FIRST defer for this fingerprint only
          // (don't restart it on every re-entry while still blocked).
          if (pendingSinceRef.current === null) {
            pendingSinceRef.current = Date.now();
          }
          if (deferWatchdogHandleRef.current === null) {
            deferWatchdogHandleRef.current = window.setTimeout(
              forceDeferredAnalyze,
              MAX_ANALYZE_DEFER_MS,
            );
          }
        }
        return;
      }
      // The guard is clear -- but only dispatch if there is something to
      // dispatch FOR: either a genuinely new edit since the last dispatch,
      // or an edit that was deferred while the guard was active. Without
      // this check, `analyzeStatus` clearing on its own (a side effect of
      // the PREVIOUS dispatch settling, not of any new edit) would
      // re-trigger this same effect via its own dependency and dispatch
      // again indefinitely.
      if (lastAnalyzedFingerprintRef.current === stepsFingerprint && !pendingAnalyzeRef.current) {
        return;
      }
      pendingAnalyzeRef.current = false;
      lastAnalyzedFingerprintRef.current = stepsFingerprint;
      clearDeferWatchdog();
      void dispatch(analyzePipeline(id));
    }, 300);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    id,
    stepsFingerprint,
    seedToken,
    dispatch,
    sseActive,
    analyzeStatus,
    forceDeferredAnalyze,
    clearDeferWatchdog,
    // Refs received as arguments: stable (each is the page hook's own `useRef`), listed because the
    // linter cannot see that across the hook boundary.
    consumedSeedTokenRef,
    lastAnalyzedFingerprintRef,
    sseActiveRef,
    analyzeStatusRef,
    pendingAnalyzeRef,
    pendingSinceRef,
    deferWatchdogHandleRef,
  ]);
}
