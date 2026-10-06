/**
 * End-to-end verification harness (not part of the shipped server).
 *
 * Spawns the built helio-mcp server over stdio using the real MCP SDK client,
 * then exercises every read tool + the workspace-context resource against a
 * running backend, printing the results. Run via `npm run verify` with
 * `HELIO_API_BASE_URL` and `HELIO_PAT` set to a live backend + valid PAT.
 *
 * `HELIO_PAT` is only the BOOTSTRAP credential: the run mints its own short-lived PAT, drives the
 * server under that, and revokes it by exact id at the end. Every fixture it creates (pipeline,
 * inline source) is deleted by exact id and confirmed gone; a failed teardown exits non-zero.
 *
 * This is the "connect a real MCP client" evidence the Phase-2 gate asks for.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { mintRunToken, newLedger, teardown, type MintedToken } from "./verifyFixtures.js";
import {
  buildAddInvalidParamsCall,
  buildAddMetricOutputCall,
  buildGetOutputHistoryCall,
  buildRunPipelineCall,
  buildAddTopNOutputCall,
  buildAddUnknownShapeCall,
  buildCreatePipelineCall,
} from "./verifyPayloads.js";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "../dist/index.js");

/** The actual (structural) resolved type of `Client#callTool` — covers both
 * the plain-content shape and the legacy `toolResult` compatibility shape. */
type ToolCallResult = Awaited<ReturnType<Client["callTool"]>>;

