import { useAppSelector } from "../../../hooks/reduxHooks";
import type { RootState } from "../../../store/store";
import type { PipelineCallerRole } from "../../pipelines/types/pipelineStep";

/**
 * HEL-1648 (design.md D6b): whether a source on a pipeline page may be sampled, from this page's point of view.
 *
 *  - `yes`: the label and capture run (the caller owns the source, or holds owner/editor on the pipeline).
 *  - `unknown`: not decidable yet (sources list loading, or a source the caller does not own while analyze has
 *    not answered) -- "Loading sample…", no request.
 *  - `unavailable`: cannot be decided because a request failed (sources list, or analyze with no result ever) --
 *    "Sample unavailable", no request.
 *  - `no`: a viewer's source they do not own -- no label at all, no request.
 */
export type SampleAccess = "yes" | "unknown" | "unavailable" | "no";

export interface SampleAccessInput {
  /** The source is in the caller's own sources list. */
  owned: boolean;
  sourcesStatus: "idle" | "loading" | "succeeded" | "failed";
  /** The caller's role from the last analyze result for this pipeline; `undefined` when none has ever arrived. */
  callerRole: PipelineCallerRole | undefined;
  /** The latest analyze status for this pipeline (a failed re-analyze keeps the last known role). */
  analyzeStatus: string | null;
}

/** A role that may read the sources a shared pipeline uses (HEL-1648 D1: owner and editor, never viewer). */
export function canSampleShared(role: PipelineCallerRole | undefined): boolean {
  return role === "owner" || role === "editor";
}

export function sampleAccessOf(input: SampleAccessInput): SampleAccess {
  const { owned, sourcesStatus, callerRole, analyzeStatus } = input;
  // The role wins over a failed or pending sources list: the scoped endpoint serves owned sources too.
  if (canSampleShared(callerRole)) return "yes";
  if (sourcesStatus === "failed") return "unavailable";
  if (sourcesStatus !== "succeeded") return "unknown";
  if (owned) return "yes";
  if (callerRole === "viewer") return "no";
  return analyzeStatus === "failed" ? "unavailable" : "unknown";
}

/** The analyze result's `callerRole` for a pipeline, `undefined` until one arrives. */
export const selectPipelineCallerRole = (
  state: RootState,
  pipelineId: string,
): PipelineCallerRole | undefined => state.pipelines.analyzeResult?.[pipelineId]?.callerRole;

export function useSourceSampleAccess(pipelineId: string, sourceId: string): SampleAccess {
  const sourcesStatus = useAppSelector((state) => state.sources.status);
  const owned = useAppSelector((state) => state.sources.items.some((s) => s.id === sourceId));
  const callerRole = useAppSelector((state) => selectPipelineCallerRole(state, pipelineId));
  const analyzeStatus = useAppSelector(
    (state) => state.pipelines.analyzeStatus?.[pipelineId] ?? null,
  );
  return sampleAccessOf({ owned, sourcesStatus, callerRole, analyzeStatus });
}
