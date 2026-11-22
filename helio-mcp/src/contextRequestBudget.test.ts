/**
 * HEL-1619 / HEL-1625: `buildWorkspaceContext` request volume + concurrency on a 55-pipeline workspace, and
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
/** Pipelines absent from the analyze batch: the fake omits only `ANALYZE_FAILS_INDEX` (a failed analysis). */
const ABSENT_FROM_ANALYZE_BATCH = 1;
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

describe("get_workspace_context request budget (HEL-1619, HEL-1625)", () => {
  it("sends exactly 8 + 2 + Op + D + A = 31 requests on the 55-pipeline fixture when both batched reads exist", async () => {
    const { stats } = await run({ contextDetails: "serve", contextAnalyze: "serve" });
    // 8 fixed + context-details + context-analyze + 19 placements + 1 dashboard snapshot + 1 absent-pipeline analyze
    expect(stats.total).toBe(
      FIXED_REQUESTS + 2 + PLACED_OUTPUTS + DISTINCT_DASHBOARDS + ABSENT_FROM_ANALYZE_BATCH,
    );
    expect(stats.total).toBe(31);
    expect(stats.total).toBeLessThanOrEqual(RATE_LIMIT);
  });

  it("sends no per-pipeline /steps, /run-history or pipeline-summary request, and one placements request per PLACED Output only", async () => {
    const { stats } = await run({ contextDetails: "serve" });
    expect(stats.paths.filter((p) => /\/steps$/.test(p))).toEqual([]);
    expect(stats.paths.filter((p) => /\/run-history$/.test(p))).toEqual([]);
    expect(stats.paths.filter((p) => /^\/api\/pipelines\/p-\d+$/.test(p))).toEqual([]);
    expect(stats.byRoute["/api/outputs/:id/panels"]).toBe(PLACED_OUTPUTS);
    expect(stats.byRoute["/api/pipelines/context-details"]).toBe(1);
    expect(stats.byRoute["/api/pipelines/context-analyze"]).toBe(1);
  });

  it("sends an analyze request only for the pipeline absent from the batch", async () => {
    const { stats } = await run({ contextDetails: "serve", contextAnalyze: "serve" });
    expect(stats.byRoute["/api/pipelines/:id/analyze"]).toBe(ABSENT_FROM_ANALYZE_BATCH);
    expect(stats.paths.filter((p) => /\/analyze$/.test(p))).toEqual([
      `/api/pipelines/p-${ANALYZE_FAILS_INDEX}/analyze`,
    ]);
  });

  it("analyze batch answering 404: one more request than the HEL-1619 count of 84, one analyze per pipeline", async () => {
    const { stats } = await run({ contextDetails: "serve", contextAnalyze: "404" });
    expect(stats.total).toBe(85);
    expect(stats.byRoute["/api/pipelines/:id/analyze"]).toBe(PIPELINE_COUNT);
  });

  it("is constant in P: 55 and 200 pipelines with the same placed Outputs, dashboards and absent pipelines send the same count", async () => {
    const small = await run({ placedBelow: PIPELINE_COUNT });
    const large = await run({ pipelines: 200, placedBelow: PIPELINE_COUNT });
    expect(large.stats.total).toBe(small.stats.total);
    expect(large.stats.total).toBe(31);
    // no analyze request for any pipeline the batch returned
    expect(large.stats.paths.filter((p) => /\/analyze$/.test(p))).toEqual([
      `/api/pipelines/p-${ANALYZE_FAILS_INDEX}/analyze`,
    ]);
  });

  it("200 pipelines (natural placements) send fewer than 120 requests; the same fixture without the analyze batch sends more", async () => {
    const batched = await run({ pipelines: 200 });
    expect(batched.stats.total).toBeLessThan(RATE_LIMIT);
    const preChange = await run({ pipelines: 200, contextAnalyze: "404" });
    expect(preChange.stats.total).toBeGreaterThan(RATE_LIMIT);
  });

  it("details 404 (older server) with the analyze batch served: falls back for steps and run-history only", async () => {
    const { stats } = await run({ contextDetails: "404", contextAnalyze: "serve" });
    // 8 + 1 (details 404) + 1 (analyze batch) + 1 absent analyze + 55 steps + 55 run-history + 19 placements + 1 snapshot
    expect(stats.total).toBe(141);
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
    const fallback = await run({ contextDetails: "404", contextAnalyze: "404", delayMs: 5 });
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
    // HEL-1625: every mode of the analyze batch yields the same golden
    ["analyze batch 404", { contextAnalyze: "404" }],
    ["analyze batch 500", { contextAnalyze: "500" }],
    ["analyze batch missing one pipeline", { contextAnalyze: "missing-one" }],
    ["analyze batch malformed", { contextAnalyze: "malformed" }],
    ["both batched reads 404", { contextDetails: "404", contextAnalyze: "404" }],
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

describe("get_workspace_context analyze-batch fallback (HEL-1625 D7)", () => {
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
  const lines = () => writes.filter((w) => w.includes("context-analyze"));

  it("serve: exactly one stderr line (the pipeline whose analysis failed is absent), 'omitted 1 of 55'", async () => {
    await run({ contextAnalyze: "serve" });
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatch(/^helio-mcp: .*context-analyze.*omitted 1 of 55.*\n$/);
  });

  it("404: no stderr line, one analyze per pipeline", async () => {
    const { stats } = await run({ contextAnalyze: "404" });
    expect(lines()).toEqual([]);
    expect(stats.byRoute["/api/pipelines/:id/analyze"]).toBe(PIPELINE_COUNT);
  });

  it("500: one stderr line, one analyze per pipeline", async () => {
    const { stats } = await run({ contextAnalyze: "500" });
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatch(/^helio-mcp: .*context-analyze.*\n$/);
    expect(stats.byRoute["/api/pipelines/:id/analyze"]).toBe(PIPELINE_COUNT);
  });

  it("malformed body (no items array): one stderr line, one analyze per pipeline", async () => {
    const { stats } = await run({ contextAnalyze: "malformed" });
    expect(lines()).toHaveLength(1);
    expect(stats.byRoute["/api/pipelines/:id/analyze"]).toBe(PIPELINE_COUNT);
  });

  it("missing-one: one stderr line 'omitted 2 of 55'; exactly the two absent pipelines are analyzed per pipeline", async () => {
    const { stats } = await run({ contextAnalyze: "missing-one" });
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toMatch(/omitted 2 of 55/);
    expect(stats.paths.filter((p) => /\/analyze$/.test(p)).sort()).toEqual(
      [
        `/api/pipelines/p-${ANALYZE_FAILS_INDEX}/analyze`,
        `/api/pipelines/p-${MISSING_PIPELINE_INDEX}/analyze`,
      ].sort(),
    );
  });
});
