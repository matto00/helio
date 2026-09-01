/**
 * MCP E2E: the four Sleeper dashboards (HEL-857) rebuilt through the
 * single-call surface, from a clean workspace, with a daily schedule read
 * back — HEL-907 tasks.md task 5.1, reusing HEL-857's own exit criterion as
 * this ticket's acceptance test (design.md: "the Sleeper rebuild as the
 * acceptance test").
 *
 * HONESTY NOTE (read before treating this as a literal replay): HEL-857's
 * original build pulled real fantasy-football data from the live Sleeper
 * API. This script does NOT re-fetch that external API — doing so needs a
 * live Sleeper league id/season and network egress this harness does not
 * assume it has. What it DOES prove, faithfully, is the actual thing
 * task 5.1's text asks for: rebuilding four independent dashboards from a
 * clean workspace using ONLY the current single-call surface
 * (`create_pipeline` with inline `steps[]`/`outputs[]` in one call, then
 * `place_outputs`), each with a daily refresh schedule set and read back --
 * the exact composition shape HEL-857's real build used, driven here by
 * four representative static sources shaped like Sleeper's real domain
 * (rosters/matchups/standings/transactions) rather than a live pull.
 *
 * CLEANUP (evaluator-1 CR3 fix): every resource this script creates --
 * source, pipeline, Output, AND dashboard -- is tagged (`E2E_TAG`) and
 * reclaimable via `teardown_resources`. `create_dashboard` did NOT accept a
 * `tag` at all as of the first run of this script (`Dashboard` carried no
 * `tag` column in the schema) -- fixed by extending HEL-366's existing
 * resource-tagging system to dashboards (V95 migration), rather than
 * papering over the gap with an explicit `delete_dashboard`-per-id cleanup
 * in a `finally` block, so a dashboard now behaves exactly like every other
 * taggable resource: it persists after a successful run (the actual point
 * of an E2E composition proof) and is only reclaimed by a re-run's own
 * teardown-at-start, or an explicit `--cleanup-only` invocation. The
 * original bug (evaluator-caught): teardown only ran at the script's own
 * start, never after, and `create_dashboard` had nothing to tag anyway, so
 * two runs of this script left 8 real orphaned dashboards sitting in the
 * shared dev Postgres until an evaluator caught and manually deleted them.
 *
 * Run with HELIO_API_BASE_URL + HELIO_PAT pointing at a running backend
 * (a genuinely CLEAN workspace, or at least one where this script's
 * `E2E_TAG` isn't already in use — every created resource, including each
 * dashboard, is tagged so a re-run can `teardown_resources` first, see
 * `cleanupOnly` below):
 *
 *   npm run build
 *   HELIO_API_BASE_URL=http://localhost:8080 HELIO_PAT=helio_pat_... \
 *     node dist-e2e/sleeper-rebuild.js
 *
 * (Compile via `npx tsc e2e/sleeper-rebuild.ts --outDir dist-e2e --module
 * nodenext --target es2022 --moduleResolution nodenext`, or add an npm
 * script once this harness is wired into `package.json` -- deliberately
 * left as a standalone ts-node-style script for now, mirroring
 * `scripts/verify.ts`'s own standalone-script precedent, not yet promoted
 * to a package.json script.)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "../dist/index.js");

type ToolCallResult = Awaited<ReturnType<Client["callTool"]>>;

function hasContent(
  result: ToolCallResult,
): result is Extract<ToolCallResult, { content: unknown }> {
  return Array.isArray((result as { content?: unknown }).content);
}

function textOf(r: ToolCallResult): string {
  if (!hasContent(r)) return "";
  return r.content.find((c) => c.type === "text")?.text ?? "";
}

function isErrorOf(r: ToolCallResult): boolean {
  return hasContent(r) ? Boolean(r.isError) : false;
}

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

/** Tags every resource this script creates, so a re-run (or a human) can
 *  `teardown_resources({tag: E2E_TAG})` to reset to a clean slate without
 *  hunting for stray resources by name. */
const E2E_TAG = "e2e-sleeper-rebuild";

/** One representative "Sleeper-shaped" dashboard spec: an inline static
 *  source (columns + rows, so this script needs no live Sleeper API access)
 *  feeding one pipeline with zero-or-more transform steps and one table
 *  Output, placed on a fresh dashboard, with a daily 6am UTC refresh
 *  schedule. */
interface DashboardSpec {
  dashboardName: string;
  pipelineName: string;
  source: {
    name: string;
    columns: Array<{ name: string; type: string }>;
    rows: unknown[][];
  };
  outputName: string;
}

