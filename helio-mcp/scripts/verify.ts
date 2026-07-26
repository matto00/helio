/**
 * End-to-end verification harness (not part of the shipped server).
 *
 * Spawns the built helio-mcp server over stdio using the real MCP SDK client,
 * then exercises every read tool + the workspace-context resource against a
 * running backend, printing the results. Run via `npm run verify` with
 * `HELIO_API_BASE_URL` and `HELIO_PAT` set to a live backend + valid PAT.
 *
 * This is the "connect a real MCP client" evidence the Phase-2 gate asks for.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "../dist/index.js");

function section(title: string): void {
  process.stdout.write(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}\n`);
}

/** Pull the first text block out of a tool result. */
function textOf(result: {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}): string {
  const block = (result.content ?? []).find((c) => c.type === "text");
  return block?.text ?? "";
}

function parse<T>(result: {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}): T {
  if (result.isError) throw new Error(`tool returned isError: ${textOf(result)}`);
  return JSON.parse(textOf(result)) as T;
}

async function main(): Promise<void> {
  const baseUrl = process.env.HELIO_API_BASE_URL ?? "http://localhost:8080";
  const pat = process.env.HELIO_PAT;
  if (!pat) throw new Error("HELIO_PAT must be set for the verify harness");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { HELIO_API_BASE_URL: baseUrl, HELIO_PAT: pat, PATH: process.env.PATH ?? "" },
  });

  const client = new Client({ name: "helio-mcp-verify", version: "0.1.0" });
  await client.connect(transport);

  try {
    section("tools/list");
    const { tools } = await client.listTools();
    for (const t of tools) process.stdout.write(`  • ${t.name} — ${t.title ?? ""}\n`);

    section("resources/list");
    const { resources } = await client.listResources();
    for (const r of resources) process.stdout.write(`  • ${r.uri} (${r.name})\n`);

    section("list_connectors");
    const connectors = parse<
      Array<{
        kind: string;
        displayName: string;
        requiredFields: Array<{ name: string; secret: boolean }>;
      }>
    >(await client.callTool({ name: "list_connectors", arguments: {} }));
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

    section("list_data_types");
    const types = parse<{
      items: Array<{ id: string; name: string; sourceId?: string | null }>;
      total: number;
    }>(await client.callTool({ name: "list_data_types", arguments: {} }));
    for (const t of types.items) {
      // sourceId is omitted on the wire when null → treat missing as bindable.
      const bindable = (t.sourceId ?? null) === null;
      process.stdout.write(
        `  • ${t.name} (${t.id}) ${bindable ? "[pipeline-output → bindable]" : "[source companion]"}\n`,
      );
    }

    section("list_pipelines");
    const pipelines = parse<
      Array<{ id: string; name: string; outputDataTypeId: string; lastRunStatus: string | null }>
    >(await client.callTool({ name: "list_pipelines", arguments: {} }));
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

      section(`get_data_type_rows (output of ${firstPipeline.name})`);
      process.stdout.write(
        textOf(
          await client.callTool({
            name: "get_data_type_rows",
            arguments: { dataTypeId: firstPipeline.outputDataTypeId },
          }),
        ) + "\n",
      );
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
    const shapes = parse<
      Array<{ id: string; label: string; outputContract: { rowCount: unknown } }>
    >(await client.callTool({ name: "list_pipeline_shapes", arguments: {} }));
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

    section("create_pipeline_from_shape — setup: a dedicated static source");
    const shapeSource = parse<{ id: string }>(
      await client.callTool({
        name: "create_data_source",
        arguments: {
          name: `HEL-400 verify source ${Date.now()}`,
          columns: [
            { name: "region", type: "string" },
            { name: "revenue", type: "integer" },
          ],
          rows: [
            ["North", 320],
            ["South", 210],
            ["East", 265],
            ["West", 180],
          ],
        },
      }),
    );
    const pipelinesBeforeFailures = parse<Array<{ id: string }>>(
      await client.callTool({ name: "list_pipelines", arguments: {} }),
    );

    section("create_pipeline_from_shape — valid top-n params succeed");
    const shapeResult = parse<{
      id: string;
      outputDataTypeId: string;
      steps: Array<{ type: string }>;
    }>(
      await client.callTool({
        name: "create_pipeline_from_shape",
        arguments: {
          name: `HEL-400 verify top-n ${Date.now()}`,
          sourceDataSourceId: shapeSource.id,
          outputDataTypeName: `HEL-400 verify top-n output ${Date.now()}`,
          shapeId: "top-n",
          params: { measure: "revenue", direction: "desc", n: 2 },
        },
      }),
    );
    process.stdout.write(
      `  • pipeline ${shapeResult.id} steps=${shapeResult.steps.map((s) => s.type).join(",")}\n`,
    );
    const expandedTypes = shapeResult.steps.map((s) => s.type);
    if (JSON.stringify(expandedTypes) !== JSON.stringify(["sort", "limit"])) {
      throw new Error(
        `expected top-n to expand to [sort, limit], got ${JSON.stringify(expandedTypes)}`,
      );
    }

    section(
      "create_pipeline_from_shape — invalid params (missing 'n') surface expand's message, no pipeline created",
    );
    const invalidParamsResult = await client.callTool({
      name: "create_pipeline_from_shape",
      arguments: {
        name: "HEL-400 verify should-not-exist (invalid params)",
        sourceDataSourceId: shapeSource.id,
        outputDataTypeName: "HEL-400 verify should-not-exist output (invalid params)",
        shapeId: "top-n",
        params: { measure: "revenue", direction: "desc" },
      },
    });
    process.stdout.write(
      `  • isError=${invalidParamsResult.isError} text=${textOf(invalidParamsResult)}\n`,
    );
    if (!invalidParamsResult.isError) {
      throw new Error("expected create_pipeline_from_shape to fail on missing 'n'");
    }
    if (!textOf(invalidParamsResult).includes("missing required field 'n'")) {
      throw new Error(
        `expected the shape's own validation message verbatim, got: ${textOf(invalidParamsResult)}`,
      );
    }

    section(
      "create_pipeline_from_shape — unknown shape id surfaces 404 message, no pipeline created",
    );
    const unknownShapeResult = await client.callTool({
      name: "create_pipeline_from_shape",
      arguments: {
        name: "HEL-400 verify should-not-exist (unknown shape)",
        sourceDataSourceId: shapeSource.id,
        outputDataTypeName: "HEL-400 verify should-not-exist output (unknown shape)",
        shapeId: "not-a-real-shape",
        params: {},
      },
    });
    process.stdout.write(
      `  • isError=${unknownShapeResult.isError} text=${textOf(unknownShapeResult)}\n`,
    );
    if (!unknownShapeResult.isError) {
      throw new Error("expected create_pipeline_from_shape to fail on an unknown shape id");
    }
    if (!textOf(unknownShapeResult).includes("Unknown pipeline shape")) {
      throw new Error(
        `expected the backend's 404 message verbatim, got: ${textOf(unknownShapeResult)}`,
      );
    }

    section(
      "create_pipeline_from_shape — confirm no orphan pipeline was created by the two failures",
    );
    const pipelinesAfterFailures = parse<Array<{ id: string }>>(
      await client.callTool({ name: "list_pipelines", arguments: {} }),
    );
    // Exactly one new pipeline should exist relative to before the failures: the successful top-n one.
    const expectedCount = pipelinesBeforeFailures.length + 1;
    if (pipelinesAfterFailures.length !== expectedCount) {
      throw new Error(
        `expected ${expectedCount} pipelines after the valid call + two failed calls, got ` +
          `${pipelinesAfterFailures.length} (before=${pipelinesBeforeFailures.length})`,
      );
    }
    process.stdout.write(
      `  • pipeline count before=${pipelinesBeforeFailures.length} after=${pipelinesAfterFailures.length} (unchanged by the two failures)\n`,
    );

    section("resource read: helio://workspace/context");
    const ctx = await client.readResource({ uri: "helio://workspace/context" });
    const ctxText = ctx.contents[0]?.text ?? "";
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

    section("VERIFY OK");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  process.stderr.write(`verify failed: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
