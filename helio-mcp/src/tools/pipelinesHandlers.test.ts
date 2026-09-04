/**
 * HEL-907 task 3.2 — call-routing tests for `createPipelineHandler`.
 * Mirrors `pipelineProposalHandlers.test.ts`'s fixture convention.
 */

import { HelioApiError } from "../httpClient.js";
import type { HelioApi } from "../helioApi.js";
import type { OutputResponse, OutputsResponse, PipelineSummaryResponse } from "../types.js";
import {
  addOutputsFromShapeHandler,
  addPipelineRootHandler,
  createPipelineHandler,
  removePipelineRootHandler,
} from "./pipelinesHandlers.js";
import type { PipelineRootSummaryResponse, RemovePipelineRootResponse } from "../types.js";

const summary: PipelineSummaryResponse = {
  id: "pipeline-1",
  name: "Revenue pipeline",
  roots: [{ id: "root-1", dataSourceId: "source-1", dataSourceName: "Source 1" }],
  lastRunStatus: null,
  lastRunAt: null,
  lastRunRowCount: null,
};

function makeFakeApi(overrides: Partial<Record<keyof HelioApi, unknown>> = {}): HelioApi {
  const fake = {
    createPipeline: async () => summary,
    createDataSource: async () => {
      throw new Error("createDataSource not stubbed");
    },
    createRestDataSource: async () => {
      throw new Error("createRestDataSource not stubbed");
    },
    createSqlDataSource: async () => {
      throw new Error("createSqlDataSource not stubbed");
    },
    listOutputsByPipeline: async (): Promise<OutputsResponse> => ({ items: [] }),
    addPipelineRoot: async () => {
      throw new Error("addPipelineRoot not stubbed");
    },
    removePipelineRoot: async () => {
      throw new Error("removePipelineRoot not stubbed");
    },
    ...overrides,
  };
  return fake as unknown as HelioApi;
}

