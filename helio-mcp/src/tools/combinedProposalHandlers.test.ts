/**
 * HEL-387 tasks.md 7.8 — call-routing test for `applyCombinedProposalHandler`.
 *
 * Imports from `./combinedProposalHandlers.js` (NOT `./combinedProposal.js`)
 * deliberately, per design.md D7 / `pipelineProposalHandlers.test.ts`'s own
 * precedent — that module holds no zod/`registerTool` surface, so it never
 * risks the TS2589 combination `combinedProposal.ts` (nested `z.object`
 * shapes) has.
 *
 * Uses a minimal hand-rolled `HelioApi`-shaped mock, mirroring
 * `pipelineProposalHandlers.test.ts`'s `makeFakeApi`.
 */

import { HelioApiError } from "../httpClient.js";
import type { CombinedProposal, CombinedProposalApplyResponse } from "../types.js";
import type { HelioApi } from "../helioApi.js";
import { applyCombinedProposalHandler } from "./combinedProposalHandlers.js";

const combined: CombinedProposal = {
  pipeline: {
    pipelineName: "Revenue pipeline",
    source: { sourceId: "source-1" },
    steps: [],
    outputs: [],
  },
  dashboard: {
    dashboardName: "Revenue dashboard",
    panels: [
      {
        title: "Total",
        type: "metric",
        outputId: "$pipelineOutput",
        fieldMapping: { value: "amount" },
      },
    ],
  },
};

function makeFakeApi(overrides: Partial<Record<keyof HelioApi, unknown>> = {}): HelioApi {
  const fake = {
    applyCombinedProposal: async (_p: CombinedProposal) => {
      throw new Error("applyCombinedProposal not stubbed");
    },
    ...overrides,
  };
  return fake as unknown as HelioApi;
}

describe("applyCombinedProposalHandler", () => {
  it("calls api.applyCombinedProposal with the given proposal and returns its result", async () => {
    const response: CombinedProposalApplyResponse = {
      pipeline: {
        pipeline: {
          id: "pipeline-1",
          name: "Revenue pipeline",
          sourceDataSourceId: "source-1",
          sourceDataSourceName: "Source 1",
          lastRunStatus: "succeeded",
          lastRunAt: "2026-01-01T00:00:00Z",
          lastRunRowCount: 3,
        },
        outputs: [{ id: "type-1", name: "Revenue", kind: "table" }],
        run: { rows: [], rowCount: 3 },
      },
      dashboard: {
        dashboard: {
          id: "dash-1",
          name: "Revenue dashboard",
          meta: {
            createdBy: "user-1",
            createdAt: "2026-01-01T00:00:00Z",
            lastUpdated: "2026-01-01T00:00:00Z",
          },
          appearance: { background: "transparent", gridBackground: "transparent" },
          layout: { lg: [], md: [], sm: [], xs: [] },
          ownerId: "user-1",
        },
        panels: [],
      },
    };
    let calledWith: CombinedProposal | undefined;
    const api = makeFakeApi({
      applyCombinedProposal: async (p: CombinedProposal) => {
        calledWith = p;
        return response;
      },
    });

    const result = await applyCombinedProposalHandler(api, combined);

    expect(calledWith).toEqual(combined);
    expect(result).toBe(response);
  });

  it("propagates a rejected api.applyCombinedProposal call (e.g. a dangling sentinel) as a rejected promise, verbatim", async () => {
    const api = makeFakeApi({
      applyCombinedProposal: async () => {
        throw new HelioApiError(
          400,
          "/api/proposals/apply",
          "panel 'Total': $pipelineOutput is not in a resolvable binding position",
        );
      },
    });

    await expect(applyCombinedProposalHandler(api, combined)).rejects.toThrow(
      "is not in a resolvable binding position",
    );
  });
});
