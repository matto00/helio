/**
 * HEL-1619 seam probe (design D10b, task 4.5): the REAL helio-mcp `HelioHttpClient` + `HelioApi` +
 * `buildWorkspaceContext` against a REAL backend that serves `GET /api/pipelines/context-details`.
 * Registers a throwaway user, seeds a multi-pipeline workspace over REST, builds the workspace context
 * and records the per-route request counts. It asserts:
 *   - zero `/api/pipelines/:id/steps` and zero `/api/pipelines/:id/run-history` requests (the MCP
 *     understood the real response; a silent fallback would send one of each per pipeline);
 *   - the payload equals the one the per-pipeline fallback produces from the same server.
 *
 * Run (from helio-mcp/, backend already up):  npx tsx scripts/contextDetailsLiveProbe.ts <baseUrl> [pipelines]
 * The probe also fails if the build wrote a fallback warning to stderr, or if any `/api/outputs/:id/panels`
 * request was sent for an Output the server reports `panelCount: 0` for.
 */
import { buildWorkspaceContext } from "../src/context.js";
import type { HelioConfig } from "../src/config.js";
import { HelioApi } from "../src/helioApi.js";
import { HelioHttpClient } from "../src/httpClient.js";
import { mintBootstrapPat, register, revokePat } from "./isolatedAuth.js";

const baseUrl = process.argv[2] ?? "http://localhost:9958";
const PIPELINES = Number(process.argv[3] ?? 12);
const norm = (p: string): string => p.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}/g, "/:id");

function countingFetch(counts: Map<string, number>, paths: string[]) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const path = new URL(url).pathname;
    const route = `${init?.method ?? "GET"} ${norm(path)}`;
    counts.set(route, (counts.get(route) ?? 0) + 1);
    paths.push(path);
    return fetch(url, init);
  };
}

async function main(): Promise<void> {
  const email = `hel1619-probe-${Date.now()}@helio.test`;
  const { cookie, userId } = await register(baseUrl, email, "probe-Passw0rd!x1");
  const pat = await mintBootstrapPat(baseUrl, cookie, "hel1619");
  // The minted PAT is always revoked when the run ends (CONTRIBUTING, credential handling in delivery
  // evidence), pass or fail; a failed revocation fails the probe.
  try {
    const config = { baseUrl, pat: pat.token } as HelioConfig;
    const seedCounts = new Map<string, number>();
    const seedApi = new HelioApi(
      new HelioHttpClient(config, { fetchImpl: countingFetch(seedCounts, []), warn: () => {} }),
    );

    const source = await seedApi.createDataSource({
      name: "probe source",
      columns: [
        { name: "region", type: "string" },
        { name: "amount", type: "number" },
      ],
      rows: [
        ["east", 10],
        ["west", 20],
      ],
    });
    const pipelineIds: string[] = [];
    for (let i = 0; i < PIPELINES; i++) {
      const branched = i % 4 === 0;
      const created = await seedApi.createPipeline({
        name: `probe pipeline ${i}`,
        roots: [{ sourceId: source.id }],
        steps: [
          { clientId: "a", type: "limit", config: { count: 10 } },
          {
            clientId: "b",
            type: "sort",
            config: { by: [{ field: "amount", direction: "desc" }] },
            parentStepId: "a",
          },
          ...(branched
            ? [
                {
                  clientId: "c",
                  type: "limit",
                  config: { count: 1 },
                  parentStepId: "a",
                  attachAsTail: true,
                },
              ]
            : []),
        ] as never,
        outputs: [
          { nodeStepClientId: "b", kind: "table", name: `table ${i}` },
          { kind: "table", name: `raw ${i}` },
        ],
      });
      pipelineIds.push(created.id);
      if (i % 3 === 0) await seedApi.runPipeline(created.id);
    }

    const counts = new Map<string, number>();
    const paths: string[] = [];
    const warnings: string[] = [];
    const realStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      warnings.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    const api = new HelioApi(
      new HelioHttpClient(config, { fetchImpl: countingFetch(counts, paths), warn: () => {} }),
    );
    const batched = await buildWorkspaceContext(api, 50_000_000, false);
    const batchedConcise = await buildWorkspaceContext(api, 50_000_000, true);

    // Same server, per-pipeline fallback (the batched read forced to 404): the payload must match.
    const fallbackApi = new Proxy(new HelioApi(new HelioHttpClient(config, { warn: () => {} })), {
      get(target, prop, receiver) {
        if (prop === "getPipelineContextDetails") {
          return async () => {
            const { HelioApiError } = await import("../src/httpClient.js");
            throw new HelioApiError(404, `${baseUrl}/api/pipelines/context-details`, "404");
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const fallback = await buildWorkspaceContext(fallbackApi, 50_000_000, false);
    process.stderr.write = realStderr;

    const strip = (c: { generatedAt?: string }) => JSON.stringify({ ...c, generatedAt: undefined });
    const stepsReqs = paths.filter((p) => /\/api\/pipelines\/[^/]+\/steps$/.test(p)).length;
    const historyReqs = paths.filter((p) => /\/api\/pipelines\/[^/]+\/run-history$/.test(p)).length;
    const contextDetailsReqs = paths.filter((p) => p === "/api/pipelines/context-details").length;
    const summaryReqs = paths.filter(
      (p) => /^\/api\/pipelines\/[^/]+$/.test(p) && p !== "/api/pipelines/context-details",
    ).length;
    const panelsReqs = paths.filter((p) => /\/api\/outputs\/[^/]+\/panels$/.test(p)).length;
    const verdict = {
      baseUrl,
      pipelines: PIPELINES,
      pipelinesSeen: batched.pipelines.length,
      lanesWithSteps: batched.pipelines.filter((p) => p.laneTree.length > 0).length,
      requestsFor2Builds: [...counts.values()].reduce((a, b) => a + b, 0),
      contextDetailsReqs,
      stepsReqs,
      historyReqs,
      summaryReqs,
      panelsReqs,
      byRoute: Object.fromEntries([...counts].sort()),
      stderrWarnings: warnings,
      payloadEqualsPerPipelineFallback: strip(batched) === strip(fallback),
      conciseNonEmpty: batchedConcise.pipelines.length === PIPELINES,
    };
    console.log(JSON.stringify(verdict, null, 1));
    const ok =
      verdict.pipelinesSeen === PIPELINES &&
      verdict.lanesWithSteps === PIPELINES &&
      contextDetailsReqs === 2 &&
      stepsReqs === 0 &&
      historyReqs === 0 &&
      summaryReqs === 0 &&
      panelsReqs === 0 &&
      warnings.length === 0 &&
      verdict.payloadEqualsPerPipelineFallback;
    console.log(ok ? "PROBE PASS" : "PROBE FAIL");
    process.exitCode = ok ? 0 : 1;
  } finally {
    const failure = await revokePat(baseUrl, {
      email,
      userId,
      cookie,
      patId: pat.id,
      pat: pat.token,
    });
    if (failure) {
      console.log(`PAT REVOCATION FAILED: ${failure}`);
      process.exitCode = 1;
    } else {
      console.log(`PAT ${pat.id} revoked and no longer authenticates (HTTP 401)`);
    }
  }
}

await main();