describe("createPipelineHandler", () => {
  it("calls api.createPipeline with roots: [{sourceId}] set from source.sourceId when an existing source is referenced", async () => {
    let calledWith: unknown;
    const api = makeFakeApi({
      createPipeline: async (req: unknown) => {
        calledWith = req;
        return summary;
      },
    });

    const result = await createPipelineHandler(api, {
      name: "Revenue pipeline",
      roots: [{ sourceId: "source-1" }],
      steps: [],
      outputs: [],
    });

    expect(calledWith).toEqual({
      name: "Revenue pipeline",
      roots: [{ sourceId: "source-1" }],
      tag: undefined,
      steps: [],
      outputs: [],
    });
    expect(result).toEqual(summary);
  });

  // HEL-913 task 9.1/9.2 -- the widening this ticket's own R6/HEL-914 acceptance criterion
  // depends on: one create_pipeline call resolves MULTIPLE roots, in order, and sends them all
  // as one roots[] array (never a single scalar, never a truncated array).
  it("resolves MULTIPLE roots, in order, sending all of them as one roots[] array", async () => {
    let calledWith: unknown;
    let createDataSourceCalledWith: unknown;
    const api = makeFakeApi({
      createDataSource: async (req: unknown) => {
        createDataSourceCalledWith = req;
        return { id: "new-source-2", name: "Inline Static Root", type: "static", tag: null };
      },
      createPipeline: async (req: unknown) => {
        calledWith = req;
        return summary;
      },
    });

    await createPipelineHandler(api, {
      name: "Two-Root Pipeline",
      roots: [
        { sourceId: "source-1", clientId: "rootA" },
        {
          type: "static",
          name: "Inline Static Root",
          clientId: "rootB",
          config: { columns: [{ name: "v", type: "string" }], rows: [["x"]] },
        },
      ],
      steps: [],
      outputs: [],
    });

    expect(createDataSourceCalledWith).toEqual({
      name: "Inline Static Root",
      columns: [{ name: "v", type: "string" }],
      rows: [["x"]],
    });
    expect(calledWith).toEqual({
      name: "Two-Root Pipeline",
      roots: [
        { sourceId: "source-1", clientId: "rootA" },
        { sourceId: "new-source-2", clientId: "rootB" },
      ],
      tag: undefined,
      steps: [],
      outputs: [],
    });
  });

  it("reports EVERY earlier root's orphaned inline source when a LATER root's resolution fails", async () => {
    let createDataSourceCallCount = 0;
    const api = makeFakeApi({
      createDataSource: async () => {
        createDataSourceCallCount += 1;
        return {
          id: `new-source-${createDataSourceCallCount}`,
          name: "x",
          type: "static",
          tag: null,
        };
      },
    });

    await expect(
      createPipelineHandler(api, {
        name: "X",
        roots: [
          { type: "static", config: { columns: [], rows: [] } },
          { type: "static", config: { columns: [], rows: [] } },
          // third root: neither sourceId nor a recognized type -- fails resolution
          {},
        ],
        steps: [],
        outputs: [],
      }),
    ).rejects.toThrow(/orphaned DataSource ids: new-source-1, new-source-2/);
  });

  it("creates a static inline source first, then the pipeline, using the freshly-created source's id", async () => {
    let createDataSourceCalledWith: unknown;
    let createPipelineCalledWith: unknown;
    const api = makeFakeApi({
      createDataSource: async (req: unknown) => {
        createDataSourceCalledWith = req;
        return {
          id: "new-source-1",
          name: "Inline Static",
          type: "static",
          createdAt: "",
          updatedAt: "",
        };
      },
      createPipeline: async (req: unknown) => {
        createPipelineCalledWith = req;
        return summary;
      },
    });

    await createPipelineHandler(api, {
      name: "Revenue pipeline",
      roots: [
        {
          type: "static",
          name: "Inline Static",
          config: { columns: [{ name: "amount", type: "float" }], rows: [[1]] },
        },
      ],
      steps: [],
      outputs: [],
    });

    expect(createDataSourceCalledWith).toEqual({
      name: "Inline Static",
      columns: [{ name: "amount", type: "float" }],
      rows: [[1]],
    });
    expect(createPipelineCalledWith).toMatchObject({ roots: [{ sourceId: "new-source-1" }] });
  });

  it("reports the orphaned inline source id in the thrown error when the pipeline-create call fails", async () => {
    const api = makeFakeApi({
      createDataSource: async () => ({
        id: "orphan-source-1",
        name: "X",
        type: "static",
        createdAt: "",
        updatedAt: "",
      }),
      createPipeline: async () => {
        throw new HelioApiError(400, "/api/pipelines", "boom");
      },
    });

    await expect(
      createPipelineHandler(api, {
        name: "X",
        roots: [{ type: "static", config: { columns: [], rows: [] } }],
        steps: [],
        outputs: [],
      }),
    ).rejects.toThrow(/orphan-source-1/);
  });

  it("does NOT mention an orphaned source when the source was an existing sourceId (nothing was created)", async () => {
    const api = makeFakeApi({
      createPipeline: async () => {
        throw new HelioApiError(404, "/api/pipelines", "Data source not found");
      },
    });

    await expect(
      createPipelineHandler(api, {
        name: "X",
        roots: [{ sourceId: "source-1" }],
        steps: [],
        outputs: [],
      }),
    ).rejects.toThrow(HelioApiError);
  });

  it("rejects an inline source whose type is csv, naming create_csv_data_source as the workaround", async () => {
    const api = makeFakeApi();

    await expect(
      createPipelineHandler(api, {
        name: "X",
        // @ts-expect-error -- csv is deliberately not in the accepted inline-type union
        roots: [{ type: "csv", config: {} }],
        steps: [],
        outputs: [],
      }),
    ).rejects.toThrow(/create_csv_data_source/);
  });

  it("follows up with listOutputsByPipeline and attaches its result when outputs were requested", async () => {
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
    const api = makeFakeApi({
      listOutputsByPipeline: async (pipelineId: string): Promise<OutputsResponse> =>
        pipelineId === "pipeline-1" ? { items: [output] } : { items: [] },
    });

    const result = await createPipelineHandler(api, {
      name: "Revenue pipeline",
      roots: [{ sourceId: "source-1" }],
      steps: [],
      outputs: [{ kind: "table", name: "Weekly Revenue" }],
    });

    expect(result.outputs).toEqual([output]);
  });

  it("does NOT call listOutputsByPipeline when no outputs were requested", async () => {
    let called = false;
    const api = makeFakeApi({
      listOutputsByPipeline: async (): Promise<OutputsResponse> => {
        called = true;
        return { items: [] };
      },
    });

    const result = await createPipelineHandler(api, {
      name: "Revenue pipeline",
      roots: [{ sourceId: "source-1" }],
      steps: [],
      outputs: [],
    });

    expect(called).toBe(false);
    expect(result.outputs).toBeUndefined();
  });
});

