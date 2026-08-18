import { httpClient } from "../../../services/httpClient";
import type { PipelineProposal, PipelineProposalApplyResponse } from "../types/pipelineProposal";

/** Apply an accepted pipeline proposal (HEL-383's existing endpoint — no
 *  backend change made by this ticket). Creates the (optionally new) source,
 *  the pipeline, its steps, and runs it, atomically. */
export async function applyPipelineProposal(
  proposal: PipelineProposal,
): Promise<PipelineProposalApplyResponse> {
  const response = await httpClient.post<PipelineProposalApplyResponse>(
    "/api/pipelines/apply-proposal",
    proposal,
  );
  return response.data;
}
