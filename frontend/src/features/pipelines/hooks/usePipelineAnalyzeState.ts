import { useLayoutEffect, useRef } from "react";

import { useAppSelector } from "../../../hooks/reduxHooks";

/**
 * The per-pipeline analyze result / status (+ the status mirrored into a ref) and schedule
 * selectors extracted from `usePipelineDetailPage` (HEL-1501). Moved verbatim.
 */
export function usePipelineAnalyzeState({ id }: { id: string | undefined }) {
  // Per-pipeline analyze result (schema-inferred fields per step).
  const analyzeResult = useAppSelector((state) =>
    id ? (state.pipelines.analyzeResult?.[id] ?? null) : null,
  );
  // HEL-972 — read inside the debounced re-analyze effect's `setTimeout`
  // callback below (see `sseActiveRef`'s comment): an already-in-flight
  // `/analyze` request (this pipeline's own PRIOR debounced or mount-time
  // dispatch, still pending) is exactly the kind of concurrent backend
  // request the probe found competing with a run's own completion. Skipping
  // a redundant second dispatch while one is already loading caps this
  // pipeline's `/analyze` concurrency at 1, on top of `sseActiveRef`'s guard
  // against overlapping a live run.
  const analyzeStatus = useAppSelector((state) =>
    id ? (state.pipelines.analyzeStatus?.[id] ?? null) : null,
  );
  const analyzeStatusRef = useRef(analyzeStatus);
  // HEL-1478 -- committed with the render that produced it (a layout effect with no deps runs on every
  // commit), never written during render: a render React discards must not publish its value.
  useLayoutEffect(() => {
    analyzeStatusRef.current = analyzeStatus;
  });

  // Per-pipeline schedule (HEL-416) — `undefined` while not yet fetched,
  // `null` once fetched and confirmed absent.
  const pipelineSchedule = useAppSelector((state) =>
    id ? (state.pipelines.schedule?.[id] ?? null) : null,
  );

  return {
    analyzeResult,
    analyzeStatus,
    analyzeStatusRef,
    pipelineSchedule,
  };
}
