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

    section("resource read: helio://workspace/context");
    const ctx = await client.readResource({ uri: "helio://workspace/context" });
    process.stdout.write((ctx.contents[0]?.text ?? "") + "\n");

    section("VERIFY OK");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  process.stderr.write(`verify failed: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
