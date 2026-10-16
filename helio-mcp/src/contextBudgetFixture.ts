/**
 * HEL-1619: a 55-pipeline fake Helio backend for `buildWorkspaceContext` request-budget tests.
 *
 * Served through a counting `fetch` so the REAL `HelioHttpClient` + `HelioApi` are exercised and
 * every HTTP request is counted (total, peak in flight, per normalized route). The same fixture
 * produced the committed golden (`__golden__/`) from the PRE-change `buildWorkspaceContext`, so it
 * must keep serving only routes the pre-change code knows, plus the new
 * `GET /api/pipelines/context-details` (answered per `contextDetails` mode).
 *
 * Coverage: branched / multi-root steps, runs with >= 2 assertion failures, a never-run pipeline,
 * a zero-step pipeline, an analyze failure (stepsError), Outputs with and without panels, and
 * panel controls.
 */

import { HelioApi } from "./helioApi.js";
import { HelioHttpClient } from "./httpClient.js";
import type { HelioConfig } from "./config.js";

export type ContextDetailsMode =
  /** serve the batched read for every pipeline */
  | "serve"
  /** older server: the route does not exist */
  | "404"
  /** the route fails with a non-404 status */
  | "500"
  /** serve it but omit the pipeline at index `MISSING_PIPELINE_INDEX` */
  | "missing-one";

export const MISSING_PIPELINE_INDEX = 12;
export const NEVER_RUN_INDEX = 4;
export const ZERO_STEP_INDEX = 9;
export const ANALYZE_FAILS_INDEX = 6;
export const PIPELINE_COUNT = 55;
export const OUTPUTS_PER_PIPELINE = 2;
export const DASHBOARD_ID = "d-1";

const pid = (i: number): string => `p-${i}`;
const branched = (i: number): boolean => i % 5 === 0;
/** Output j=0 of every third pipeline is placed on the one dashboard. */
const placed = (i: number, j: number): boolean => j === 0 && i % 3 === 0;
const outputId = (i: number, j: number): string => `o-${i * 10 + j}`;

interface FixtureStep {
  id: string;
  type: string;
  position: number;
  config: Record<string, unknown>;
  parentStepId?: string;
  /** Only parentless (root-level) steps carry a root id: V98's CHECK `(parent_step_id IS NULL) =
   *  (root_id IS NOT NULL)`, so `GET /steps` omits it for every child step. */
  rootId?: string;
}

function shapedSteps(i: number): FixtureStep[] {
  if (i === ZERO_STEP_INDEX) return [];
  if (branched(i)) {
    // two roots; root a has a trunk step with two children (a branch), root b a single step
    return [
      { id: `s-${i}-1`, type: "filter", position: 0, config: { f: 1 }, rootId: `r-${i}-a` },
      {
        id: `s-${i}-2`,
        type: "sort",
        position: 1,
        config: {},
        parentStepId: `s-${i}-1`,
      },
      {
        id: `s-${i}-3`,
        type: "group",
        position: 1,
        config: {},
        parentStepId: `s-${i}-1`,
      },
      { id: `s-${i}-4`, type: "limit", position: 0, config: {}, rootId: `r-${i}-b` },
    ];
  }
  return [
    { id: `s-${i}-1`, type: "filter", position: 0, config: {}, rootId: `r-${i}-a` },
    {
      id: `s-${i}-2`,
      type: "sort",
      position: 1,
      config: {},
      parentStepId: `s-${i}-1`,
    },
  ];
}

/** `GET /api/pipelines/:id/steps` elements as the backend serializes them (HEL-1619 seam: the schema
 *  requires the whole wire shape, not just the fields the context serializer reads). */
function stepsFor(i: number) {
  return shapedSteps(i).map((s) => ({
    pipelineId: pid(i),
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    enabled: true,
    ...s,
  }));
}

function failure(kind: string, field: string, severity: string, message: string) {
  return { kind, field, severity, message };
}

/** Newest-first run history. Pipeline `NEVER_RUN_INDEX` has none; `i % 4 === 1` has a newer run
 *  with two failures (and an older one with one); the rest are clean. */
function historyFor(i: number) {
  if (i === NEVER_RUN_INDEX) return [];
  const base = (n: number, assertions: unknown) => ({
    id: `run-${i}-${n}`,
    pipelineId: pid(i),
    status: "succeeded",
    startedAt: `2026-10-0${n === 0 ? 2 : 1}T10:00:00Z`,
    completedAt: `2026-10-0${n === 0 ? 2 : 1}T10:00:05Z`,
    rowCount: 10,
    assertions,
  });
  if (i % 4 === 1) {
    return [
      base(0, {
        passed: 3,
        warnFailed: 1,
        errorFailed: 1,
        failures: [
          failure("not_null", "amount", "error", "amount is null in 4 rows"),
          failure("range", "score", "warn", "score above 100"),
        ],
      }),
      base(1, {
        passed: 4,
        warnFailed: 0,
        errorFailed: 1,
        failures: [failure("unique", "id", "error", "duplicate ids")],
      }),
    ];
  }
  return [
    base(0, { passed: 2, warnFailed: 0, errorFailed: 0, failures: [] }),
    base(1, { passed: 2, warnFailed: 0, errorFailed: 0, failures: [] }),
  ];
}

