/**
 * HEL-385 tasks.md 7.1 — unit tests for `computePipelineProposalWarnings`,
 * `propose_pipeline`'s read-only warning computation (design.md D4).
 *
 * Imports from `./pipelineProposalValidation.js` (NOT `./pipelineProposal.js`
 * or `./pipelineProposalHandlers.js`) deliberately — mirrors
 * `proposal.test.ts`'s own documented import discipline: importing
 * `pipelineProposal.ts` directly would pull its `server.registerTool(...)`
 * calls, combined with the imported `boundPipelineStepSchema`'s full Zod
 * object type, into the compile graph, which is TS2589 under this repo's
 * root `tsconfig.json`/ts-jest configuration.
 */

import { computePipelineProposalWarnings } from "./pipelineProposalValidation.js";
import type { PipelineProposalSource } from "../types.js";

const knownSourceIds = new Set(["source-1", "source-2"]);

describe("computePipelineProposalWarnings", () => {
  it("produces no warnings for a valid, known sourceId", () => {
    const source: PipelineProposalSource = { sourceId: "source-1" };

    expect(computePipelineProposalWarnings([source], knownSourceIds)).toEqual([]);
  });

  it("produces no warnings for a valid inline source (type + name + config)", () => {
    const source: PipelineProposalSource = {
      type: "static",
      name: "Inline source",
      config: { columns: [], rows: [] },
    };

    expect(computePipelineProposalWarnings([source], knownSourceIds)).toEqual([]);
  });

  it("warns when both sourceId and type are set", () => {
    const source: PipelineProposalSource = {
      sourceId: "source-1",
      type: "static",
      name: "x",
      config: {},
    };

    const warnings = computePipelineProposalWarnings([source], knownSourceIds);

    expect(warnings).toEqual([expect.stringContaining("both sourceId and type are set")]);
  });

  it("warns when neither sourceId nor type is set", () => {
    const source: PipelineProposalSource = {};

    const warnings = computePipelineProposalWarnings([source], knownSourceIds);

    expect(warnings).toEqual([expect.stringContaining("neither sourceId nor type is set")]);
  });

  it("warns when type is set but name is blank", () => {
    const source: PipelineProposalSource = { type: "csv", name: "   ", config: {} };

    const warnings = computePipelineProposalWarnings([source], knownSourceIds);

    expect(warnings).toEqual([expect.stringContaining("name is blank/absent")]);
  });

  it("warns when type is set but name is absent", () => {
    const source: PipelineProposalSource = { type: "csv", config: {} };

    const warnings = computePipelineProposalWarnings([source], knownSourceIds);

    expect(warnings).toEqual([expect.stringContaining("name is blank/absent")]);
  });

  it("warns when type is set but the matching config is absent", () => {
    const source: PipelineProposalSource = { type: "csv", name: "My CSV" };

    const warnings = computePipelineProposalWarnings([source], knownSourceIds);

    expect(warnings).toEqual([expect.stringContaining("matching config is absent")]);
  });

  it("warns when sourceId is set but not found among the caller's data sources", () => {
    const source: PipelineProposalSource = { sourceId: "source-unknown" };

    const warnings = computePipelineProposalWarnings([source], knownSourceIds);

    expect(warnings).toEqual([
      expect.stringContaining("sourceId source-unknown not found among your data sources"),
    ]);
  });

  it("surfaces both a blank-name warning and a blank-config warning together for the same inline source", () => {
    const source: PipelineProposalSource = { type: "sql" };

    const warnings = computePipelineProposalWarnings([source], knownSourceIds);

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("name is blank/absent");
    expect(warnings[1]).toContain("matching config is absent");
  });

  it("HEL-914: reports each root's warning against ITS OWN index, not the first", () => {
    const valid: PipelineProposalSource = { sourceId: "source-1" };
    const badSecond: PipelineProposalSource = { sourceId: "source-unknown" };

    const warnings = computePipelineProposalWarnings([valid, badSecond], knownSourceIds);

    expect(warnings).toEqual([
      expect.stringContaining(
        "roots[1]: sourceId source-unknown not found among your data sources",
      ),
    ]);
  });
});
