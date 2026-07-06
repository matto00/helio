import { httpClient } from "../../../services/httpClient";
import type { AppliedProposal, DashboardProposal } from "../types/proposal";

/** Apply an accepted dashboard proposal (HEL-225). The server validates and
 *  creates the dashboard + panels atomically via the existing services — this
 *  is the single write path shared with the MCP `apply_proposal` tool. */
export async function applyDashboardProposal(
  proposal: DashboardProposal,
): Promise<AppliedProposal> {
  const response = await httpClient.post<AppliedProposal>(
    "/api/dashboards/apply-proposal",
    proposal,
  );
  return response.data;
}
