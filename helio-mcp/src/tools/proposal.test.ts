/**
 * `propose_dashboard`'s dataTypeId (really Output id) binding-warning tests
 * (HEL-223; formerly HEL-549's `metricId` coverage — metrics are deleted
 * wholesale by HEL-904 decision 11, so the metricId warning path was removed
 * outright from `proposalValidation.ts`, not disabled, and this suite was
 * rewritten to match). HEL-907 task 1.1/1.3 dashboard half: rewritten again
 * onto Outputs — there is no "source companion" concept for an Output
 * (unlike the retired DataType), so that warning case is gone too; the only
 * checks left are "missing" and "not found".
 *
 * Imports from `./proposalValidation.js` (NOT `./proposal.js`) deliberately
 * — see that module's docstring: importing `proposal.ts` directly pulls its
 * `server.registerTool(...)` calls, combined with `panelSchema`'s full Zod
 * object type, into the compile graph, which is TS2589 ("Type instantiation
 * is excessively deep and possibly infinite") under this repo's root
 * `tsconfig.json`/ts-jest configuration — mirrors `write.test.ts`'s
 * documented avoidance of the same class of issue for `write.ts`.
 */

import { computeProposalWarnings } from "./proposalValidation.js";
import type { OutputResponse, ProposalPanel } from "../types.js";

const revenueOutput: OutputResponse = {
  id: "out-1",
  pipelineId: "pipe-1",
  ownerId: "owner-1",
  name: "Revenue",
  kind: "table",
  config: {},
  schema: [{ name: "amount", type: "integer" }],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function panelFixture(overrides: Partial<ProposalPanel> = {}): ProposalPanel {
  return {
    title: "Revenue",
    type: "output",
    dataTypeId: "out-1",
    ...overrides,
  };
}

const outputsById = new Map([["out-1", revenueOutput]]);

/** `applyReady` is computed the same way `propose_dashboard` computes it
 *  (`warnings.length === 0`) — pinned here rather than re-imported so this
 *  suite exercises the exact contract without needing `proposal.ts`. */
function applyReadyFor(warnings: string[]): boolean {
  return warnings.length === 0;
}

describe("computeProposalWarnings — dataTypeId (Output id) (HEL-223/HEL-907)", () => {
  it("warns and applyReady is false when an output panel has no dataTypeId", () => {
    const warnings = computeProposalWarnings(
      [panelFixture({ dataTypeId: undefined })],
      outputsById,
    );

    expect(warnings).toEqual([expect.stringContaining("a output panel needs a dataTypeId")]);
    expect(applyReadyFor(warnings)).toBe(false);
  });

  it("warns and applyReady is false when dataTypeId does not resolve to a real Output", () => {
    const warnings = computeProposalWarnings(
      [panelFixture({ dataTypeId: "out-missing" })],
      outputsById,
    );

    expect(warnings).toEqual([
      expect.stringContaining("output out-missing not found in this workspace"),
    ]);
    expect(applyReadyFor(warnings)).toBe(false);
  });

  it("produces no warning for a valid, existing Output id", () => {
    const warnings = computeProposalWarnings([panelFixture()], outputsById);

    expect(warnings).toEqual([]);
    expect(applyReadyFor(warnings)).toBe(true);
  });

  it("omits the dataTypeId check entirely for non-data panel types (e.g. text)", () => {
    const warnings = computeProposalWarnings(
      [panelFixture({ type: "text", dataTypeId: undefined })],
      outputsById,
    );

    expect(warnings).toEqual([]);
    expect(applyReadyFor(warnings)).toBe(true);
  });

  it("surfaces one warning per invalid panel across multiple panels", () => {
    const warnings = computeProposalWarnings(
      [panelFixture({ dataTypeId: "out-missing" }), panelFixture({ dataTypeId: undefined })],
      outputsById,
    );

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("output out-missing not found in this workspace");
    expect(warnings[1]).toContain("a output panel needs a dataTypeId");
    expect(applyReadyFor(warnings)).toBe(false);
  });
});
