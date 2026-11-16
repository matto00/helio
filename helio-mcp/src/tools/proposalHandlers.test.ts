/**
 * HEL-1638: `proposeDashboardHandler` runs the server's propose-side dry run
 * (`POST /api/dashboards/validate-proposal`) first. A rejection propagates as a `HelioApiError` carrying the backend
 * message (`proposal.ts`'s `guarded` returns it as an `isError` result); a pass leaves the success shape unchanged.
 */

import { HelioApiError } from "../httpClient.js";
import type { HelioApi } from "../helioApi.js";
import type { DashboardProposal, ProposalPanel } from "../types.js";
import { proposeDashboardHandler } from "./proposalHandlers.js";

const panels = [{ title: "Notes", type: "text" }] as unknown as ProposalPanel[];

function makeApi(validate: (p: DashboardProposal) => Promise<unknown>): HelioApi {
  return {
    validateDashboardProposal: validate,
    listAllOutputs: async () => ({ items: [], total: 0 }),
    listDataSources: async () => ({ items: [], total: 0 }),
    getOutputFilterCapabilities: async () => ({ columns: [] }),
  } as unknown as HelioApi;
}

describe("proposeDashboardHandler server dry run", () => {
  it("returns the unchanged success shape when the dry run passes, sending the proposal", async () => {
    let sent: DashboardProposal | undefined;
    const api = makeApi(async (p) => {
      sent = p;
      return { valid: true };
    });
    const result = await proposeDashboardHandler(api, "Dash", panels);
    expect(sent).toEqual({ dashboardName: "Dash", panels });
    expect(result).toEqual({
      proposal: { dashboardName: "Dash", panels },
      warnings: [],
      applyReady: true,
    });
  });

  it("rejects with the backend message when the dry run rejects", async () => {
    const api = makeApi(async () => {
      throw new HelioApiError(
        400,
        "/api/dashboards/validate-proposal",
        "panel 'Notes': config rejected by the panel service",
      );
    });
    await expect(proposeDashboardHandler(api, "Dash", panels)).rejects.toThrow(
      "config rejected by the panel service",
    );
  });
});
