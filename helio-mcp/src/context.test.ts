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
    roots: [{ id: "root-1", dataSourceId: "src-1", dataSourceName: "Orders" }],
    lastRunStatus: "success",
    lastRunAt: "2026-01-02T00:00:00Z",
    lastRunRowCount: 10,
  };

  const analyzeResponse: PipelineAnalyzeResponse = {
    id: "pipe-1",
    name: "Orders Pipeline",
    sourceSchemas: [{ rootId: "root-1", dataSourceName: "Orders", sourceSchema: [] }],
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
        rootId: null,
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

  // HEL-913 task 9.9/R12: a root-bound Output's rootId must be threaded through, never dropped
  // -- nodeStepId: null alone (the previous test) does not say WHICH root under multi-root.
  it("reports the real rootId (not null) for a root-bound Output on a named root", async () => {
    const rootBoundOutput: OutputResponse = {
      ...output,
      id: "out-3",
      nodeStepId: undefined,
      rootId: "root-42",
    };
    const context = await buildWorkspaceContext(
      fakeApiWithPipeline({
        listAllOutputs: async () => page([rootBoundOutput]),
      }) as unknown as HelioApi,
    );

    expect(context.pipelines[0]?.outputs[0]?.nodeStepId).toBeNull();
    expect(context.pipelines[0]?.outputs[0]?.rootId).toBe("root-42");
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

  // HEL-914 task 6.6: the compact lane tree.
  it("reports laneTree with id/parentId/rootId/op/outputIds per node", async () => {
    const context = await buildWorkspaceContext(
      fakeApiWithPipeline({
        getPipeline: async () => ({
          ...summary,
          steps: [
            { id: "step-0", type: "select", position: 0, config: {}, rootId: "root-1" },
            {
              id: "step-1",
              type: "rename",
              position: 0,
              config: {},
              parentStepId: "step-0",
              rootId: "root-1",
            },
          ],
        }),
      }) as unknown as HelioApi,
    );

    expect(context.pipelines[0]?.laneTree).toEqual([
      { id: "step-0", parentId: null, rootId: "root-1", op: "select", outputIds: [] },
      { id: "step-1", parentId: "step-0", rootId: "root-1", op: "rename", outputIds: ["out-1"] },
    ]);
  });

  it("degrades laneTree to [] (without affecting steps/outputs) when getPipeline fails", async () => {
    const context = await buildWorkspaceContext(
      fakeApiWithPipeline({
        getPipeline: async () => {
          throw new Error("boom");
        },
      }) as unknown as HelioApi,
    );

    expect(context.pipelines[0]?.laneTree).toEqual([]);
    expect(context.pipelines[0]?.stepsError).toBeUndefined();
    expect(context.pipelines[0]?.outputs).toHaveLength(1);
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
        rootId: null,
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
      omittedDetailKinds: [],
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
 * HEL-865 tasks.md 6.1: promoted from the throwaway measurement probe
 * (`hel865Fidelity.probe.test.ts`, deleted by this change) into the permanent
 * realistic-fidelity fixture — ~60 columns/source, ~7 steps/pipeline,
 * populated `laneTree`, Output schemas and placements, 36-char UUID ids.
 * Supersedes the prior 25/43 fixture here, which measured a shape (10
 * cols/source, 1 step/pipeline, empty `laneTree`) no live workspace returns
 * (design.md D1) and so could not prove the fix it certified.
 */
function uuid(prefix: string, n: number): string {
  const h = (n + 1).toString(16).padStart(12, "0");
  return `${prefix.slice(0, 8).padEnd(8, "a")}-${h.slice(0, 4)}-4${h.slice(4, 7)}-8${h.slice(7, 10)}-${h}`;
}

const REALISTIC_COLUMN_NAMES = [
  "player_id",
  "player_full_name",
  "team_abbreviation",
  "opponent_abbreviation",
  "game_week",
  "season_year",
  "position_primary",
  "position_secondary",
  "snap_count_offense",
  "snap_share_pct",
  "targets_total",
  "receptions_total",
  "receiving_yards",
  "receiving_touchdowns",
  "air_yards_total",
  "yards_after_catch",
  "rushing_attempts",
  "rushing_yards",
  "rushing_touchdowns",
  "fumbles_lost",
  "passing_attempts",
  "passing_completions",
  "passing_yards",
  "passing_touchdowns",
  "interceptions_thrown",
  "sacks_taken",
  "red_zone_targets",
  "red_zone_carries",
  "goal_line_carries",
  "two_point_conversions",
  "fantasy_points_ppr",
  "fantasy_points_standard",
  "fantasy_points_half_ppr",
  "projected_points_ppr",
  "projection_source_name",
  "ownership_percentage",
  "start_percentage",
  "roster_status_label",
  "injury_status_code",
  "injury_body_part",
  "practice_participation",
  "depth_chart_order",
  "opponent_defense_rank",
  "opponent_points_allowed",
  "home_or_away_flag",
  "game_kickoff_timestamp",
  "weather_temperature_f",
  "weather_wind_mph",
  "weather_precipitation",
  "stadium_surface_type",
  "vegas_implied_team_total",
  "vegas_spread_value",
  "vegas_over_under",
  "team_pace_seconds_per_play",
  "team_pass_rate_over_expected",
  "coordinator_scheme_label",
  "last_updated_timestamp",
  "ingest_batch_identifier",
  "source_record_checksum",
  "data_quality_flag",
]; // 60 realistic column names -- see design.md "measurement that motivates every decision"
const REALISTIC_TYPES = ["string", "number", "boolean", "timestamp"];

function realisticSchemaFields(
  count: number,
): Array<{ name: string; displayName: string; dataType: string; nullable: boolean }> {
  return Array.from({ length: count }, (_, i) => {
    const name =
      REALISTIC_COLUMN_NAMES[i % REALISTIC_COLUMN_NAMES.length] +
      (i >= REALISTIC_COLUMN_NAMES.length ? `_${i}` : "");
    return {
      name,
      displayName: name.replace(/_/g, " "),
      dataType: REALISTIC_TYPES[i % REALISTIC_TYPES.length]!,
      nullable: i % 3 === 0,
    };
  });
}
function realisticOutSchema(count: number): Array<{ name: string; type: string }> {
  return realisticSchemaFields(count).map((f) => ({ name: f.name, type: f.dataType }));
}

const REALISTIC_SOURCES = 25;
const REALISTIC_PIPELINES = 43;
const REALISTIC_COLS_PER_SOURCE = 60; // field report's ~60-column source
const REALISTIC_STEPS_PER_PIPELINE = 7; // field report / realistic authored pipeline depth
const REALISTIC_OP_KINDS = [
  "filter",
  "aggregate",
  "join",
  "computed_field",
  "sort",
  "limit",
  "cast",
];
/** Step output widths narrow down the pipeline (filter keeps all 60, aggregate/project narrow). */
const REALISTIC_STEP_WIDTHS = [60, 60, 44, 32, 24, 18, 12];

interface RealisticFixture {
  sources: DataSourceResponse[];
  pipelines: PipelineSummaryResponse[];
  outputs: OutputResponse[];
  steps: Map<
    string,
    Array<{
      id: string;
      type: string;
      position: number;
      parentStepId: string | null;
      rootId: string;
    }>
  >;
  analyze: Map<string, PipelineAnalyzeResponse>;
  placements: Map<string, OutputPanelPlacementResponse[]>;
}

/** Builds the 25-source/43-pipeline realistic-fidelity fixture (design.md's measured 465,036-byte
 *  case). One Output bound to the pipeline's LAST step per pipeline (so `laneTree`'s `outputIds`
 *  populate), one placement per Output, a real `getPipeline` (unlike the old thin fixture's fake,
 *  which lacked one and silently degraded `laneTree` to `[]` -- HEL-865 task 6.9). */
function buildRealisticFixture(): RealisticFixture {
  const sources: DataSourceResponse[] = Array.from({ length: REALISTIC_SOURCES }, (_, i) => ({
    id: uuid("dsrc", i),
    name: `Weekly Fantasy Player Stats — Ingest ${i + 1}`,
    type: "csv",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    tag: "fantasy-football",
    inferredSchema: { fields: realisticSchemaFields(REALISTIC_COLS_PER_SOURCE) },
  }));

  const pipelines: PipelineSummaryResponse[] = Array.from(
    { length: REALISTIC_PIPELINES },
    (_, i) => ({
      id: uuid("pipe", i),
      name: `Top Waiver Wire Targets by Position — Week ${i + 1}`,
      roots: [
        {
          id: uuid("root", i),
          dataSourceId: sources[i % REALISTIC_SOURCES]!.id,
          dataSourceName: sources[i % REALISTIC_SOURCES]!.name,
        },
      ],
      lastRunStatus: "success",
      lastRunAt: "2026-09-02T04:15:33.291Z",
      lastRunRowCount: 1843,
      tag: "fantasy-football",
    }),
  );

  const steps = new Map<
    string,
    Array<{
      id: string;
      type: string;
      position: number;
      parentStepId: string | null;
      rootId: string;
    }>
  >();
  const analyze = new Map<string, PipelineAnalyzeResponse>();
  for (let i = 0; i < REALISTIC_PIPELINES; i++) {
    const p = pipelines[i]!;
    const stepList = Array.from({ length: REALISTIC_STEPS_PER_PIPELINE }, (_, s) => ({
      id: uuid("step", i * 100 + s),
      type: REALISTIC_OP_KINDS[s % REALISTIC_OP_KINDS.length]!,
      position: s,
      parentStepId: s === 0 ? null : uuid("step", i * 100 + s - 1),
      rootId: p.roots[0]!.id,
    }));
    steps.set(p.id, stepList);
    analyze.set(p.id, {
      id: p.id,
      name: p.name,
      sourceSchemas: [
        { rootId: p.roots[0]!.id, dataSourceName: p.roots[0]!.dataSourceName, sourceSchema: [] },
      ],
      steps: stepList.map((s, si) => ({
        id: s.id,
        position: s.position,
        type: s.type,
        config: {},
        inputSchema: [],
        outputSchema: realisticOutSchema(REALISTIC_STEP_WIDTHS[si % REALISTIC_STEP_WIDTHS.length]!),
        validationError: null,
      })),
    });
  }

  const outputs: OutputResponse[] = [];
  const placements = new Map<string, OutputPanelPlacementResponse[]>();
  let oi = 0;
  for (let i = 0; i < REALISTIC_PIPELINES; i++) {
    const p = pipelines[i]!;
    const n = (i % 3) + 1; // 1-3 outputs per pipeline
    const pipelineSteps = steps.get(p.id)!;
    for (let k = 0; k < n; k++) {
      const id = uuid("outp", oi);
      const boundStep = pipelineSteps[REALISTIC_STEPS_PER_PIPELINE - 1 - k] ?? pipelineSteps[0]!;
      outputs.push({
        id,
        pipelineId: p.id,
        nodeStepId: boundStep.id,
        ownerId: uuid("ownr", 0),
        name: `Top 15 Waiver Targets (${REALISTIC_OP_KINDS[k % REALISTIC_OP_KINDS.length]}) ${i + 1}`,
        kind: "table",
        config: {},
        schema: realisticOutSchema(14),
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });
      placements.set(id, [{ dashboardId: uuid("dash", 0), panelId: uuid("panl", oi) }]);
      oi++;
    }
  }
  return { sources, pipelines, outputs, steps, analyze, placements };
}

function realisticFakeApi(f: RealisticFixture): HelioApi {
  return {
    listDataSources: async () => page(f.sources),
    listDashboards: async () => emptyPage(),
    listPipelines: async () => f.pipelines,
    listPipelineShapes: async () => [] as PipelineShapeCatalogEntryResponse[],
    analyzePipeline: async (id: string) => {
      const found = f.analyze.get(id);
      if (!found) throw new Error(`no fixture analyze for ${id}`);
      return found;
    },
    getPipeline: async (id: string) => ({ steps: f.steps.get(id) ?? [] }),
    getPipelineRunHistory: async () => [] as PipelineRunRecordResponse[],
    listAllOutputs: async (limit: number, offset: number) => {
      const slice = f.outputs.slice(offset, offset + limit);
      return { items: slice, total: f.outputs.length, offset, limit } as OutputsResponse &
        Paged<OutputResponse>;
    },
    listOutputPanels: async (id: string) => f.placements.get(id) ?? [],
    getAgentPreferences: async () => ({ extras: {} }),
    listAgentMemory: async () => [] as AgentMemoryEntryResponse[],
    listConnectorInstances: async () => [],
  } as unknown as HelioApi;
}

describe("buildWorkspaceContext — 25-source/43-pipeline realistic fixture (HEL-865)", () => {
  it("full mode exceeds DEFAULT_BUDGET_BYTES on the realistic fixture (the red arm HEL-907's thinner fixture could never fire)", async () => {
    const context = await buildWorkspaceContext(realisticFakeApi(buildRealisticFixture()));

    expect(context.counts).toEqual({
      dataSources: REALISTIC_SOURCES,
      pipelines: REALISTIC_PIPELINES,
      dashboards: 0,
    });
    expect(context.pipelines).toHaveLength(REALISTIC_PIPELINES);
    // task 6.2: converts (not deletes) the old under-budget assertions -- both siblings flip together.
    expect(context.truncation.structuralFloorExceedsBudget).toBe(true);
    expect(context.truncation.estimatedSizeBytes).toBeGreaterThan(DEFAULT_BUDGET_BYTES);
  });

  it("concise mode fits under budget on the SAME fixture -- both directions proven on one fixture (task 6.3)", async () => {
    const fixture = buildRealisticFixture();
    const full = await buildWorkspaceContext(realisticFakeApi(fixture));
    const concise = await buildWorkspaceContext(realisticFakeApi(fixture), undefined, true);

    expect(full.truncation.estimatedSizeBytes).toBeGreaterThan(DEFAULT_BUDGET_BYTES);
    expect(concise.truncation.estimatedSizeBytes).toBeLessThan(DEFAULT_BUDGET_BYTES);
    // design.md D8: record the measured headroom so future work can see it, not just assert < budget.
    expect(concise.truncation.estimatedSizeBytes).toBeGreaterThan(150_000);
  });

  it("concise mode retains every source and every pipeline -- omits depth, never breadth (task 6.4)", async () => {
    const concise = await buildWorkspaceContext(
      realisticFakeApi(buildRealisticFixture()),
      undefined,
      true,
    );

    expect(concise.dataSources).toHaveLength(REALISTIC_SOURCES);
    expect(concise.pipelines).toHaveLength(REALISTIC_PIPELINES);
  });

  it("a step whose full entry lists N columns carries a count of N and no column list in concise mode (task 6.5)", async () => {
    const fixture = buildRealisticFixture();
    const full = await buildWorkspaceContext(realisticFakeApi(fixture));
    const concise = await buildWorkspaceContext(realisticFakeApi(fixture), undefined, true);

    const fullFirstStep = full.pipelines[0]!.steps[0]!;
    const conciseFirstStep = concise.pipelines[0]!.steps[0]!;
    expect(fullFirstStep.outputColumns).toHaveLength(REALISTIC_STEP_WIDTHS[0]!);
    expect(conciseFirstStep.outputColumnCount).toBe(REALISTIC_STEP_WIDTHS[0]!);
    expect(conciseFirstStep).not.toHaveProperty("outputColumns");
  });

  it("every Output's schema survives concise mode intact (task 6.5)", async () => {
    const fixture = buildRealisticFixture();
    const full = await buildWorkspaceContext(realisticFakeApi(fixture));
    const concise = await buildWorkspaceContext(realisticFakeApi(fixture), undefined, true);

    for (let i = 0; i < full.pipelines.length; i++) {
      expect(concise.pipelines[i]!.outputs).toEqual(full.pipelines[i]!.outputs);
    }
  });

  it("also omits per-source inferredSchema by field count in concise mode", async () => {
    const fixture = buildRealisticFixture();
    const full = await buildWorkspaceContext(realisticFakeApi(fixture));
    const concise = await buildWorkspaceContext(realisticFakeApi(fixture), undefined, true);

    expect(full.dataSources[0]!.inferredSchema).toHaveLength(REALISTIC_COLS_PER_SOURCE);
    expect(concise.dataSources[0]!.inferredSchemaFieldCount).toBe(REALISTIC_COLS_PER_SOURCE);
    expect(concise.dataSources[0]).not.toHaveProperty("inferredSchema");
  });

  it("truncation.applied is true with a populated omission enumeration in concise mode, false with an empty one in full mode (task 6.7)", async () => {
    const fixture = buildRealisticFixture();
    const full = await buildWorkspaceContext(realisticFakeApi(fixture));
    const concise = await buildWorkspaceContext(realisticFakeApi(fixture), undefined, true);

    expect(full.truncation.applied).toBe(false);
    expect(full.truncation.omittedDetailKinds).toEqual([]);
    expect(concise.truncation.applied).toBe(true);
    expect(concise.truncation.omittedDetailKinds.length).toBeGreaterThan(0);
  });

  it("the default response (concise absent) is byte-identical to the explicit full-mode response (task 6.6)", async () => {
    const fixture = buildRealisticFixture();
    const withDefaultArgs = await buildWorkspaceContext(realisticFakeApi(fixture));
    const withExplicitFalse = await buildWorkspaceContext(
      realisticFakeApi(buildRealisticFixture()),
      DEFAULT_BUDGET_BYTES,
      false,
    );

    // generatedAt is a live timestamp -- the only field this call is expected to vary; every other
    // field, including every array's length and every nested key, must match exactly.
    const strip = (c: WorkspaceContext) => ({ ...c, generatedAt: "" });
    expect(strip(withDefaultArgs)).toEqual(strip(withExplicitFalse));
    expect(withDefaultArgs.dataSources[0]).not.toHaveProperty("inferredSchemaFieldCount");
    expect(withDefaultArgs.pipelines[0]!.steps[0]).not.toHaveProperty("outputColumnCount");
  });
});
