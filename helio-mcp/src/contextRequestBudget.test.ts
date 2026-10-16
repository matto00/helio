/**
 * HEL-1619: `buildWorkspaceContext` request volume + concurrency on a 55-pipeline workspace, and
 * the byte-identical-payload guarantee against goldens captured from the PRE-change code.
 *
 * Everything runs through the real `HelioHttpClient` + `HelioApi` against `createFixture`'s
 * counting fake backend, so the numbers are real HTTP request counts, not call-count proxies.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildWorkspaceContext } from "./context.js";
import {
  ANALYZE_FAILS_INDEX,
  createFixture,
  MISSING_PIPELINE_INDEX,
  OUTPUTS_PER_PIPELINE,
  PIPELINE_COUNT,
  stripGeneratedAt,
} from "./contextBudgetFixture.js";

const golden = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "__golden__", name), "utf8"));

const BIG_BUDGET = 50_000_000;
/** 19 of the fixture's 110 Outputs have a panel; they sit on one dashboard. */
const PLACED_OUTPUTS = 19;
const DISTINCT_DASHBOARDS = 1;
/** data-sources, dashboards, pipelines, pipeline-shapes, preferences, agent-memory, connectors, one outputs page. */
const FIXED_REQUESTS = 8;
const RATE_LIMIT = 120;
/** The documented in-flight cap (context.ts `MAX_IN_FLIGHT`). */
const MAX_IN_FLIGHT = 6;

async function run(
  opts: Parameters<typeof createFixture>[0],
  concise = false,
  budget = BIG_BUDGET,
) {
  const fx = createFixture(opts);
  const ctx = await buildWorkspaceContext(fx.api, budget, concise);
  return { fx, ctx, stats: fx.stats() };
}

describe("get_workspace_context request budget (HEL-1619)", () => {
  it("sends exactly 84 requests on the 55-pipeline fixture when the batched read exists, within the 120/60s limit", async () => {
    const { stats } = await run({ contextDetails: "serve" });
    // 8 fixed + 1 context-details + 55 analyze + 19 placements + 1 dashboard snapshot
    expect(stats.total).toBe(
      FIXED_REQUESTS + 1 + PIPELINE_COUNT + PLACED_OUTPUTS + DISTINCT_DASHBOARDS,
    );
    expect(stats.total).toBe(84);
    expect(stats.total).toBeLessThanOrEqual(RATE_LIMIT);
  });

  it("sends no per-pipeline /steps, /run-history or pipeline-summary request, and one placements request per PLACED Output only", async () => {
    const { stats } = await run({ contextDetails: "serve" });
    expect(stats.paths.filter((p) => /\/steps$/.test(p))).toEqual([]);
    expect(stats.paths.filter((p) => /\/run-history$/.test(p))).toEqual([]);
    expect(stats.paths.filter((p) => /^\/api\/pipelines\/p-\d+$/.test(p))).toEqual([]);
    expect(stats.byRoute["/api/outputs/:id/panels"]).toBe(PLACED_OUTPUTS);
    expect(stats.byRoute["/api/pipelines/:id/analyze"]).toBe(PIPELINE_COUNT);
    expect(stats.byRoute["/api/pipelines/context-details"]).toBe(1);
  });

  it("older server (404): falls back per pipeline and costs 194 requests -- still fewer than the 339 of the pre-change code", async () => {
    const { stats } = await run({ contextDetails: "404" });
    // 8 + 1 (the 404) + 55 analyze + 55 run-history + 55 steps + 19 placements + 1 snapshot
    expect(stats.total).toBe(194);
    expect(stats.total).toBeGreaterThan(RATE_LIMIT);
    expect(stats.byRoute["/api/pipelines/:id/steps"]).toBe(PIPELINE_COUNT);
    expect(stats.byRoute["/api/pipelines/:id"]).toBeUndefined();
  });

  it("the OUTPUTS_PER_PIPELINE x PIPELINE_COUNT fixture really has 110 Outputs (premise: 339 on the unfixed code)", () => {
    expect(OUTPUTS_PER_PIPELINE * PIPELINE_COUNT).toBe(110);
  });

  it("never has more than MAX_IN_FLIGHT requests in flight, fixed fetches included", async () => {
    const { stats } = await run({ contextDetails: "serve", delayMs: 5 });
    expect(stats.peakInFlight).toBeLessThanOrEqual(MAX_IN_FLIGHT);
    expect(stats.peakInFlight).toBeGreaterThan(1);
    const fallback = await run({ contextDetails: "404", delayMs: 5 });
    expect(fallback.stats.peakInFlight).toBeLessThanOrEqual(MAX_IN_FLIGHT);
  });

  it("sends no placements request for an Output reporting panelCount 0, but still asks when panelCount is absent", async () => {
    const present = await run({ contextDetails: "serve" });
    expect(present.stats.byRoute["/api/outputs/:id/panels"]).toBe(PLACED_OUTPUTS);
    const absent = await run({ contextDetails: "serve", omitPanelCount: true });
    expect(absent.stats.byRoute["/api/outputs/:id/panels"]).toBe(
      OUTPUTS_PER_PIPELINE * PIPELINE_COUNT,
    );
    // identical payload either way
    expect(stripGeneratedAt(absent.ctx)).toEqual(stripGeneratedAt(present.ctx));
  });
});