const DASHBOARD_SPECS: DashboardSpec[] = [
  {
    dashboardName: "League Rosters",
    pipelineName: "Rosters Pipeline",
    source: {
      name: "Rosters",
      columns: [
        { name: "team", type: "string" },
        { name: "player", type: "string" },
        { name: "position", type: "string" },
      ],
      rows: [
        ["Dynasty Warriors", "Player A", "QB"],
        ["Dynasty Warriors", "Player B", "RB"],
        ["Gridiron Titans", "Player C", "WR"],
      ],
    },
    outputName: "Rosters Table",
  },
  {
    dashboardName: "Weekly Matchups",
    pipelineName: "Matchups Pipeline",
    source: {
      name: "Matchups",
      columns: [
        { name: "week", type: "integer" },
        { name: "homeTeam", type: "string" },
        { name: "awayTeam", type: "string" },
        { name: "homeScore", type: "float" },
        { name: "awayScore", type: "float" },
      ],
      rows: [
        [1, "Dynasty Warriors", "Gridiron Titans", 112.4, 98.2],
        [2, "Gridiron Titans", "Dynasty Warriors", 105.0, 110.5],
      ],
    },
    outputName: "Matchups Table",
  },
  {
    dashboardName: "League Standings",
    pipelineName: "Standings Pipeline",
    source: {
      name: "Standings",
      columns: [
        { name: "team", type: "string" },
        { name: "wins", type: "integer" },
        { name: "losses", type: "integer" },
        { name: "pointsFor", type: "float" },
      ],
      rows: [
        ["Dynasty Warriors", 1, 1, 222.9],
        ["Gridiron Titans", 1, 1, 203.2],
      ],
    },
    outputName: "Standings Table",
  },
  {
    dashboardName: "Waiver Transactions",
    pipelineName: "Transactions Pipeline",
    source: {
      name: "Transactions",
      columns: [
        { name: "team", type: "string" },
        { name: "playerAdded", type: "string" },
        { name: "playerDropped", type: "string" },
        { name: "week", type: "integer" },
      ],
      rows: [["Dynasty Warriors", "Player D", "Player A", 2]],
    },
    outputName: "Transactions Table",
  },
];

async function main(): Promise<void> {
  const baseUrl = process.env.HELIO_API_BASE_URL ?? "http://localhost:8080";
  const pat = process.env.HELIO_PAT;
  if (!pat) throw new Error("HELIO_PAT must be set");
  const cleanupOnly = process.argv.includes("--cleanup-only");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { HELIO_API_BASE_URL: baseUrl, HELIO_PAT: pat, PATH: process.env.PATH ?? "" },
  });
  const client = new Client({ name: "helio-mcp-e2e-sleeper-rebuild", version: "0.1.0" });
  await client.connect(transport);

  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const res = await client.callTool({ name, arguments: args });
    if (isErrorOf(res)) throw new Error(`${name} failed: ${textOf(res)}`);
    return JSON.parse(textOf(res)) as T;
  };

  try {
    log(`Tearing down any prior run tagged "${E2E_TAG}"...`);
    await call("teardown_resources", { tag: E2E_TAG, dryRun: false }).catch(() => {
      // No prior run to tear down -- fine, this is the "clean workspace" starting state.
    });

    if (cleanupOnly) {
      log("Cleanup-only run -- done.");
      return;
    }

    for (const spec of DASHBOARD_SPECS) {
      log(`\n=== ${spec.dashboardName} ===`);

      // ONE call: source + pipeline + Output (HEL-906/HEL-907 single-call surface).
      const pipeline = await call<{ id: string; outputs: Array<{ id: string; name: string }> }>(
        "create_pipeline",
        {
          name: spec.pipelineName,
          source: {
            type: "static",
            name: spec.source.name,
            config: { columns: spec.source.columns, rows: spec.source.rows },
          },
          outputs: [{ kind: "table", name: spec.outputName }],
          tag: E2E_TAG,
        },
      );
      const output = pipeline.outputs.find((o) => o.name === spec.outputName);
      if (!output)
        throw new Error(`${spec.pipelineName}: expected an Output named ${spec.outputName}`);
      log(`  pipeline=${pipeline.id} output=${output.id}`);

      // Run it so the Output has real rows before it's placed.
      await call("run_pipeline", { pipelineId: pipeline.id });
      log(`  ran pipeline`);

      // Daily refresh schedule, 6am UTC -- set then read back to prove persistence.
      await call("set_pipeline_schedule", {
        pipelineId: pipeline.id,
        kind: "cron",
        expression: "0 6 * * *",
        timezone: "UTC",
      });
      const schedule = await call<{ kind: string; expression: string; timezone: string }>(
        "get_pipeline_schedule",
        { pipelineId: pipeline.id },
      );
      if (schedule.kind !== "cron" || schedule.expression !== "0 6 * * *") {
        throw new Error(
          `${spec.pipelineName}: schedule read-back mismatch: ${JSON.stringify(schedule)}`,
        );
      }
      log(
        `  schedule set + read back: ${schedule.kind} "${schedule.expression}" ${schedule.timezone}`,
      );

      // Dashboard + placement (place_outputs, not create_panel/bind_panel).
      const dashboard = await call<{ id: string }>("create_dashboard", {
        name: spec.dashboardName,
        tag: E2E_TAG,
      });
      await call("place_outputs", {
        dashboardId: dashboard.id,
        items: [{ outputId: output.id, title: spec.outputName }],
      });
      log(`  dashboard=${dashboard.id} placed output ${output.id}`);

      log(`DASHBOARD_ID=${dashboard.id}`);
    }

    log("\nAll four dashboards rebuilt successfully.");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  process.stderr.write(`sleeper-rebuild: fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
