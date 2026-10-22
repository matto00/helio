import { useAppSelector } from "../../../hooks/reduxHooks";
import type { SampleState } from "../state/liveOutput/liveOutputSource";
import type { PipelineRoot } from "../types/pipelineStep";

/**
 * HEL-1632 (design.md D3, evaluation order 1-2): whether the roots' samples are still on their way, usable, or will not
 * come. A root with no entry yet counts as loading until the caller's sources list has loaded and analyze has answered
 * (the sample hook requests only after those), so the column never flashes saved rows before a sample arrives.
 */
export function useLiveSampleState(
  roots: readonly PipelineRoot[],
  pipelineId: string,
): SampleState {
  const entries = useAppSelector((state) => state.sourceSamples.entries);
  const sourcesStatus = useAppSelector((state) => state.sources.status);
  const ownedIds = useAppSelector((state) => state.sources.items);
  const analyzeStatus = useAppSelector((state) => state.pipelines.analyzeStatus?.[pipelineId]);

  let ready = false;
  let loading = false;
  for (const root of roots) {
    const entry = entries[root.dataSourceId];
    if (entry?.sample !== undefined) {
      ready = true;
    } else if (entry?.status === "loading") {
      loading = true;
    } else if (entry === undefined) {
      const listPending = sourcesStatus === "idle" || sourcesStatus === "loading";
      const analyzePending = analyzeStatus !== "succeeded" && analyzeStatus !== "failed";
      const ownedAndComing = ownedIds.some((s) => s.id === root.dataSourceId);
      if (listPending || ownedAndComing || analyzePending) loading = true;
    }
  }
  return loading ? "loading" : ready ? "ready" : "unusable";
}