describe("get_workspace_context payload is byte-identical to the pre-change golden (HEL-1619, C1)", () => {
  const paths: Array<[string, Parameters<typeof createFixture>[0]]> = [
    ["batched read", { contextDetails: "serve" }],
    ["404 fallback", { contextDetails: "404" }],
    ["500 fallback", { contextDetails: "500" }],
    ["batched read missing one pipeline", { contextDetails: "missing-one" }],
    ["batched read, panelCount absent", { contextDetails: "serve", omitPanelCount: true }],
  ];
  for (const [label, opts] of paths) {
    // Compact serialization on both sides: key order and every value must match (the golden file itself is
    // pretty-printed, and may be re-formatted, so the comparison is on JSON.stringify, not file text).
    it(`full mode, ${label}`, async () => {
      const { ctx } = await run(opts, false);
      expect(JSON.stringify(stripGeneratedAt(ctx))).toBe(
        JSON.stringify(golden("workspaceContext.full.json")),
      );
    });
    it(`concise mode, ${label}`, async () => {
      const { ctx } = await run(opts, true);
      expect(JSON.stringify(stripGeneratedAt(ctx))).toBe(
        JSON.stringify(golden("workspaceContext.concise.json")),
      );
    });
  }

  it("the golden exercises the cases the proof needs", () => {
    const g = golden("workspaceContext.full.json") as {
      pipelines: Array<{
        id: string;
        stepsError?: string;
        laneTree: Array<{ parentId: string | null; rootId: string }>;
        lastRunAssertions: { failures: unknown[] };
        lastRunStatus: string | null;
        outputs: Array<{ placements: Array<{ controls: unknown[] }> }>;
      }>;
    };
    expect(g.pipelines).toHaveLength(PIPELINE_COUNT);
    expect(g.pipelines[ANALYZE_FAILS_INDEX]!.stepsError).toBeDefined();
    expect(g.pipelines.some((p) => p.lastRunAssertions.failures.length >= 2)).toBe(true);
    expect(g.pipelines.some((p) => p.lastRunStatus === null)).toBe(true);
    expect(g.pipelines.some((p) => new Set(p.laneTree.map((n) => n.rootId)).size >= 2)).toBe(true);
    expect(g.pipelines.some((p) => p.laneTree.some((n) => n.parentId !== null))).toBe(true);
    const placements = g.pipelines.flatMap((p) => p.outputs.flatMap((o) => o.placements));
    expect(placements.some((pl) => pl.controls.length > 0)).toBe(true);
    expect(g.pipelines.some((p) => p.outputs.some((o) => o.placements.length === 0))).toBe(true);
  });
});

describe("get_workspace_context fallback visibility (HEL-1619 D10)", () => {
  let writes: string[];
  let spy: jest.SpyInstance;
  beforeEach(() => {
    writes = [];
    spy = jest.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as never);
  });
  afterEach(() => spy.mockRestore());

  it("warns once on stderr when the batched read fails with a non-404 error", async () => {
    await run({ contextDetails: "500" });
    const lines = writes.filter((w) => w.includes("context-details"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^helio-mcp: .*context-details.*\n$/);
  });

  it("does not warn on a 404 (older server)", async () => {
    await run({ contextDetails: "404" });
    expect(writes.filter((w) => w.includes("context-details"))).toEqual([]);
  });

  it("warns when the response omits pipelines, and fetches exactly the missing one per pipeline", async () => {
    const { stats } = await run({ contextDetails: "missing-one" });
    expect(writes.filter((w) => w.includes("context-details"))).toHaveLength(1);
    expect(stats.byRoute["/api/pipelines/:id/steps"]).toBe(1);
    expect(stats.byRoute["/api/pipelines/:id/run-history"]).toBe(1);
    expect(stats.paths).toContain(`/api/pipelines/p-${MISSING_PIPELINE_INDEX}/steps`);
  });

  it("treats a malformed (wrong envelope key) body as a failure, falls back, and warns", async () => {
    const { stats } = await run({
      contextDetails: "serve",
      contextDetailsBody: (items) => ({ results: items }),
    });
    expect(writes.filter((w) => w.includes("context-details"))).toHaveLength(1);
    expect(stats.byRoute["/api/pipelines/:id/steps"]).toBe(PIPELINE_COUNT);
  });
});
