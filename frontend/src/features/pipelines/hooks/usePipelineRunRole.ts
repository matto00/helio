import { useAppSelector } from "../../../hooks/reduxHooks";
import { selectPipelineCallerRole } from "../../sources/hooks/useSourceSampleAccess";
import type { PipelineCallerRole } from "../types/pipelineStep";

/** What the pipeline page offers the caller to run with. `pending` = not known yet (no run entry is rendered, its slot is reserved). */
export type PipelineRunRole = PipelineCallerRole | "pending";

export interface RunRoleInput {
  isOwner: boolean;
  /** The role in the most recent analyze RESULT for this pipeline; `undefined` when none has arrived. */
  callerRole: PipelineCallerRole | undefined;
  analyzeStatus: string | null;
}

/**
 * HEL-1661 (design.md D4). The rule reads the latest analyze RESULT, never the current status alone: a re-analyze sets
 * `loading` (and a failed one `failed`) while the previous result is kept, so a known role never changes with the status.
 *  1. the pipeline's owner is `owner` at once;
 *  2. else the last result's `callerRole`;
 *  3. else (no result) `pending` while analyze is idle or loading;
 *  4. else (no result, analyze failed) `editor`: the controls show and the server stays the authority for a viewer's run.
 */
export function runRoleOf({ isOwner, callerRole, analyzeStatus }: RunRoleInput): PipelineRunRole {
  if (isOwner) return "owner";
  if (callerRole !== undefined) return callerRole;
  return analyzeStatus === "failed" ? "editor" : "pending";
}

/** A run entry (Run pipeline, Dry run, Save & run, Run now) is rendered for these roles only. */
export const canRunFromUi = (role: PipelineRunRole): boolean =>
  role === "owner" || role === "editor";

export function usePipelineRunRole(
  pipelineId: string | undefined,
  isOwner: boolean,
): PipelineRunRole {
  const callerRole = useAppSelector((state) => selectPipelineCallerRole(state, pipelineId ?? ""));
  const analyzeStatus = useAppSelector(
    (state) => state.pipelines.analyzeStatus?.[pipelineId ?? ""] ?? null,
  );
  return runRoleOf({ isOwner, callerRole, analyzeStatus });
}