function section(title: string): void {
  process.stdout.write(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}\n`);
}

/** Narrows `ToolCallResult` to the plain-content shape — the legacy
 * `toolResult` compatibility shape carries neither `content` nor `isError`. */
function hasContent(
  result: ToolCallResult,
): result is Extract<ToolCallResult, { content: unknown }> {
  return Array.isArray((result as { content?: unknown }).content);
}

/** Pull the first text block out of a tool result. */
function textOf(result: ToolCallResult): string {
  if (!hasContent(result)) return "";
  const block = result.content.find((c) => c.type === "text");
  return block?.text ?? "";
}

function parse<T>(result: ToolCallResult): T {
  if (isErrorOf(result)) throw new Error(`tool returned isError: ${textOf(result)}`);
  return JSON.parse(textOf(result)) as T;
}

function isErrorOf(result: ToolCallResult): boolean {
  return hasContent(result) ? Boolean(result.isError) : false;
}

async function main(): Promise<void> {
  const baseUrl = process.env.HELIO_API_BASE_URL ?? "http://localhost:8080";
  const bootstrapPat = process.env.HELIO_PAT;
  if (!bootstrapPat) throw new Error("HELIO_PAT must be set for the verify harness");

  const runId = randomBytes(4).toString("hex");
  const ledger = newLedger();
  const log = (line: string): void => void process.stdout.write(`${line}\n`);
  let minted: MintedToken | null = null;
  let client: Client | null = null;
  let runError: unknown = null;

  try {
    minted = await mintRunToken(baseUrl, bootstrapPat, runId);
    log(`run ${runId}: minted token ${minted.id} (revoked at the end)`);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      env: { HELIO_API_BASE_URL: baseUrl, HELIO_PAT: minted.token, PATH: process.env.PATH ?? "" },
    });
    client = new Client({ name: "helio-mcp-verify", version: "0.1.0" });
    await client.connect(transport);
    await runChecks(client, runId, ledger);
  } catch (err) {
    runError = err;
  }

  if (client) await client.close();
  section("teardown");
  const failures = await teardown(baseUrl, bootstrapPat, ledger, minted, log);
  for (const f of failures) process.stderr.write(`TEARDOWN FAILED: ${f}\n`);
  if (runError) throw runError;
  if (failures.length > 0) throw new Error(`teardown left residue: ${failures.join("; ")}`);
  section("VERIFY OK");
}

async function runChecks(
  client: Client,
  runId: string,
  ledger: ReturnType<typeof newLedger>,
): Promise<void> {
  section("tools/list");
  const { tools } = await client.listTools();
  for (const t of tools) process.stdout.write(`  • ${t.name} — ${t.title ?? ""}\n`);

  section("resources/list");
  const { resources } = await client.listResources();
  for (const r of resources) process.stdout.write(`  • ${r.uri} (${r.name})\n`);

  section("list_connector_types");
  const connectors = parse<
    Array<{
      kind: string;
      displayName: string;
      requiredFields: Array<{ name: string; secret: boolean }>;
    }>
  >(await client.callTool({ name: "list_connector_types", arguments: {} }));
  for (const c of connectors)
    process.stdout.write(
      `  • ${c.displayName} (${c.kind}) requiredFields=${c.requiredFields.map((f) => f.name).join(",")}\n`,
    );

  section("list_data_sources");
  const sources = parse<{
    items: Array<{ id: string; name: string; type: string }>;
    total: number;
  }>(await client.callTool({ name: "list_data_sources", arguments: {} }));
  process.stdout.write(
    `  total=${sources.total}; ${sources.items.map((s) => `${s.name}[${s.type}]`).join(", ")}\n`,
  );

  section("list_outputs (workspace-wide, evaluator-1 CR2: replaces retired list_data_types)");
  const outputs = parse<{
    items: Array<{ id: string; name: string; pipelineId: string; nodeStepId?: string | null }>;
    total: number;
  }>(await client.callTool({ name: "list_outputs", arguments: {} }));
  for (const o of outputs.items) {
    // nodeStepId omitted/null on the wire → the pipeline's raw source node.
    const raw = (o.nodeStepId ?? null) === null;
    process.stdout.write(
      `  • ${o.name} (${o.id}) pipeline=${o.pipelineId} ${raw ? "[raw source]" : "[step output]"}\n`,
    );
  }

  section("list_pipelines");
  const pipelines = parse<Array<{ id: string; name: string; lastRunStatus: string | null }>>(
    await client.callTool({ name: "list_pipelines", arguments: {} }),
  );
  for (const p of pipelines)
    process.stdout.write(`  • ${p.name} (${p.id}) lastRun=${p.lastRunStatus ?? "none"}\n`);

  const firstPipeline = pipelines[0];
  if (firstPipeline) {
    section(`get_pipeline (${firstPipeline.name}) — summary + steps`);
    process.stdout.write(
      textOf(
        await client.callTool({
          name: "get_pipeline",
          arguments: { pipelineId: firstPipeline.id },
        }),
      ) + "\n",
    );

    section(`analyze_pipeline (${firstPipeline.name})`);
    process.stdout.write(
      textOf(
        await client.callTool({
          name: "analyze_pipeline",
          arguments: { pipelineId: firstPipeline.id },
        }),
      ) + "\n",
    );

    section(
      `list_outputs (scoped to pipeline ${firstPipeline.name}) — evaluator-1 CR2: setup for get_output_rows`,
    );
    const pipelineOutputs = parse<{ items: Array<{ id: string; name: string }> }>(
      await client.callTool({
        name: "list_outputs",
        arguments: { pipelineId: firstPipeline.id },
      }),
    );
    for (const o of pipelineOutputs.items) process.stdout.write(`  • ${o.name} (${o.id})\n`);

    const firstOutput = pipelineOutputs.items[0];
    if (firstOutput) {
      section(`get_output_rows (${firstOutput.name}) — replaces retired get_data_type_rows`);
      process.stdout.write(
        textOf(
          await client.callTool({
            name: "get_output_rows",
            arguments: { outputId: firstOutput.id },
          }),
        ) + "\n",
      );
    }
  }

  const firstSource = sources.items[0];
  if (firstSource) {
    section(`list_source_objects (${firstSource.name})`);
    process.stdout.write(
      textOf(
        await client.callTool({
          name: "list_source_objects",
          arguments: { sourceId: firstSource.id },
        }),
      ) + "\n",
    );
  }

  section("list_dashboards");
  const dashboards = parse<{ items: Array<{ id: string; name: string }>; total: number }>(
    await client.callTool({ name: "list_dashboards", arguments: {} }),
  );
  for (const d of dashboards.items) process.stdout.write(`  • ${d.name} (${d.id})\n`);

  const firstDashboard = dashboards.items[0];
  if (firstDashboard) {
    section(`get_dashboard (${firstDashboard.name}) — with panels`);
    process.stdout.write(
      textOf(
        await client.callTool({
          name: "get_dashboard",
          arguments: { dashboardId: firstDashboard.id },
        }),
      ) + "\n",
    );
  }

  section("list_pipeline_shapes");
  const shapes = parse<Array<{ id: string; label: string; outputContract: { rowCount: unknown } }>>(
    await client.callTool({ name: "list_pipeline_shapes", arguments: {} }),
  );
  for (const s of shapes)
    process.stdout.write(
      `  • ${s.label} (${s.id}) rowCount=${JSON.stringify(s.outputContract.rowCount)}\n`,
    );
  const expectedShapeIds = ["passthrough", "single-row", "top-n", "time-series", "pivot-matrix"];
  const actualShapeIds = shapes.map((s) => s.id).sort();
  if (JSON.stringify(actualShapeIds) !== JSON.stringify([...expectedShapeIds].sort())) {
    throw new Error(
      `expected shape ids ${JSON.stringify(expectedShapeIds)}, got ${JSON.stringify(actualShapeIds)}`,
    );
  }

  section(
    "add_outputs_from_shape — setup: create_pipeline (single-call, HEL-906) with an inline static source, no steps/outputs",
  );
  const shapePipeline = parse<{ id: string; roots: Array<{ dataSourceId: string }> }>(
    await client.callTool(buildCreatePipelineCall(runId)),
  );
  ledger.pipelineIds.push(shapePipeline.id);
  for (const r of shapePipeline.roots) ledger.sourceIds.push(r.dataSourceId);
  const outputsBeforeFailures = parse<{ items: Array<{ id: string }> }>(
    await client.callTool({
      name: "list_outputs",
      arguments: { pipelineId: shapePipeline.id },
    }),
  );

  section("add_outputs_from_shape — valid top-n params succeed (evaluator-1 CR2)");
  const shapeResult = parse<{
    steps: Array<{ type: string }>;
    output: { id: string };
  }>(await client.callTool(buildAddTopNOutputCall(shapePipeline.id, runId)));
  process.stdout.write(
    `  • pipeline ${shapePipeline.id} steps=${shapeResult.steps.map((s) => s.type).join(",")} output=${shapeResult.output.id}\n`,
  );
  const expandedTypes = shapeResult.steps.map((s) => s.type);
  if (JSON.stringify(expandedTypes) !== JSON.stringify(["sort", "limit"])) {
    throw new Error(
      `expected top-n to expand to [sort, limit], got ${JSON.stringify(expandedTypes)}`,
    );
  }

  section(
    "add_outputs_from_shape — invalid params (missing 'n') surface expand's message, nothing added (evaluator-1 CR2)",
  );
  const invalidParamsResult = await client.callTool(
    buildAddInvalidParamsCall(shapePipeline.id, runId),
  );
  process.stdout.write(
    `  • isError=${isErrorOf(invalidParamsResult)} text=${textOf(invalidParamsResult)}\n`,
  );
  if (!isErrorOf(invalidParamsResult)) {
    throw new Error("expected add_outputs_from_shape to fail on missing 'n'");
  }
  if (!textOf(invalidParamsResult).includes("missing required field 'n'")) {
    throw new Error(
      `expected the shape's own validation message verbatim, got: ${textOf(invalidParamsResult)}`,
    );
  }

  section(
    "add_outputs_from_shape — unknown shape id surfaces 404 message, nothing added (evaluator-1 CR2)",
  );
  const unknownShapeResult = await client.callTool(
    buildAddUnknownShapeCall(shapePipeline.id, runId),
  );
  process.stdout.write(
    `  • isError=${isErrorOf(unknownShapeResult)} text=${textOf(unknownShapeResult)}\n`,
  );
  if (!isErrorOf(unknownShapeResult)) {
    throw new Error("expected add_outputs_from_shape to fail on an unknown shape id");
  }
  if (!textOf(unknownShapeResult).includes("Unknown pipeline shape")) {
    throw new Error(
      `expected the backend's 404 message verbatim, got: ${textOf(unknownShapeResult)}`,
    );
  }

  section(
    "add_outputs_from_shape — confirm no orphan Output was added by the two failures (evaluator-1 CR2)",
  );
  const outputsAfterFailures = parse<{ items: Array<{ id: string }> }>(
    await client.callTool({
      name: "list_outputs",
      arguments: { pipelineId: shapePipeline.id },
    }),
  );
  // Exactly one new Output should exist relative to before the failures: the successful top-n one.
  const expectedCount = outputsBeforeFailures.items.length + 1;
  if (outputsAfterFailures.items.length !== expectedCount) {
    throw new Error(
      `expected ${expectedCount} Outputs after the valid call + two failed calls, got ` +
        `${outputsAfterFailures.items.length} (before=${outputsBeforeFailures.items.length})`,
    );
  }
  process.stdout.write(
    `  • Output count before=${outputsBeforeFailures.items.length} after=${outputsAfterFailures.items.length} (unchanged by the two failures)\n`,
  );

  await verifyOutputHistory(client, shapePipeline.id, runId);

  section("resource read: helio://workspace/context");
  const ctx = await client.readResource({ uri: "helio://workspace/context" });
  const ctxContent = ctx.contents[0];
  const ctxText = (ctxContent && "text" in ctxContent ? ctxContent.text : undefined) ?? "";
  process.stdout.write(ctxText + "\n");
  const ctxParsed = JSON.parse(ctxText) as { pipelineShapes?: Array<{ id: string }> };
  if (!Array.isArray(ctxParsed.pipelineShapes) || ctxParsed.pipelineShapes.length !== 5) {
    throw new Error(
      `expected get_workspace_context/resource to include a 5-entry pipelineShapes array, got: ` +
        `${JSON.stringify(ctxParsed.pipelineShapes)}`,
    );
  }

  section("get_workspace_context tool — confirm it also includes pipelineShapes");
  const toolCtx = parse<{ pipelineShapes: Array<{ id: string }> }>(
    await client.callTool({ name: "get_workspace_context", arguments: {} }),
  );
  if (toolCtx.pipelineShapes.length !== 5) {
    throw new Error(
      `expected get_workspace_context tool's pipelineShapes to have 5 entries, got ` +
        `${toolCtx.pipelineShapes.length}`,
    );
  }
  process.stdout.write(`  • pipelineShapes entries=${toolCtx.pipelineShapes.length}\n`);
}

