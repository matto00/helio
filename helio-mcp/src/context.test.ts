/**
 * HEL-907 tasks.md 3.8/5.2 — MCP-side unit tests for the slimmed
 * `get_workspace_context` (design.md Decision 6): types/metrics dropped
 * entirely, pipelines summarized by their Outputs (kind/schema/placements),
 * sources by `inferredSchema`. Supersedes the pre-HEL-907 test file, which
 * exercised `sanitizeSampleRows`/`computeColumnStats`/`classifySemanticRole`/
 * `computeJoinHints`/the tiered budget shed order — all deleted along with
 * the DataType-based sample-row/column-stats machinery they served (there is
 * no more per-column row data in this endpoint to compute statistics or join
 * hints over).
 */

import {
  applyBudget,
  buildWorkspaceContext,
  DEFAULT_BUDGET_BYTES,
  paginationTruncatedResources,
  rankMemoryEntries,
  type WorkspaceContext,
} from "./context.js";
import { HelioApi } from "./helioApi.js";
import type {
  AgentMemoryEntryResponse,
  DataSourceResponse,
  OutputPanelPlacementResponse,
  OutputResponse,
  OutputsResponse,
  Paged,
  PipelineAnalyzeResponse,
  PipelineRunRecordResponse,
  PipelineShapeCatalogEntryResponse,
  PipelineSummaryResponse,
} from "./types.js";

function emptyPage<T>(): Paged<T> {
  return { items: [], total: 0, offset: 0, limit: 200 };
}

function page<T>(items: T[]): Paged<T> {
  return { items, total: items.length, offset: 0, limit: 200 };
}

/** A minimal fake covering every call `buildWorkspaceContext` makes. Individual tests override
 *  specific methods to exercise degrade paths / real data. */
function baseFakeApi(): Record<string, unknown> {
  return {
    listDataSources: async () => emptyPage<DataSourceResponse>(),
    listDashboards: async () => emptyPage(),
    listPipelines: async () => [] as PipelineSummaryResponse[],
    listPipelineShapes: async () => [] as PipelineShapeCatalogEntryResponse[],
    listAllOutputs: async () => emptyPage<OutputResponse>(),
    listOutputPanels: async () => [] as OutputPanelPlacementResponse[],
    getAgentPreferences: async () => ({ extras: {} }),
    listAgentMemory: async () => [] as AgentMemoryEntryResponse[],
    listConnectorInstances: async () => [],
  };
}