export interface RequestStats {
  total: number;
  peakInFlight: number;
  byRoute: Record<string, number>;
  /** every request path, in send order */
  paths: string[];
}

export interface Fixture {
  api: HelioApi;
  fetchImpl: (url: string) => Promise<Response>;
  stats: () => RequestStats;
  /** stderr lines the HelioHttpClient/context warned */
  warnings: string[];
}

function json(status: number, body: unknown): Response {
  return {
    status,
    statusText: status === 200 ? "OK" : String(status),
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

const normalize = (p: string): string => p.replace(/\/(p|o|d|s|r)-[0-9a-z-]+/g, "/:id");

/** `contextDetailsBody` lets a test replace the served `context-details` body (e.g. a mutated key). */
export function createFixture(
  opts: {
    contextDetails?: ContextDetailsMode;
    omitPanelCount?: boolean;
    delayMs?: number;
    contextDetailsBody?: (items: unknown[]) => unknown;
    pipelines?: number;
  } = {},
): Fixture {
  const mode: ContextDetailsMode = opts.contextDetails ?? "serve";
  const delayMs = opts.delayMs ?? 1;
  const P = opts.pipelines ?? PIPELINE_COUNT;
  const pipelines = Array.from({ length: P }, (_, i) => ({
    id: pid(i),
    name: `Pipeline ${i}`,
    roots: branched(i)
      ? [
          { id: `r-${i}-a`, sourceId: `src-${i % 5}`, name: "a" },
          { id: `r-${i}-b`, sourceId: `src-${(i + 1) % 5}`, name: "b" },
        ]
      : [{ id: `r-${i}-a`, sourceId: `src-${i % 5}`, name: "a" }],
    lastRunStatus: i === NEVER_RUN_INDEX ? null : "succeeded",
    lastRunAt: i === NEVER_RUN_INDEX ? null : "2026-10-02T10:00:05Z",
    lastRunRowCount: i === NEVER_RUN_INDEX ? null : 10,
    ...(i % 7 === 0 ? { tag: "demo" } : {}),
  }));
  const outputs = pipelines.flatMap((p, i) =>
    Array.from({ length: OUTPUTS_PER_PIPELINE }, (_, j) => {
      const hasStep = j === 1 && stepsFor(i).length > 0;
      return {
        id: outputId(i, j),
        pipelineId: p.id,
        ownerId: "u-1",
        name: `Out ${i}.${j}`,
        kind: j === 0 ? "table" : "metric",
        config: {},
        schema: [
          { name: "amount", type: "number" },
          { name: "label", type: "string" },
        ],
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z",
        ...(hasStep ? { nodeStepId: `s-${i}-2` } : { rootId: `r-${i}-a` }),
        ...(opts.omitPanelCount ? {} : { panelCount: placed(i, j) ? 1 : 0 }),
      };
    }),
  );
  const snapshotPanels = pipelines
    .map((_, i) => i)
    .filter((i) => placed(i, 0))
    .map((i) => ({
      snapshotId: `snap-${i}`,
      id: `x-${i}`,
      title: `Panel ${i}`,
      type: "output",
      appearance: {},
      config:
        i % 2 === 0
          ? {
              controls: [
                { id: `c-${i}`, kind: "select", column: "label", label: `Label ${i}` },
                ...(i % 6 === 0
                  ? [
                      {
                        id: `c-${i}-b`,
                        kind: "range",
                        column: "amount",
                        label: "Amount",
                        orphaned: true,
                        defaultValue: 1,
                      },
                    ]
                  : []),
              ],
            }
          : {},
    }));
  const dashboardItems = [
    {
      id: DASHBOARD_ID,
      name: "Main",
      meta: { createdBy: "u-1", createdAt: "2026-10-01T00:00:00Z", lastUpdated: "x" },
      appearance: { background: "#000", gridBackground: "#111" },
      layout: {
        lg: snapshotPanels.map((p, k) => ({ panelId: p.id, x: k, y: 0, w: 1, h: 1 })),
        md: [],
        sm: [],
        xs: [],
      },
      layoutVersion: 1,
      ownerId: "u-1",
    },
  ];

  const detailsItems = pipelines.map((p, i) => {
    const history = historyFor(i);
    return {
      pipelineId: p.id,
      steps: stepsFor(i),
      ...(history[0] ? { latestRunAssertions: history[0].assertions } : {}),
    };
  });

  const byRoute: Record<string, number> = {};
  const paths: string[] = [];
  let total = 0;
  let inflight = 0;
  let peak = 0;

  const fetchImpl = async (url: string): Promise<Response> => {
    total++;
    inflight++;
    peak = Math.max(peak, inflight);
    await new Promise((r) => setTimeout(r, delayMs));
    inflight--;
    const u = new URL(url);
    const path = u.pathname;
    paths.push(path);
    const route = normalize(path);
    byRoute[route] = (byRoute[route] ?? 0) + 1;

    if (path === "/api/data-sources") {
      const items = [0, 1, 2, 3, 4].map((k) => ({
        id: `src-${k}`,
        name: `Source ${k}`,
        type: "csv",
        createdAt: "x",
        updatedAt: "x",
        inferredSchema: {
          fields: [
            { name: "amount", displayName: "Amount", dataType: "number", nullable: false },
            { name: "label", displayName: "Label", dataType: "string", nullable: true },
          ],
        },
      }));
      return json(200, { items, total: items.length, offset: 0, limit: 200 });
    }
    if (path === "/api/dashboards") {
      return json(200, { items: dashboardItems, total: 1, offset: 0, limit: 200 });
    }
    if (path === "/api/pipelines") return json(200, pipelines);
    if (path === "/api/pipeline-shapes") {
      return json(200, [
        {
          id: "top-n",
          label: "Top N",
          description: "d",
          paramsSchema: [
            { name: "n", label: "N", dataType: "number", required: true, description: "how many" },
          ],
          outputContract: { rowCount: { kind: "at-most-param", paramName: "n" }, description: "o" },
        },
      ]);
    }
    if (path === "/api/outputs") {
      return json(200, { items: outputs, total: outputs.length, offset: 0, limit: 200 });
    }
    if (path === "/api/connectors") {
      return json(200, {
        items: [{ id: "c1", name: "C", kind: "rest", baseUrl: "https://x.test", pending: false }],
      });
    }
    if (path === "/api/preferences") return json(200, { extras: { tone: "terse" } });
    if (path === "/api/agent/memory") return json(200, []);

    if (path === "/api/pipelines/context-details") {
      if (mode === "404") return json(404, { message: "Not found" });
      if (mode === "500") return json(500, { message: "boom" });
      const items =
        mode === "missing-one"
          ? detailsItems.filter((_, i) => i !== MISSING_PIPELINE_INDEX)
          : detailsItems;
      return json(200, opts.contextDetailsBody ? opts.contextDetailsBody(items) : { items });
    }

    const pm = /^\/api\/pipelines\/(p-\d+)(?:\/(analyze|steps|run-history))?$/.exec(path);
    if (pm) {
      const i = Number(pm[1]!.slice(2));
      const sub = pm[2];
      if (!sub) return json(200, pipelines[i]);
      if (sub === "steps") return json(200, stepsFor(i));
      if (sub === "run-history") return json(200, historyFor(i));
      if (i === ANALYZE_FAILS_INDEX) return json(400, { message: "analyze exploded" });
      const steps = stepsFor(i).map((s, k) => ({
        id: s.id,
        position: s.position,
        type: s.type,
        config: s.config,
        inputSchema: [],
        outputSchema:
          k % 2 === 0
            ? [
                { name: "amount", type: "number" },
                { name: "label", type: "string" },
              ]
            : [{ name: "amount", type: "number" }],
        validationError: i % 11 === 0 && k === 0 ? "bad config" : null,
      }));
      return json(200, {
        id: pid(i),
        name: `Pipeline ${i}`,
        sourceSchemas: [],
        steps,
        costVerdict: { verdict: "ok" },
        warnings:
          i % 13 === 0 && steps[0] ? [{ stepId: steps[0].id, code: "w", message: "hm" }] : [],
      });
    }
    const om = /^\/api\/outputs\/(o-\d+)\/panels$/.exec(path);
    if (om) {
      const n = Number(om[1]!.slice(2));
      const i = Math.floor(n / 10);
      const j = n % 10;
      return json(200, placed(i, j) ? [{ dashboardId: DASHBOARD_ID, panelId: `x-${i}` }] : []);
    }
    if (path === `/api/dashboards/${DASHBOARD_ID}/export`) {
      return json(200, {
        version: 1,
        dashboard: { name: "Main", appearance: {}, layout: dashboardItems[0]!.layout },
        panels: snapshotPanels,
      });
    }
    return json(404, { message: `unexpected ${path}` });
  };

  const warnings: string[] = [];
  const http = new HelioHttpClient({ baseUrl: "https://helio.test", pat: "x" } as HelioConfig, {
    fetchImpl,
    sleep: () => Promise.resolve(),
    warn: (m: string) => warnings.push(m),
  });
  return {
    api: new HelioApi(http),
    fetchImpl,
    warnings,
    stats: () => ({ total, peakInFlight: peak, byRoute: { ...byRoute }, paths: [...paths] }),
  };
}

/** Everything but the wall-clock stamp. */
export function stripGeneratedAt<T extends { generatedAt?: string }>(
  ctx: T,
): Omit<T, "generatedAt"> {
  const { generatedAt: _ignored, ...rest } = ctx;
  return rest;
}