const HISTORY_RUNS = 30;
const RATE_LIMIT_BACKOFF_MS = 15_000;
const HISTORY_RUN_BUDGET_MS = 6 * 60_000;

/** HEL-1274: 30 real runs of a metric Output, then ONE get_output_history call returning 30 values. */
async function verifyOutputHistory(
  client: Client,
  pipelineId: string,
  runId: string,
): Promise<void> {
  section(
    `get_output_history — add a metric Output with config.compare, run ${HISTORY_RUNS}x, read once`,
  );
  const metric = parse<{ id: string; config?: { compare?: string } }>(
    await client.callTool(buildAddMetricOutputCall(pipelineId, runId)),
  );
  process.stdout.write(`  • metric Output ${metric.id} compare=${metric.config?.compare}\n`);

  const deadline = Date.now() + HISTORY_RUN_BUDGET_MS;
  for (let done = 0; done < HISTORY_RUNS; ) {
    const res = await client.callTool(buildRunPipelineCall(pipelineId));
    if (!isErrorOf(res)) {
      done += 1;
      continue;
    }
    // A 429 survives the HTTP client's own bounded retries: wait out the window, then retry.
    if (Date.now() + RATE_LIMIT_BACKOFF_MS > deadline) {
      throw new Error(
        `only ${done}/${HISTORY_RUNS} runs within budget; last error: ${textOf(res)}`,
      );
    }
    process.stdout.write(`  • run ${done + 1} refused (${textOf(res).slice(0, 80)}); waiting\n`);
    await new Promise((r) => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
  }
  process.stdout.write(`  • ${HISTORY_RUNS} real runs succeeded\n`);

  // Evidence only: how many points are retained right before the one-call read (limit 100 is the
  // route's max), so a pass is not a lucky timing and thinning shows up as a count below 30.
  const preRead = parse<{ points: unknown[] }>(
    await client.callTool(buildGetOutputHistoryCall(metric.id, 100)),
  );
  process.stdout.write(`  • pre-read retained point count (limit 100): ${preRead.points.length}\n`);

  const history = parse<{
    compare: string | null;
    current: { value: number | null } | null;
    baseline: { value: number | null } | null;
    delta: number | null;
    sparkline: Array<{ capturedAt: string; value: number | null }>;
    points: unknown[];
  }>(await client.callTool(buildGetOutputHistoryCall(metric.id, HISTORY_RUNS)));
  process.stdout.write(
    `  • ONE get_output_history call: points=${history.points.length} sparkline=${history.sparkline.length} ` +
      `compare=${history.compare} current=${history.current?.value} baseline=${history.baseline?.value} delta=${history.delta}\n`,
  );
  for (const p of history.sparkline) process.stdout.write(`    ${p.capturedAt} -> ${p.value}\n`);
  const numeric = history.sparkline.filter((p) => typeof p.value === "number").length;
  if (history.points.length !== HISTORY_RUNS || numeric !== HISTORY_RUNS) {
    throw new Error(
      `expected ${HISTORY_RUNS} points and ${HISTORY_RUNS} numeric sparkline values in one call, got ` +
        `points=${history.points.length} numeric=${numeric} (fewer usually means another backend sharing this database ran its retention purge and thinned the fixture; ` +
        `rerun with \`npm run verify:isolated\`, which uses a dedicated database no other backend can reach)`,
    );
  }
}

main().catch((err) => {
  process.stderr.write(`verify failed: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
