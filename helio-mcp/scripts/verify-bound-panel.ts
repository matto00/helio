/**
 * HEL-364 end-to-end harness: drives `create_bound_panel` through a real MCP
 * stdio client — mirrors `compose.ts`'s shape (real client, write tools,
 * assertions on the result), scoped to the one compound tool this ticket
 * adds rather than `compose.ts`'s existing full-dashboard narrative.
 *
 * Covers:
 *   1. Happy path — one call replaces the create_data_source -> create_pipeline
 *      -> add_pipeline_step -> run_pipeline -> create_panel -> bind_panel
 *      chain; asserts the returned panel is bound with rows already present.
 *   2. Stage-naming failure — an invalid step type fails at the "steps" stage
 *      (after the pipeline was already created); asserts the tool surfaces
 *      the stage tag verbatim (never swallowed/retried) and that the failed
 *      call's pipeline is cleaned up (not left dangling).
 *
 * Run with HELIO_API_BASE_URL + HELIO_PAT pointing at a running backend:
 *   npm run build && HELIO_API_BASE_URL=... HELIO_PAT=... npm run verify-bound-panel
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "../dist/index.js");

/** The actual (structural) resolved type of `Client#callTool` — covers both
 * the plain-content shape and the legacy `toolResult` compatibility shape. */
type ToolCallResult = Awaited<ReturnType<Client["callTool"]>>;

/** Narrows `ToolCallResult` to the plain-content shape — the legacy
 * `toolResult` compatibility shape carries neither `content` nor `isError`. */
function hasContent(
  result: ToolCallResult,
): result is Extract<ToolCallResult, { content: unknown }> {
  return Array.isArray((result as { content?: unknown }).content);
}

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

function textOf(r: ToolCallResult): string {
  if (!hasContent(r)) return "";
  return r.content.find((c) => c.type === "text")?.text ?? "";
}

function isErrorOf(r: ToolCallResult): boolean {
  return hasContent(r) ? Boolean(r.isError) : false;
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
  const client = new Client({ name: "helio-mcp-verify-bound-panel", version: "0.1.0" });
  await client.connect(transport);

  const call = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const res = await client.callTool({ name, arguments: args });
    const text = textOf(res);
    if (isErrorOf(res)) throw new Error(`${name} failed: ${text}`);
    log(`✓ ${name}`);
    return JSON.parse(text) as T;
  };

  try {
    const dashboard = await call<{ id: string }>("create_dashboard", {
      name: "HEL-364 Bound Panel Verify",
    });

    const bound = await call<{
      sourceId: string;
      pipelineId: string;
      dataTypeId: string;
      panel: { id: string; config: { dataTypeId?: string } };
    }>("create_bound_panel", {
      dashboardId: dashboard.id,
      source: {
        name: "Quarterly Sales (bound)",
        columns: [
          { name: "region", type: "string" },
          { name: "revenue", type: "integer" },
        ],
        rows: [
          ["North", 320],
          ["South", 210],
        ],
      },
      pipeline: { outputDataTypeName: "Sales Output (bound)", steps: [] },
      panel: { type: "metric", title: "Total Revenue (bound)" },
      fieldMapping: { value: "revenue" },
    });

    if (bound.panel.config.dataTypeId !== bound.dataTypeId) {
      throw new Error(
        `panel.config.dataTypeId (${bound.panel.config.dataTypeId}) != returned dataTypeId (${bound.dataTypeId})`,
      );
    }

    const rows = await call<{ rowCount: number }>("get_data_type_rows", {
      dataTypeId: bound.dataTypeId,
    });
    if (rows.rowCount !== 2) throw new Error(`expected 2 rows immediately, got ${rows.rowCount}`);
    log(
      `  happy path: sourceId=${bound.sourceId} pipelineId=${bound.pipelineId} rowCount=${rows.rowCount}`,
    );

    // An invalid step type passes the validation gate (PipelineAnalyzeService's
    // unknown-op fallback is a soft identity projection, not a hard error) and
    // fails for real once the pipeline (created) tries to add the step —
    // asserts the tool surfaces "[steps]" verbatim, never swallowed/retried.
    const pipelinesBefore = await call<Array<{ id: string }>>("list_pipelines", {});
    const failRes = await client.callTool({
      name: "create_bound_panel",
      arguments: {
        dashboardId: dashboard.id,
        source: {
          name: "Should Not Persist",
          columns: [{ name: "revenue", type: "integer" }],
          rows: [[5]],
        },
        pipeline: {
          outputDataTypeName: "Should Not Persist Output",
          steps: [{ type: "not-a-real-op", config: {} }],
        },
        panel: { type: "metric", title: "Should Not Exist" },
        fieldMapping: { value: "revenue" },
      },
    });
    const failText = textOf(failRes);
    if (!isErrorOf(failRes))
      throw new Error(`expected create_bound_panel to fail, got: ${failText}`);
    if (!failText.includes("[steps]")) {
      throw new Error(`expected the "[steps]" stage tag in the surfaced error, got: ${failText}`);
    }
    log(`✓ create_bound_panel (steps-stage failure surfaced verbatim: ${failText})`);

    const pipelinesAfter = await call<Array<{ id: string }>>("list_pipelines", {});
    if (pipelinesAfter.length !== pipelinesBefore.length) {
      throw new Error(
        `expected the failed call's pipeline to be cleaned up: before=${pipelinesBefore.length} after=${pipelinesAfter.length}`,
      );
    }
    log(`  cleanup verified: pipeline count unchanged (${pipelinesAfter.length})`);

    log("\nVERIFY-BOUND-PANEL OK");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  process.stderr.write(`verify-bound-panel failed: ${(err as Error).stack ?? err}\n`);
  process.exit(1);
});
