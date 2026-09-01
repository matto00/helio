/**
 * `propose_dashboard`'s dataTypeId binding-warning tests (HEL-223; formerly
 * HEL-549's `metricId` coverage — metrics are deleted wholesale by HEL-904
 * decision 11, so the metricId warning path was removed outright from
 * `proposalValidation.ts`, not disabled, and this suite was rewritten to
 * match).
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
import type { DataTypeResponse, ProposalPanel } from "../types.js";

const pipelineOutputType: DataTypeResponse = {
  id: "dt-1",
  name: "Revenue",
  fields: [{ name: "amount", displayName: "Amount", dataType: "integer", nullable: false }],
  computedFields: [],
  version: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

const sourceCompanionType: DataTypeResponse = {
  ...pipelineOutputType,
  id: "dt-2",
  name: "Raw Revenue",
  sourceId: "src-1",
};

function panelFixture(overrides: Partial<ProposalPanel> = {}): ProposalPanel {
  return {
    title: "Revenue",
    type: "output",
    dataTypeId: "dt-1",
    fieldMapping: { value: "amount" },
    ...overrides,
  };
}

const typesById = new Map([
  ["dt-1", pipelineOutputType],
  ["dt-2", sourceCompanionType],
]);

/** `applyReady` is computed the same way `propose_dashboard` computes it
 *  (`warnings.length === 0`) — pinned here rather than re-imported so this
 *  suite exercises the exact contract without needing `proposal.ts`. */
function applyReadyFor(warnings: string[]): boolean {
  return warnings.length === 0;
}

describe("computeProposalWarnings — dataTypeId (HEL-223)", () => {
  it("warns and applyReady is false when an output panel has no dataTypeId", () => {
    const warnings = computeProposalWarnings([panelFixture({ dataTypeId: undefined })], typesById);

    expect(warnings).toEqual([expect.stringContaining("a output panel needs a dataTypeId")]);
    expect(applyReadyFor(warnings)).toBe(false);
  });

  it("warns and applyReady is false when dataTypeId is not found in the workspace", () => {
    const warnings = computeProposalWarnings(
      [panelFixture({ dataTypeId: "dt-missing" })],
      typesById,
    );

    expect(warnings).toEqual([
      expect.stringContaining("dataTypeId dt-missing not found in this workspace"),
    ]);
    expect(applyReadyFor(warnings)).toBe(false);
  });

  it("warns and applyReady is false when dataTypeId resolves to a source companion, not a pipeline output", () => {
    const warnings = computeProposalWarnings([panelFixture({ dataTypeId: "dt-2" })], typesById);

    expect(warnings).toEqual([
      expect.stringContaining("is a source companion, not a pipeline output"),
    ]);
    expect(applyReadyFor(warnings)).toBe(false);
  });

  it("produces no warning for a valid pipeline-output dataTypeId", () => {
    const warnings = computeProposalWarnings([panelFixture()], typesById);

    expect(warnings).toEqual([]);
    expect(applyReadyFor(warnings)).toBe(true);
  });

  it("omits the dataTypeId check entirely for non-data panel types (e.g. text)", () => {
    const warnings = computeProposalWarnings(
      [panelFixture({ type: "text", dataTypeId: undefined })],
      typesById,
    );

    expect(warnings).toEqual([]);
    expect(applyReadyFor(warnings)).toBe(true);
  });

  it("surfaces one warning per invalid panel across multiple panels", () => {
    const warnings = computeProposalWarnings(
      [panelFixture({ dataTypeId: "dt-missing" }), panelFixture({ dataTypeId: undefined })],
      typesById,
    );

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("dataTypeId dt-missing not found in this workspace");
    expect(warnings[1]).toContain("a output panel needs a dataTypeId");
    expect(applyReadyFor(warnings)).toBe(false);
  });
});
