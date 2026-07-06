/**
 * Phase-3/5 composition harness: drives the WRITE tools through a real MCP
 * stdio client to build a full dashboard from scratch —
 *   create_data_source → create_pipeline → add_pipeline_step → run_pipeline
 *   → create_dashboard → create_panel ×2 → bind_panel ×2
 * — then reads it back (get_dashboard, get_data_type_rows) to prove the chain.
 *
 * Prints the created dashboard id (last line, `DASHBOARD_ID=<id>`) so a caller
 * (e.g. the Phase-5 app-verification script) can open it in the browser.
 *
 * Run with HELIO_API_BASE_URL + HELIO_PAT pointing at a running backend.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "../dist/index.js");

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

function textOf(r: {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}): string {
  return (r.content ?? []).find((c) => c.type === "text")?.text ?? "";
}

async function main(): Promise<void> {
  const baseUrl = process.env.HELIO_API_BASE_URL ?? "http://localhost:8080";
  const pat = process.env.HELIO_PAT;
  if (!pat) throw new Error("HELIO_PAT must be set");

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { HELIO_API_BASE_URL: baseUrl, HELIO_PAT: pat, PATH: process.env.PATH ?? "" },
  });
  const client = new Client({ name: "helio-mcp-compose", version: "0.1.0" });
  await client.connect(transport);

  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const res = await client.callTool({ name, arguments: args });
    const text = textOf(res);
    if (res.isError) throw new Error(`${name} failed: ${text}`);
    log(`✓ ${name}`);
    return JSON.parse(text) as T;
  };

  try {
    const source = await call<{ id: string }>("create_data_source", {
      name: "Quarterly Sales",
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
    });

    const pipeline = await call<{ id: string; outputDataTypeId: string }>("create_pipeline", {
      name: "Sales by Region",
      sourceDataSourceId: source.id,
      outputDataTypeName: "Sales by Region",
    });

    await call("add_pipeline_step", {
      pipelineId: pipeline.id,
      type: "sort",
      config: { sortBy: [{ field: "revenue", direction: "desc" }] },
    });

    const run = await call<{ status: string; rowCount: number; outputDataTypeId: string }>(
      "run_pipeline",
      { pipelineId: pipeline.id },
    );
    log(`  run status=${run.status} rowCount=${run.rowCount}`);

    const dashboard = await call<{ id: string }>("create_dashboard", {
      name: "Regional Sales Overview",
    });

    const metric = await call<{ id: string }>("create_panel", {
      dashboardId: dashboard.id,
      title: "Total Revenue",
      type: "metric",
    });
    await call("bind_panel", {
      panelId: metric.id,
      dataTypeId: run.outputDataTypeId,
      panelType: "metric",
      fieldMapping: { value: "revenue", label: "region" },
    });

    const chart = await call<{ id: string }>("create_panel", {
      dashboardId: dashboard.id,
      title: "Revenue by Region",
      type: "chart",
    });
    await call("bind_panel", {
      panelId: chart.id,
      dataTypeId: run.outputDataTypeId,
      panelType: "chart",
      fieldMapping: { xAxis: "region", yAxis: "revenue" },
    });

    const table = await call<{ id: string }>("create_panel", {
      dashboardId: dashboard.id,
      title: "Sales Table",
      type: "table",
    });
    await call("bind_panel", {
      panelId: table.id,
      dataTypeId: run.outputDataTypeId,
      panelType: "table",
      fieldMapping: { columns: "region,revenue" },
    });

    // Read back the composed dashboard + the rows the panels bind to.
    const composed = await call<{
      panels: Array<{ title: string; type: string; config: unknown }>;
    }>("get_dashboard", { dashboardId: dashboard.id });
    const rows = await call<{ rowCount: number; rows: unknown[] }>("get_data_type_rows", {
      dataTypeId: run.outputDataTypeId,
    });

    log("\n=== composed dashboard ===");
    log(JSON.stringify(composed, null, 2));
    log("\n=== bound rows ===");
    log(JSON.stringify(rows, null, 2));

    // Assertions: 3 panels, all bound to the output type, rows present.
    if (composed.panels.length !== 3)
      throw new Error(`expected 3 panels, got ${composed.panels.length}`);
    const boundIds = composed.panels.map((p) => (p.config as { dataTypeId?: string })?.dataTypeId);
    if (!boundIds.every((id) => id === run.outputDataTypeId)) {
      throw new Error(
        `panels not all bound to ${run.outputDataTypeId}: ${JSON.stringify(boundIds)}`,
      );
    }
    if (rows.rowCount < 1) throw new Error("expected rows in the output DataType");

    log("\nCOMPOSE OK");
    log(`DASHBOARD_ID=${dashboard.id}`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  process.stderr.write(`compose failed: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