describe("addOutputsFromShapeHandler", () => {
  const stepA = {
    id: "step-a",
    pipelineId: "pipeline-1",
    position: 0,
    type: "select",
    config: {},
    enabled: true,
    createdAt: "",
    updatedAt: "",
  };
  const stepB = {
    id: "step-b",
    pipelineId: "pipeline-1",
    position: 1,
    type: "sort",
    config: {},
    enabled: true,
    createdAt: "",
    updatedAt: "",
  };
  const output: OutputResponse = {
    id: "output-1",
    pipelineId: "pipeline-1",
    ownerId: "user-1",
    name: "Top customers",
    kind: "table",
    config: {},
    schema: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  function makePipelinesApi(overrides: Partial<Record<keyof HelioApi, unknown>> = {}): HelioApi {
    const fake = {
      expandPipelineShape: async () => [{ kind: "select", config: {} }],
      addPipelineStep: async () => stepA,
      createOutput: async () => output,
      ...overrides,
    };
    return fake as unknown as HelioApi;
  }

  it("expands the shape, chains each step off the given stepId, then creates the Output on the LAST added step", async () => {
    const addPipelineStepCalls: unknown[] = [];
    let createOutputCalledWith: unknown;
    const api = makePipelinesApi({
      expandPipelineShape: async () => [
        { kind: "select", config: { fields: ["region"] } },
        { kind: "sort", config: { sortBy: [{ field: "revenue", direction: "desc" }] } },
      ],
      addPipelineStep: async (pipelineId: string, step: unknown) => {
        addPipelineStepCalls.push([pipelineId, step]);
        return addPipelineStepCalls.length === 1 ? stepA : stepB;
      },
      createOutput: async (pipelineId: string, req: unknown) => {
        createOutputCalledWith = [pipelineId, req];
        return output;
      },
    });

    const result = await addOutputsFromShapeHandler(api, {
      pipelineId: "pipeline-1",
      stepId: "anchor-step",
      shapeId: "top-n",
      params: { measure: "revenue", direction: "desc", n: 5 },
      outputName: "Top customers",
    });

    expect(addPipelineStepCalls).toEqual([
      [
        "pipeline-1",
        { type: "select", config: { fields: ["region"] }, parentStepId: "anchor-step" },
      ],
      [
        "pipeline-1",
        {
          type: "sort",
          config: { sortBy: [{ field: "revenue", direction: "desc" }] },
          parentStepId: "step-a",
        },
      ],
    ]);
    expect(createOutputCalledWith).toEqual([
      "pipeline-1",
      { nodeStepId: "step-b", kind: "table", name: "Top customers" },
    ]);
    expect(result).toEqual({ steps: [stepA, stepB], output });
  });

  it("branches off the pipeline's raw source (parentStepId undefined) when stepId is omitted", async () => {
    let firstStepCalledWith: unknown;
    const api = makePipelinesApi({
      addPipelineStep: async (pipelineId: string, step: unknown) => {
        firstStepCalledWith = step;
        return stepA;
      },
    });

    await addOutputsFromShapeHandler(api, {
      pipelineId: "pipeline-1",
      shapeId: "passthrough",
      params: { fields: ["region"] },
      outputName: "Region",
    });

    expect(firstStepCalledWith).toEqual({ type: "select", config: {}, parentStepId: undefined });
  });

  it("defaults outputKind to 'table' when omitted", async () => {
    let createOutputCalledWith: unknown;
    const api = makePipelinesApi({
      createOutput: async (pipelineId: string, req: unknown) => {
        createOutputCalledWith = req;
        return output;
      },
    });

    await addOutputsFromShapeHandler(api, {
      pipelineId: "pipeline-1",
      shapeId: "passthrough",
      params: {},
      outputName: "X",
    });

    expect(createOutputCalledWith).toMatchObject({ kind: "table" });
  });

  it("passes outputKind through when given", async () => {
    let createOutputCalledWith: unknown;
    const api = makePipelinesApi({
      createOutput: async (pipelineId: string, req: unknown) => {
        createOutputCalledWith = req;
        return output;
      },
    });

    await addOutputsFromShapeHandler(api, {
      pipelineId: "pipeline-1",
      shapeId: "passthrough",
      params: {},
      outputName: "X",
      outputKind: "metric",
    });

    expect(createOutputCalledWith).toMatchObject({ kind: "metric" });
  });

  it("adds NOTHING when expand fails -- neither addPipelineStep nor createOutput is called", async () => {
    let addPipelineStepCalled = false;
    let createOutputCalled = false;
    const api = makePipelinesApi({
      expandPipelineShape: async () => {
        throw new HelioApiError(404, "/api/pipeline-shapes/bogus/expand", "Unknown shapeId: bogus");
      },
      addPipelineStep: async () => {
        addPipelineStepCalled = true;
        return stepA;
      },
      createOutput: async () => {
        createOutputCalled = true;
        return output;
      },
    });

    await expect(
      addOutputsFromShapeHandler(api, {
        pipelineId: "pipeline-1",
        shapeId: "bogus",
        params: {},
        outputName: "X",
      }),
    ).rejects.toThrow(HelioApiError);
    expect(addPipelineStepCalled).toBe(false);
    expect(createOutputCalled).toBe(false);
  });

  it("creates the Output anchored on stepId itself when expand returns zero steps", async () => {
    let createOutputCalledWith: unknown;
    const api = makePipelinesApi({
      expandPipelineShape: async () => [],
      createOutput: async (pipelineId: string, req: unknown) => {
        createOutputCalledWith = req;
        return output;
      },
    });

    await addOutputsFromShapeHandler(api, {
      pipelineId: "pipeline-1",
      stepId: "anchor-step",
      shapeId: "passthrough",
      params: {},
      outputName: "X",
    });

    expect(createOutputCalledWith).toMatchObject({ nodeStepId: "anchor-step" });
  });
});

describe("addPipelineRootHandler", () => {
  it("calls api.addPipelineRoot with {sourceId} set from source.sourceId when an existing source is referenced", async () => {
    let calledWith: [string, unknown] | undefined;
    const newRoot: PipelineRootSummaryResponse = {
      id: "root-2",
      dataSourceId: "source-2",
      dataSourceName: "Source 2",
    };
    const api = makeFakeApi({
      addPipelineRoot: async (pipelineId: string, req: unknown) => {
        calledWith = [pipelineId, req];
        return newRoot;
      },
    });

    const result = await addPipelineRootHandler(api, {
      pipelineId: "pipeline-1",
      source: { sourceId: "source-2" },
    });

    expect(calledWith).toEqual(["pipeline-1", { sourceId: "source-2" }]);
    expect(result).toEqual(newRoot);
  });

  it("creates a static inline source first, then the root, using the freshly-created source's id", async () => {
    let createDataSourceCalledWith: unknown;
    let addRootCalledWith: unknown;
    const api = makeFakeApi({
      createDataSource: async (req: unknown) => {
        createDataSourceCalledWith = req;
        return { id: "new-source-1", name: "Inline Static", type: "static", tag: null };
      },
      addPipelineRoot: async (_pipelineId: string, req: unknown) => {
        addRootCalledWith = req;
        return { id: "root-2", dataSourceId: "new-source-1", dataSourceName: "Inline Static" };
      },
    });

    await addPipelineRootHandler(api, {
      pipelineId: "pipeline-1",
      source: {
        type: "static",
        name: "Inline Static",
        config: { columns: [{ name: "amount", type: "float" }], rows: [[1]] },
      },
    });

    expect(createDataSourceCalledWith).toEqual({
      name: "Inline Static",
      columns: [{ name: "amount", type: "float" }],
      rows: [[1]],
    });
    expect(addRootCalledWith).toEqual({ sourceId: "new-source-1" });
  });

  it("reports the orphaned inline source id in the thrown error when the add-root call fails", async () => {
    const api = makeFakeApi({
      createDataSource: async () => ({
        id: "new-source-1",
        name: "Inline Static",
        type: "static",
        tag: null,
      }),
      addPipelineRoot: async () => {
        throw new Error("backend 400");
      },
    });

    await expect(
      addPipelineRootHandler(api, {
        pipelineId: "pipeline-1",
        source: { type: "static", name: "Inline Static", config: { columns: [], rows: [] } },
      }),
    ).rejects.toThrow(/orphaned DataSource id: new-source-1/);
  });
});

describe("removePipelineRootHandler", () => {
  it("calls api.removePipelineRoot with the given pipelineId/rootId and returns its result", async () => {
    let calledWith: [string, string] | undefined;
    const response: RemovePipelineRootResponse = { removedStepCount: 3, removedOutputCount: 1 };
    const api = makeFakeApi({
      removePipelineRoot: async (pipelineId: string, rootId: string) => {
        calledWith = [pipelineId, rootId];
        return response;
      },
    });

    const result = await removePipelineRootHandler(api, {
      pipelineId: "pipeline-1",
      rootId: "root-2",
    });

    expect(calledWith).toEqual(["pipeline-1", "root-2"]);
    expect(result).toEqual(response);
  });
});
