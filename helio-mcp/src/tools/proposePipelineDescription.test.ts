/**
 * HEL-1727: `propose_pipeline`'s description must match what the backend's propose does since HEL-1638: it runs apply's
 * pre-write checks as a dry run, including one rate-limited live schema fetch per inline rest/sql root. The stale
 * "never re-validated here" claim told agents the opposite.
 */

import type { HelioApi } from "../helioApi.js";
import { registerPipelineProposalTools } from "./pipelineProposal.js";

function proposePipelineDescription(): string {
  let description = "";
  const server = {
    registerTool: (name: string, def: { description?: string }) => {
      if (name === "propose_pipeline") description = def.description ?? "";
    },
  };
  registerPipelineProposalTools(server as never, {} as HelioApi);
  return description;
}

describe("propose_pipeline description (HEL-1727)", () => {
  it("no longer claims SQL is never re-validated at propose time", () => {
    expect(proposePipelineDescription()).not.toContain("never re-validated here");
  });

  it("states that propose dry-runs apply's checks with one live schema fetch per inline rest/sql root", () => {
    const description = proposePipelineDescription();
    expect(description).toContain("dry run");
    expect(description).toMatch(/live (schema )?fetch/);
    expect(description).toContain("429");
  });
});
