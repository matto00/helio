/**
 * HEL-907 task 3.5 — call-routing tests for the Output tool handlers.
 * Mirrors `pipelineProposalHandlers.test.ts`'s fixture convention (a
 * minimal hand-rolled `HelioApi`-shaped mock). Every handler here is a thin
 * pass-through, so each test asserts (a) the right `HelioApi` method was
 * called with the right arguments and (b) its result is returned verbatim,
 * plus (c) a `HelioApiError` propagates as a rejected promise, never
 * swallowed.
 */

import { HelioApiError } from "../httpClient.js";
import type { HelioApi } from "../helioApi.js";
import type {
  AssertionStatusResponse,
  DeleteOutputResponse,
  NodeCapabilitiesResponse,
  OutputPanelPlacementResponse,
  OutputHistoryResponse,
  OutputProvenanceResponse,
  OutputResponse,
  OutputsResponse,
  Paged,
  PipelinePreviewResponse,
} from "../types.js";
import {
  addOutputHandler,
  deleteOutputHandler,
  getOutputAssertionStatusHandler,
  getOutputCapabilitiesHandler,
  getOutputHandler,
  getOutputHistoryHandler,
  getOutputPanelsHandler,
  getOutputProvenanceHandler,
  getOutputRowsHandler,
  listOutputsHandler,
  previewOutputsHandler,
  updateOutputHandler,
} from "./outputsHandlers.js";

function makeFakeApi(overrides: Partial<Record<keyof HelioApi, unknown>> = {}): HelioApi {
  const fake = {
    createOutput: async () => {
      throw new Error("createOutput not stubbed");
    },
    updateOutput: async () => {
      throw new Error("updateOutput not stubbed");
    },
    deleteOutput: async () => {
      throw new Error("deleteOutput not stubbed");
    },
    listOutputsByPipeline: async () => {
      throw new Error("listOutputsByPipeline not stubbed");
    },
    listAllOutputs: async () => {
      throw new Error("listAllOutputs not stubbed");
    },
    getOutput: async () => {
      throw new Error("getOutput not stubbed");
    },
    getOutputRows: async () => {
      throw new Error("getOutputRows not stubbed");
    },
    listOutputPanels: async () => {
      throw new Error("listOutputPanels not stubbed");
    },
    getOutputAssertionStatus: async () => {
      throw new Error("getOutputAssertionStatus not stubbed");
    },
    previewOutputs: async () => {
      throw new Error("previewOutputs not stubbed");
    },
    getOutputHistory: async () => {
      throw new Error("getOutputHistory not stubbed");
    },
    getOutputCapabilities: async () => {
      throw new Error("getOutputCapabilities not stubbed");
    },
    ...overrides,
  };
  return fake as unknown as HelioApi;
}

