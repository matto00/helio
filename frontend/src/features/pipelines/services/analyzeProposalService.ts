import { httpClient } from "../../../services/httpClient";
import type { AnalyzeProposalRequest, AnalyzeProposalResponse } from "../state/draftNodeSchema";

/** HEL-1733 D5: the existing read-only projection of an unsaved definition (`POST /api/pipelines/analyze-proposal`). It stores
 *  nothing and names no draft-only resource by id. */
export async function analyzeProposal(
  request: AnalyzeProposalRequest,
): Promise<AnalyzeProposalResponse> {
  const response = await httpClient.post<AnalyzeProposalResponse>(
    "/api/pipelines/analyze-proposal",
    request,
  );
  return response.data;
}
