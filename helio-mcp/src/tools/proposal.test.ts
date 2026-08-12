/**
 * HEL-549 tasks.md 4.4 — unit tests for `propose_dashboard`'s metricId
 * warning paths (missing/deprecated/unsupported-type/valid) and `applyReady`
 * reflecting them (applyReady is `warnings.length === 0` in `proposal.ts`,
 * pinned directly below). First coverage of the propose_dashboard validation
 * surface (none existed before this change, per design.md's Risks/
 * Trade-offs).
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
import type { DataTypeResponse, MetricResponse, ProposalPanel } from "../types.js";

const pipelineOutputType: DataTypeResponse = {
  id: "dt-1",
  name: "Revenue",
  fields: [{ name: "amount", displayName: "Amount", dataType: "integer", nullable: false }],
  computedFields: [],
  version: 1,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

function metricFixture(overrides: Partial<MetricResponse> = {}): MetricResponse {
  return {
    id: "metric-1",
    ownerId: "user-1",
    dataTypeId: "dt-1",
    name: "Total Revenue",
    measureField: "amount",
    aggregation: "sum",
    allowedDimensions: [],
    format: { unit: "$" },
    deprecated: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function panelFixture(overrides: Partial<ProposalPanel> = {}): ProposalPanel {
  return {
    title: "Revenue",
    type: "metric",
    dataTypeId: "dt-1",
    fieldMapping: { value: "amount" },
    ...overrides,
  };
}

const typesById = new Map([["dt-1", pipelineOutputType]]);

/** `applyReady` is computed the same way `propose_dashboard` computes it
 *  (`warnings.length === 0`) — pinned here rather than re-imported so this
 *  suite exercises the exact contract without needing `proposal.ts`. */
function applyReadyFor(warnings: string[]): boolean {
  return warnings.length === 0;
}

describe("computeProposalWarnings — metricId (HEL-549)", () => {
  it("warns and applyReady is false when metricId is missing/not-owned", () => {
    const metricsById = new Map<string, MetricResponse>(); // caller owns no metrics

    const warnings = computeProposalWarnings(
      [panelFixture({ metricId: "metric-1" })],
      typesById,
      metricsById,
    );

    expect(warnings).toEqual([
      expect.stringContaining("metricId metric-1 not found among your metrics"),
    ]);
    expect(applyReadyFor(warnings)).toBe(false);
  });

  it("warns and applyReady is false when metricId resolves to a deprecated metric", () => {
    const metric = metricFixture({ deprecated: true });
    const metricsById = new Map([[metric.id, metric]]);

    const warnings = computeProposalWarnings(
      [panelFixture({ metricId: metric.id })],
      typesById,
      metricsById,
    );

    expect(warnings).toEqual([expect.stringContaining("deprecated")]);
    expect(applyReadyFor(warnings)).toBe(false);
  });

  it("warns and applyReady is false when metricId is set on an unsupported panel type", () => {
    const metric = metricFixture();
    const metricsById = new Map([[metric.id, metric]]);

    const warnings = computeProposalWarnings(
      [
        panelFixture({
          type: "timeline",
          metricId: metric.id,
          fieldMapping: { time: "amount", event: "amount" },
        }),
      ],
      typesById,
      metricsById,
    );

    expect(warnings).toEqual([
      expect.stringContaining("metricId is not supported on a timeline panel"),
    ]);
    expect(applyReadyFor(warnings)).toBe(false);
  });

  it("produces no metricId warning for a valid, caller-owned, non-deprecated metricId", () => {
    const metric = metricFixture();
    const metricsById = new Map([[metric.id, metric]]);

    const warnings = computeProposalWarnings(
      [panelFixture({ metricId: metric.id })],
      typesById,
      metricsById,
    );

    expect(warnings).toEqual([]);
    expect(applyReadyFor(warnings)).toBe(true);
  });

  it("omits the metricId check entirely when the panel supplies no metricId (unchanged behavior)", () => {
    const warnings = computeProposalWarnings([panelFixture()], typesById, new Map());

    expect(warnings).toEqual([]);
    expect(applyReadyFor(warnings)).toBe(true);
  });

  it("surfaces both a dataTypeId warning and a metricId warning independently for the same panel", () => {
    const warnings = computeProposalWarnings(
      [panelFixture({ dataTypeId: "dt-missing", metricId: "metric-missing" })],
      typesById,
      new Map(),
    );

    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("dataTypeId dt-missing not found in this workspace");
    expect(warnings[1]).toContain("metricId metric-missing not found among your metrics");
    expect(applyReadyFor(warnings)).toBe(false);
  });
});
