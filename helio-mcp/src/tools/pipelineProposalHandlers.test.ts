/**
 * HEL-385 tasks.md 7.2 — call-routing tests for `proposePipelineHandler`/
 * `analyzePipelineProposalHandler`/`applyPipelineProposalHandler`.
 *
 * Imports from `./pipelineProposalHandlers.js` (NOT `./pipelineProposal.js`)
 * deliberately, per design.md D4b — that module holds no zod/`registerTool`
 * surface, so it never risks the TS2589 combination `pipelineProposal.ts`
 * has.
 *
 * Uses a minimal hand-rolled `HelioApi`-shaped mock, mirroring
 * `context.test.ts`'s `makeFakeApi` — the only existing precedent in this
 * codebase for mocking `HelioApi` (a class with a private constructor field,
 * so a plain object literal needs `as unknown as HelioApi` to satisfy the
 * type; there is no existing tool-handler test to mirror instead, per
 * round-1 skeptic finding 2). These tests stop at the handler boundary:
 * `guarded`'s `isError`/message-formatting behavior is `proposal.ts`/
 * `write.ts`'s existing, already-covered-by-convention logic and is not
 * re-tested here — the handlers contain no zod/registerTool surface to
 * exercise in the first place.
 */

import { HelioApiError } from "../httpClient.js";
import type {
  PipelineAnalyzeProposalResponse,
  PipelineProposal,
  PipelineProposalApplyResponse,
} from "../types.js";
import type { HelioApi } from "../helioApi.js";
import {
  analyzePipelineProposalHandler,
  applyPipelineProposalHandler,
  proposePipelineHandler,
} from "./pipelineProposalHandlers.js";

const proposal: PipelineProposal = {
  pipelineName: "Revenue pipeline",
  source: { sourceId: "source-1" },
  steps: [],
  outputs: [],
};

function makeFakeApi(overrides: Partial<Record<keyof HelioApi, unknown>> = {}): HelioApi {
  const fake = {
    listDataSources: async () => ({
      items: [{ id: "source-1", name: "Source 1", type: "static", createdAt: "", updatedAt: "" }],
      total: 1,
      offset: 0,
      limit: 200,
    }),
    analyzePipelineProposal: async (_p: PipelineProposal) => {
      throw new Error("analyzePipelineProposal not stubbed");
    },
    applyPipelineProposal: async (_p: PipelineProposal) => {
      throw new Error("applyPipelineProposal not stubbed");
    },
    ...overrides,
  };
  return fake as unknown as HelioApi;
}

describe("proposePipelineHandler", () => {
  it("calls api.listDataSources and returns a warning-free applyReady:true proposal for a valid sourceId", async () => {
    const api = makeFakeApi();

    const result = await proposePipelineHandler(api, {
      pipelineName: proposal.pipelineName,
      source: proposal.source,
      steps: proposal.steps,
      outputs: proposal.outputs,
    });

    expect(result.proposal).toEqual(proposal);
    expect(result.warnings).toEqual([]);
    expect(result.applyReady).toBe(true);
  });

  it("returns applyReady:false with a warning (via computePipelineProposalWarnings) when the sourceId does not resolve", async () => {
    const api = makeFakeApi({
      listDataSources: async () => ({ items: [], total: 0, offset: 0, limit: 200 }),
    });

    const result = await proposePipelineHandler(api, {
      pipelineName: proposal.pipelineName,
      source: { sourceId: "source-missing" },
      steps: proposal.steps,
      outputs: proposal.outputs,
    });

    expect(result.applyReady).toBe(false);
    expect(result.warnings).toEqual([
      expect.stringContaining("sourceId source-missing not found among your data sources"),
    ]);
  });

  it("propagates a rejected api.listDataSources call as a rejected promise", async () => {
    const api = makeFakeApi({
      listDataSources: async () => {
        throw new HelioApiError(500, "/api/data-sources", "boom");
      },
    });

    await expect(
      proposePipelineHandler(api, {
        pipelineName: proposal.pipelineName,
        source: proposal.source,
        steps: proposal.steps,
        outputs: proposal.outputs,
      }),
    ).rejects.toThrow(HelioApiError);
  });
});

describe("analyzePipelineProposalHandler", () => {
  it("calls api.analyzePipelineProposal with the given proposal and returns its result", async () => {
    const response: PipelineAnalyzeProposalResponse = {
      sourceName: "Source 1",
      sourceSchema: [{ name: "amount", type: "integer" }],
      steps: [],
    };
    let calledWith: PipelineProposal | undefined;
    const api = makeFakeApi({
      analyzePipelineProposal: async (p: PipelineProposal) => {
        calledWith = p;
        return response;
      },
    });

    const result = await analyzePipelineProposalHandler(api, proposal);

    expect(calledWith).toEqual(proposal);
    expect(result).toBe(response);
  });

  it("propagates a rejected api.analyzePipelineProposal call as a rejected promise", async () => {
    const api = makeFakeApi({
      analyzePipelineProposal: async () => {
        throw new HelioApiError(400, "/api/pipelines/analyze-proposal", "bad proposal");
      },
    });

    await expect(analyzePipelineProposalHandler(api, proposal)).rejects.toThrow(HelioApiError);
  });
});

describe("applyPipelineProposalHandler", () => {
  it("calls api.applyPipelineProposal with the given proposal and returns its result", async () => {
    const response: PipelineProposalApplyResponse = {
      pipeline: {
        id: "pipeline-1",
        name: "Revenue pipeline",
        roots: [{ id: "root-1", dataSourceId: "source-1", dataSourceName: "Source 1" }],
        lastRunStatus: "succeeded",
        lastRunAt: "2026-01-01T00:00:00Z",
        lastRunRowCount: 3,
      },
      outputs: [{ id: "type-1", name: "Revenue", kind: "table" }],
      run: { rows: [], rowCount: 3 },
    };
    let calledWith: PipelineProposal | undefined;
    const api = makeFakeApi({
      applyPipelineProposal: async (p: PipelineProposal) => {
        calledWith = p;
        return response;
      },
    });

    const result = await applyPipelineProposalHandler(api, proposal);

    expect(calledWith).toEqual(proposal);
    expect(result).toBe(response);
  });

  it("propagates a rejected api.applyPipelineProposal call (e.g. a non-SELECT SQL guardrail) as a rejected promise, verbatim", async () => {
    const api = makeFakeApi({
      applyPipelineProposal: async () => {
        throw new HelioApiError(400, "/api/pipelines/apply-proposal", "query must be read-only");
      },
    });

    await expect(applyPipelineProposalHandler(api, proposal)).rejects.toThrow(
      "query must be read-only",
    );
  });
});
