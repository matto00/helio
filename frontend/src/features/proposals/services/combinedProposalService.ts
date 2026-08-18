import { httpClient } from "../../../services/httpClient";
import type { CombinedProposal, CombinedProposalApplyResponse } from "../types/combinedProposal";

/** Apply an accepted combined (pipeline + dashboard) proposal (HEL-387's
 *  existing endpoint — no backend change made by this ticket). Atomic:
 *  creates the pipeline's source/pipeline/steps/run AND the dashboard/panels
 *  together, resolving any `"$pipelineOutput"` sentinel bindings. */
export async function applyCombinedProposal(
  proposal: CombinedProposal,
): Promise<CombinedProposalApplyResponse> {
  const response = await httpClient.post<CombinedProposalApplyResponse>(
    "/api/proposals/apply",
    proposal,
  );
  return response.data;
}