const output: OutputResponse = {
  id: "output-1",
  pipelineId: "pipeline-1",
  ownerId: "user-1",
  name: "Weekly Revenue",
  kind: "table",
  config: {},
  schema: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("addOutputHandler", () => {
  it("calls api.createOutput with a CreateOutputRequest built from the input and returns its result", async () => {
    let calledWith: [string, unknown] | undefined;
    const api = makeFakeApi({
      createOutput: async (pipelineId: string, req: unknown) => {
        calledWith = [pipelineId, req];
        return output;
      },
    });

    const result = await addOutputHandler(api, {
      pipelineId: "pipeline-1",
      nodeStepId: "step-1",
      kind: "table",
      name: "Weekly Revenue",
      config: { fieldMapping: { value: "amount" } },
    });

    expect(calledWith).toEqual([
      "pipeline-1",
      {
        nodeStepId: "step-1",
        kind: "table",
        name: "Weekly Revenue",
        config: { fieldMapping: { value: "amount" } },
      },
    ]);
    expect(result).toBe(output);
  });

  it("propagates a rejected api.createOutput call (e.g. an ACL rejection) as a rejected promise", async () => {
    const api = makeFakeApi({
      createOutput: async () => {
        throw new HelioApiError(403, "/api/pipelines/pipeline-1/outputs", "forbidden");
      },
    });

    await expect(
      addOutputHandler(api, { pipelineId: "pipeline-1", kind: "table", name: "X" }),
    ).rejects.toThrow(HelioApiError);
  });
});

describe("updateOutputHandler", () => {
  it("calls api.updateOutput with an UpdateOutputRequest and returns its result", async () => {
    let calledWith: [string, unknown] | undefined;
    const api = makeFakeApi({
      updateOutput: async (outputId: string, req: unknown) => {
        calledWith = [outputId, req];
        return output;
      },
    });

    const result = await updateOutputHandler(api, { outputId: "output-1", name: "Renamed" });

    expect(calledWith).toEqual(["output-1", { name: "Renamed", config: undefined }]);
    expect(result).toBe(output);
  });

  it("passes config.historyPayloads: true through to the PATCH body unchanged (HEL-1331)", async () => {
    let calledWith: [string, unknown] | undefined;
    const api = makeFakeApi({
      updateOutput: async (outputId: string, req: unknown) => {
        calledWith = [outputId, req];
        return output;
      },
    });

    await updateOutputHandler(api, { outputId: "output-1", config: { historyPayloads: true } });

    expect(calledWith).toEqual([
      "output-1",
      { name: undefined, config: { historyPayloads: true } },
    ]);
  });
});

describe("updateOutputHandler historyPayloadLimits passthrough (HEL-1372)", () => {
  it("returns the backend's historyPayloadLimits untouched", async () => {
    const limits = {
      maxRows: 500,
      maxBytes: 1048576,
      tiers: {
        free: { maxRuns: 0, maxAgeDays: 0 },
        beta: { maxRuns: 5, maxAgeDays: 3 },
        owner: { maxRuns: 30, maxAgeDays: 30 },
      },
    };
    const api = makeFakeApi({
      updateOutput: async () => ({ ...output, historyPayloadLimits: limits }),
    });
    const result = await updateOutputHandler(api, { outputId: "output-1", name: "x" });
    expect((result as { historyPayloadLimits?: unknown }).historyPayloadLimits).toEqual(limits);
  });
});

describe("deleteOutputHandler", () => {
  it("calls api.deleteOutput and returns its result", async () => {
    const response: DeleteOutputResponse = { removedPanelIds: ["panel-1", "panel-2"] };
    let calledWith: string | undefined;
    const api = makeFakeApi({
      deleteOutput: async (outputId: string) => {
        calledWith = outputId;
        return response;
      },
    });

    const result = await deleteOutputHandler(api, "output-1");

    expect(calledWith).toBe("output-1");
    expect(result).toBe(response);
  });
});

describe("listOutputsHandler", () => {
  it("calls api.listOutputsByPipeline when pipelineId is given", async () => {
    const response: OutputsResponse = { items: [output] };
    let calledWith: [string, string | undefined] | undefined;
    const api = makeFakeApi({
      listOutputsByPipeline: async (pipelineId: string, nodeStepId?: string) => {
        calledWith = [pipelineId, nodeStepId];
        return response;
      },
    });

    const result = await listOutputsHandler(api, {
      pipelineId: "pipeline-1",
      nodeStepId: "step-1",
    });

    expect(calledWith).toEqual(["pipeline-1", "step-1"]);
    expect(result).toBe(response);
  });

  it("calls api.listAllOutputs when pipelineId is omitted", async () => {
    const response: Paged<OutputResponse> = { items: [output], total: 1, offset: 0, limit: 200 };
    let calledWith: [number | undefined, number | undefined] | undefined;
    const api = makeFakeApi({
      listAllOutputs: async (limit?: number, offset?: number) => {
        calledWith = [limit, offset];
        return response;
      },
    });

    const result = await listOutputsHandler(api, { limit: 50, offset: 10 });

    expect(calledWith).toEqual([50, 10]);
    expect(result).toBe(response);
  });
});

describe("getOutputHandler", () => {
  it("calls api.getOutput and returns its result", async () => {
    const api = makeFakeApi({
      getOutput: async (id: string) => (id === "output-1" ? output : undefined),
    });
    const result = await getOutputHandler(api, "output-1");
    expect(result).toBe(output);
  });
});

describe("getOutputRowsHandler", () => {
  it("calls api.getOutputRows with pagination and returns its result", async () => {
    const response: Paged<Record<string, unknown>> = {
      items: [{ amount: 5 }],
      total: 1,
      offset: 0,
      limit: 200,
    };
    let calledWith: [string, number | undefined, number | undefined] | undefined;
    const api = makeFakeApi({
      getOutputRows: async (outputId: string, limit?: number, offset?: number) => {
        calledWith = [outputId, limit, offset];
        return response;
      },
    });

    const result = await getOutputRowsHandler(api, { outputId: "output-1", limit: 10, offset: 0 });

    expect(calledWith).toEqual(["output-1", 10, 0]);
    expect(result).toBe(response);
  });
});

describe("getOutputPanelsHandler", () => {
  it("calls api.listOutputPanels and returns its result", async () => {
    const response: OutputPanelPlacementResponse[] = [
      { panelId: "panel-1", dashboardId: "dash-1" },
    ];
    const api = makeFakeApi({ listOutputPanels: async () => response });
    const result = await getOutputPanelsHandler(api, "output-1");
    expect(result).toBe(response);
  });
});

describe("getOutputAssertionStatusHandler", () => {
  it("calls api.getOutputAssertionStatus and returns its result", async () => {
    const response: AssertionStatusResponse = {
      outputId: "output-1",
      invalid: false,
      failedRuleCount: 0,
    };
    const api = makeFakeApi({ getOutputAssertionStatus: async () => response });
    const result = await getOutputAssertionStatusHandler(api, "output-1");
    expect(result).toBe(response);
  });
});

describe("getOutputProvenanceHandler", () => {
  it("calls api.getOutputProvenance with the output id and returns its result verbatim", async () => {
    const response: OutputProvenanceResponse = {
      outputId: "output-1",
      pipeline: { id: "p-1", name: "Pipe" },
      sources: [{ id: "s-1", name: "Sales", kind: "dataset" }],
      nodePath: ["filter"],
      lastRun: null,
      assertions: { defined: false, passed: 0, failed: 0, warned: 0, rootBound: false },
    };
    let calledWith: string | undefined;
    const api = makeFakeApi({
      getOutputProvenance: async (id: string) => {
        calledWith = id;
        return response;
      },
    });
    expect(await getOutputProvenanceHandler(api, "output-1")).toBe(response);
    expect(calledWith).toBe("output-1");
  });

  it("propagates a HelioApiError (e.g. the 404 for an unreadable Output)", async () => {
    const api = makeFakeApi({
      getOutputProvenance: async () => {
        throw new HelioApiError(404, "/api/outputs/nope/provenance", "Output not found");
      },
    });
    await expect(getOutputProvenanceHandler(api, "nope")).rejects.toBeInstanceOf(HelioApiError);
  });
});

describe("previewOutputsHandler", () => {
  it("calls api.previewOutputs with pipelineId/outputId and returns its result", async () => {
    const response: PipelinePreviewResponse = {
      outputs: [{ outputId: "output-1", preview: { rows: [], rowCount: 0 } }],
    };
    let calledWith: [string, string | undefined] | undefined;
    const api = makeFakeApi({
      previewOutputs: async (pipelineId: string, outputId?: string) => {
        calledWith = [pipelineId, outputId];
        return response;
      },
    });

    const result = await previewOutputsHandler(api, {
      pipelineId: "pipeline-1",
      outputId: "output-1",
    });

    expect(calledWith).toEqual(["pipeline-1", "output-1"]);
    expect(result).toBe(response);
  });

  it("passes outputId through as undefined when omitted (all-Outputs arm)", async () => {
    const response: PipelinePreviewResponse = { outputs: [] };
    let calledWith: [string, string | undefined] | undefined;
    const api = makeFakeApi({
      previewOutputs: async (pipelineId: string, outputId?: string) => {
        calledWith = [pipelineId, outputId];
        return response;
      },
    });

    await previewOutputsHandler(api, { pipelineId: "pipeline-1" });

    expect(calledWith).toEqual(["pipeline-1", undefined]);
  });
});

describe("getOutputCapabilitiesHandler", () => {
  it("calls api.getOutputCapabilities with pipelineId/stepId and returns its result", async () => {
    const response: NodeCapabilitiesResponse = { columns: [], capabilities: {} };
    let calledWith: [string, string | undefined] | undefined;
    const api = makeFakeApi({
      getOutputCapabilities: async (pipelineId: string, stepId?: string) => {
        calledWith = [pipelineId, stepId];
        return response;
      },
    });

    const result = await getOutputCapabilitiesHandler(api, {
      pipelineId: "pipeline-1",
      stepId: "step-1",
    });

    expect(calledWith).toEqual(["pipeline-1", "step-1"]);
    expect(result).toBe(response);
  });

  it("propagates a rejected api.getOutputCapabilities call as a rejected promise", async () => {
    const api = makeFakeApi({
      getOutputCapabilities: async () => {
        throw new HelioApiError(404, "/api/pipelines/pipeline-1/capabilities", "Unknown stepId");
      },
    });

    await expect(
      getOutputCapabilitiesHandler(api, { pipelineId: "pipeline-1", stepId: "bogus" }),
    ).rejects.toThrow(HelioApiError);
  });
});

describe("getOutputHistoryHandler (HEL-1274)", () => {
  const summary = { v: 1, rowCount: 3 };
  const history = {
    outputId: "output-1",
    compare: "previous_run",
    current: { capturedAt: "2026-10-05T10:00:00Z", rowCount: 3, value: 12 },
    baseline: { capturedAt: "2026-10-05T09:00:00Z", rowCount: 3, value: 10 },
    delta: 2,
    pct: 20,
    availableFrom: null,
    sparkline: [
      { capturedAt: "2026-10-05T09:00:00Z", value: 10 },
      { capturedAt: "2026-10-05T10:00:00Z", value: 12 },
    ],
    points: [
      {
        capturedAt: "2026-10-05T10:00:00Z",
        runId: "r2",
        triggerSource: "manual",
        rowCount: 3,
        summary,
      },
      {
        capturedAt: "2026-10-05T09:00:00Z",
        runId: "r1",
        triggerSource: "manual",
        rowCount: 3,
        summary,
      },
    ],
  } as unknown as OutputHistoryResponse;

  it("forwards args and drops points[].summary by default, leaving everything else identical", async () => {
    const calls: unknown[][] = [];
    const api = makeFakeApi({
      getOutputHistory: async (...args: unknown[]) => {
        calls.push(args);
        return history;
      },
    });

    const result = await getOutputHistoryHandler(api, {
      outputId: "output-1",
      limit: 30,
      since: "2026-10-05T00:00:00Z",
    });

    expect(calls).toEqual([["output-1", { limit: 30, since: "2026-10-05T00:00:00Z" }]]);
    expect(result.points.every((p) => !("summary" in p))).toBe(true);
    expect({ ...result, points: [] }).toEqual({ ...history, points: [] });
    expect(result.points.map((p) => p.runId)).toEqual(["r2", "r1"]);
  });

  it("returns the backend response unchanged with includeSummaries", async () => {
    const api = makeFakeApi({ getOutputHistory: async () => history });

    const result = await getOutputHistoryHandler(api, {
      outputId: "output-1",
      includeSummaries: true,
    });

    expect(result).toEqual(history);
  });

  it("omits resolved-point series by default and keeps it with includeSummaries (HEL-1277)", async () => {
    const series = {
      mode: "rows",
      x: "d",
      y: "v",
      agg: null,
      points: [["a", 1]],
      totalPoints: 1,
      downsampled: false,
    };
    const withSeries = {
      ...history,
      current: { ...history.current!, series },
      baseline: { ...history.baseline!, series },
    } as unknown as OutputHistoryResponse;
    const api = makeFakeApi({ getOutputHistory: async () => withSeries });

    const trimmed = await getOutputHistoryHandler(api, { outputId: "output-1" });
    expect("series" in trimmed.current!).toBe(false);
    expect("series" in trimmed.baseline!).toBe(false);
    expect(trimmed.current!.value).toBe(12);

    const full = await getOutputHistoryHandler(api, {
      outputId: "output-1",
      includeSummaries: true,
    });
    expect(full.current).toEqual(withSeries.current);
    expect(full.baseline).toEqual(withSeries.baseline);
  });

  it("propagates a HelioApiError", async () => {
    const err = new HelioApiError(404, "/api/outputs/nope/history", "Output not found");
    const api = makeFakeApi({
      getOutputHistory: async () => {
        throw err;
      },
    });

    await expect(getOutputHistoryHandler(api, { outputId: "nope" })).rejects.toBe(err);
  });
});