describe("buildWorkspaceContext — shape (HEL-907 design.md Decision 6)", () => {
  it("has no dataTypes or metrics field on the returned context", async () => {
    const context = await buildWorkspaceContext(baseFakeApi() as unknown as HelioApi);

    expect(context).not.toHaveProperty("dataTypes");
    expect(context).not.toHaveProperty("metrics");
    expect(context).not.toHaveProperty("joinHints");
  });

  it("counts carries only dataSources/pipelines/dashboards, not dataTypes", async () => {
    const context = await buildWorkspaceContext(baseFakeApi() as unknown as HelioApi);

    expect(context.counts).toEqual({ dataSources: 0, pipelines: 0, dashboards: 0 });
  });

  it("maps a data source's inferredSchema fields to {name, type} pairs", async () => {
    const source: DataSourceResponse = {
      id: "src-1",
      name: "Orders",
      type: "csv",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      inferredSchema: {
        fields: [
          { name: "orderId", displayName: "Order Id", dataType: "string", nullable: false },
          { name: "amount", displayName: "Amount", dataType: "float", nullable: true },
        ],
      },
    };
    const fake = { ...baseFakeApi(), listDataSources: async () => page([source]) };

    const context = await buildWorkspaceContext(fake as unknown as HelioApi);

    expect(context.dataSources).toEqual([
      {
        id: "src-1",
        name: "Orders",
        type: "csv",
        tag: null,
        inferredSchema: [
          { name: "orderId", type: "string" },
          { name: "amount", type: "float" },
        ],
      },
    ]);
  });

  it("reports [] for inferredSchema when the source has never had its schema inferred", async () => {
    const source: DataSourceResponse = {
      id: "src-1",
      name: "Orders",
      type: "csv",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const fake = { ...baseFakeApi(), listDataSources: async () => page([source]) };

    const context = await buildWorkspaceContext(fake as unknown as HelioApi);

    expect(context.dataSources[0]?.inferredSchema).toEqual([]);
  });
});

describe("buildWorkspaceContext — pipelines carry Outputs, not an implicit output DataType", () => {
  const summary: PipelineSummaryResponse = {
    id: "pipe-1",
    name: "Orders Pipeline",
    sourceDataSourceId: "src-1",
    sourceDataSourceName: "Orders",
    lastRunStatus: "success",
    lastRunAt: "2026-01-02T00:00:00Z",
    lastRunRowCount: 10,
  };

  const analyzeResponse: PipelineAnalyzeResponse = {
    id: "pipe-1",
    name: "Orders Pipeline",
    sourceDataSourceName: "Orders",
    sourceSchema: [],
    steps: [
      {
        id: "step-1",
        position: 0,
        type: "filter",
        config: {},
        inputSchema: [],
        outputSchema: [{ name: "orderId", type: "string" }],
        validationError: null,
      },
    ],
  };

  const output: OutputResponse = {
    id: "out-1",
    pipelineId: "pipe-1",
    nodeStepId: "step-1",
    ownerId: "owner-1",
    name: "Orders Table",
    kind: "table",
    config: {},
    schema: [{ name: "orderId", type: "string" }],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  function fakeApiWithPipeline(overrides: Record<string, unknown> = {}) {
    return {
      ...baseFakeApi(),
      listPipelines: async () => [summary],
      analyzePipeline: async () => analyzeResponse,
      getPipelineRunHistory: async () => [] as PipelineRunRecordResponse[],
      listAllOutputs: async () => page([output]),
      listOutputPanels: async () =>
        [{ panelId: "panel-1", dashboardId: "dash-1" }] as OutputPanelPlacementResponse[],
      ...overrides,
    };
  }

  // HEL-907 evaluator-final round-2: the prior version of this test asserted the context
  // entry didn't expose outputDataTypeId/outputDataTypeName -- vacuous now that
  // PipelineSummaryResponse/PipelineAnalyzeResponse no longer HAVE those fields at all (CR1/CR5),
  // so the input could never carry them in the first place. Deleted rather than left as
  // evidence-shaped non-evidence (an assertion that can never fail).

  it("groups Outputs by pipelineId, carrying kind/schema/nodeStepId/placements", async () => {
    const context = await buildWorkspaceContext(fakeApiWithPipeline() as unknown as HelioApi);
    const pipeline = context.pipelines[0];

    expect(pipeline?.outputs).toEqual([
      {
        id: "out-1",
        name: "Orders Table",
        kind: "table",
        nodeStepId: "step-1",
        schema: [{ name: "orderId", type: "string" }],
        placements: [{ dashboardId: "dash-1", panelId: "panel-1" }],
      },
    ]);
  });

  it("reports nodeStepId: null for a source-attached Output (nodeStepId absent on the wire)", async () => {
    const sourceOutput: OutputResponse = { ...output, id: "out-2", nodeStepId: undefined };
    const context = await buildWorkspaceContext(
      fakeApiWithPipeline({
        listAllOutputs: async () => page([sourceOutput]),
      }) as unknown as HelioApi,
    );

    expect(context.pipelines[0]?.outputs[0]?.nodeStepId).toBeNull();
  });

  it("reports [] for outputs on a pipeline with none yet", async () => {
    const context = await buildWorkspaceContext(
      fakeApiWithPipeline({
        listAllOutputs: async () => emptyPage<OutputResponse>(),
      }) as unknown as HelioApi,
    );

    expect(context.pipelines[0]?.outputs).toEqual([]);
  });

  it("degrades one Output's placements to [] when listOutputPanels fails, without failing the whole call", async () => {
    const context = await buildWorkspaceContext(
      fakeApiWithPipeline({
        listOutputPanels: async () => {
          throw new Error("boom");
        },
      }) as unknown as HelioApi,
    );

    expect(context.pipelines[0]?.outputs[0]?.placements).toEqual([]);
    expect(context.pipelines[0]?.outputs[0]?.id).toBe("out-1");
  });

  it("fetches every page of Outputs when the caller has more than one page's worth", async () => {
    const outputsPage1 = Array.from({ length: 200 }, (_, i) => ({
      ...output,
      id: `out-${i}`,
      name: `Output ${i}`,
    }));
    const outputsPage2 = [{ ...output, id: "out-200", name: "Output 200" }];
    const calls: number[] = [];
    const fake = fakeApiWithPipeline({
      listAllOutputs: async (limit: number, offset: number) => {
        calls.push(offset);
        if (offset === 0) return { items: outputsPage1, total: 201, offset: 0, limit };
        return { items: outputsPage2, total: 201, offset, limit };
      },
    });

    const context = await buildWorkspaceContext(fake as unknown as HelioApi);

    expect(calls).toEqual([0, 200]);
    expect(context.pipelines[0]?.outputs).toHaveLength(201);
  });

  it("still degrades steps/stepsError on an analyze failure without dropping outputs", async () => {
    const context = await buildWorkspaceContext(
      fakeApiWithPipeline({
        analyzePipeline: async () => {
          throw new Error("analyze exploded");
        },
      }) as unknown as HelioApi,
    );
    const pipeline = context.pipelines[0];

    expect(pipeline?.steps).toEqual([]);
    expect(pipeline?.stepsError).toBe("analyze exploded");
    expect(pipeline?.outputs).toEqual([
      {
        id: "out-1",
        name: "Orders Table",
        kind: "table",
        nodeStepId: "step-1",
        schema: [{ name: "orderId", type: "string" }],
        placements: [{ dashboardId: "dash-1", panelId: "panel-1" }],
      },
    ]);
  });
});

describe("buildWorkspaceContext — agentContext wiring (HEL-521, carried forward)", () => {
  it("degrades agentContext.preferences to the empty default when getAgentPreferences fails", async () => {
    const fake = {
      ...baseFakeApi(),
      getAgentPreferences: async () => {
        throw new Error("boom");
      },
    };

    const context = await buildWorkspaceContext(fake as unknown as HelioApi);

    expect(context.agentContext.preferences).toEqual({ extras: {} });
    expect(context.counts).toEqual({ dataSources: 0, pipelines: 0, dashboards: 0 });
  });

  it("reports agentContext.memory ranked most-recently-used first (rankMemoryEntries)", () => {
    const entries: AgentMemoryEntryResponse[] = [
      { id: "a", createdAt: "2026-01-01T00:00:00Z" } as AgentMemoryEntryResponse,
      {
        id: "b",
        createdAt: "2026-01-01T00:00:00Z",
        lastUsedAt: "2026-01-02T00:00:00Z",
      } as AgentMemoryEntryResponse,
    ];

    expect(rankMemoryEntries(entries).map((e) => e.id)).toEqual(["b", "a"]);
  });
});

describe("buildWorkspaceContext — connectors wiring (HEL-828, carried forward)", () => {
  it("degrades connectors to [] when listConnectorInstances rejects", async () => {
    const fake = {
      ...baseFakeApi(),
      listConnectorInstances: async () => {
        throw new Error("boom");
      },
    };

    const context = await buildWorkspaceContext(fake as unknown as HelioApi);

    expect(context.connectors).toEqual([]);
  });
});

describe("paginationTruncatedResources", () => {
  it("reports only the resources whose fetched page is smaller than the reported total", () => {
    const result = paginationTruncatedResources(
      { items: [1, 2], total: 5 },
      { items: [1], total: 1 },
    );

    expect(result).toEqual(["dataSources"]);
  });

  it("reports [] when every resource's page covers its whole total", () => {
    const result = paginationTruncatedResources({ items: [1], total: 1 }, { items: [], total: 0 });

    expect(result).toEqual([]);
  });
});

describe("applyBudget (HEL-907 design.md Decision 6 — no tiered shed order)", () => {
  const minimalContext: WorkspaceContext = {
    generatedAt: "2026-01-01T00:00:00Z",
    counts: { dataSources: 0, pipelines: 0, dashboards: 0 },
    dataSources: [],
    pipelines: [],
    dashboards: [],
    pipelineShapes: [],
    truncation: {
      applied: false,
      budgetBytes: 0,
      estimatedSizeBytes: 0,
      structuralFloorExceedsBudget: false,
      paginationTruncatedResources: [],
    },
    agentContext: { preferences: { extras: {} }, memory: [] },
    connectors: [],
  };

  it("reports applied: false and structuralFloorExceedsBudget: false when the context fits", () => {
    const result = applyBudget(minimalContext, DEFAULT_BUDGET_BYTES, []);

    expect(result.truncation.applied).toBe(false);
    expect(result.truncation.structuralFloorExceedsBudget).toBe(false);
  });

  it("reports structuralFloorExceedsBudget: true, without dropping any resource, when even the slim shape exceeds budget", () => {
    const result = applyBudget(minimalContext, 1, []);

    expect(result.truncation.structuralFloorExceedsBudget).toBe(true);
    expect(result.dataSources).toEqual(minimalContext.dataSources);
    expect(result.pipelines).toEqual(minimalContext.pipelines);
  });

  it("threads paginationTruncatedResources through unchanged", () => {
    const result = applyBudget(minimalContext, DEFAULT_BUDGET_BYTES, ["dataSources"]);

    expect(result.truncation.paginationTruncatedResources).toEqual(["dataSources"]);
  });
});

/**
 * HEL-907 tasks.md 5.2 — the direct proof this task is done: a 25-source/
 * 43-pipeline fixture (each pipeline carrying one Output) stays comfortably
 * under `DEFAULT_BUDGET_BYTES` with `truncation.applied: false` and
 * `structuralFloorExceedsBudget: false` — the 220k-char overflow this task
 * exists to fix (HEL-857) was caused by DataType/Metric enumeration that no
 * longer exists in this endpoint's target model (design.md Decision 6).
 */
describe("buildWorkspaceContext — 25-source/43-pipeline fixture (HEL-857/HEL-907 tasks.md 5.2)", () => {
  it("stays under DEFAULT_BUDGET_BYTES without truncation", async () => {
    const sources: DataSourceResponse[] = Array.from({ length: 25 }, (_, i) => ({
      id: `src-${i}`,
      name: `Source ${i}`,
      type: "csv",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
      inferredSchema: {
        fields: Array.from({ length: 10 }, (_, f) => ({
          name: `field${f}`,
          displayName: `Field ${f}`,
          dataType: "string",
          nullable: false,
        })),
      },
    }));

    const pipelines: PipelineSummaryResponse[] = Array.from({ length: 43 }, (_, i) => ({
      id: `pipe-${i}`,
      name: `Pipeline ${i}`,
      sourceDataSourceId: `src-${i % 25}`,
      sourceDataSourceName: `Source ${i % 25}`,
      lastRunStatus: "success",
      lastRunAt: "2026-01-02T00:00:00Z",
      lastRunRowCount: 100,
    }));

    const outputs: OutputResponse[] = pipelines.map((p, i) => ({
      id: `out-${i}`,
      pipelineId: p.id,
      nodeStepId: undefined,
      ownerId: "owner-1",
      name: `Output ${i}`,
      kind: "table",
      config: {},
      schema: Array.from({ length: 10 }, (_, f) => ({ name: `field${f}`, type: "string" })),
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    }));

    const analyzeByPipeline = new Map<string, PipelineAnalyzeResponse>(
      pipelines.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          sourceDataSourceName: p.sourceDataSourceName,
          sourceSchema: [],
          steps: [
            {
              id: `${p.id}-step-1`,
              position: 0,
              type: "filter",
              config: {},
              inputSchema: [],
              outputSchema: Array.from({ length: 10 }, (_, f) => ({
                name: `field${f}`,
                type: "string",
              })),
              validationError: null,
            },
          ],
        },
      ]),
    );

    const outputsByPipeline = new Map<string, OutputResponse[]>();
    for (const o of outputs) {
      const existing = outputsByPipeline.get(o.pipelineId) ?? [];
      existing.push(o);
      outputsByPipeline.set(o.pipelineId, existing);
    }

    const fake = {
      listDataSources: async () => page(sources),
      listDashboards: async () => emptyPage(),
      listPipelines: async () => pipelines,
      listPipelineShapes: async () => [] as PipelineShapeCatalogEntryResponse[],
      analyzePipeline: async (id: string) => {
        const found = analyzeByPipeline.get(id);
        if (!found) throw new Error(`no fixture analyze for ${id}`);
        return found;
      },
      getPipelineRunHistory: async () => [] as PipelineRunRecordResponse[],
      listAllOutputs: async (limit: number, offset: number) => {
        const slice = outputs.slice(offset, offset + limit);
        return { items: slice, total: outputs.length, offset, limit } as OutputsResponse &
          Paged<OutputResponse>;
      },
      listOutputPanels: async () => [] as OutputPanelPlacementResponse[],
      getAgentPreferences: async () => ({ extras: {} }),
      listAgentMemory: async () => [] as AgentMemoryEntryResponse[],
      listConnectorInstances: async () => [],
    };

    const context = await buildWorkspaceContext(fake as unknown as HelioApi);

    expect(context.counts).toEqual({ dataSources: 25, pipelines: 43, dashboards: 0 });
    expect(context.pipelines).toHaveLength(43);
    expect(context.pipelines.every((p) => p.outputs.length === 1)).toBe(true);
    expect(context.truncation.applied).toBe(false);
    expect(context.truncation.structuralFloorExceedsBudget).toBe(false);
    expect(context.truncation.estimatedSizeBytes).toBeLessThan(DEFAULT_BUDGET_BYTES);
  });
});
