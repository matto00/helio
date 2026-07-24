/**
 * Registers the Phase-2 read tools + the workspace-context tool on an
 * `McpServer`. Every tool is a thin pass-through: it calls one `HelioApi`
 * method and returns the JSON verbatim as text content. Tool descriptions
 * encode the canonical `DataSource → Pipeline → DataType → Panel` path and the
 * pipeline-only binding rule (V41) so an agent reads/reasons along the grain
 * of the API rather than fighting it.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { HelioApi } from "../helioApi.js";
import { HelioApiError } from "../httpClient.js";
import { buildWorkspaceContext } from "../context.js";

/** Serialize any value as a single pretty-printed JSON text block. */
function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/** Run a producer, converting Helio/other errors into an MCP tool error. */
async function guarded(produce: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return jsonResult(await produce());
  } catch (err) {
    const message =
      err instanceof HelioApiError
        ? `${err.name} (status ${err.status}) for ${err.url}: ${err.message}`
        : `${(err as Error)?.name ?? "Error"}: ${(err as Error)?.message ?? String(err)}`;
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

export function registerReadTools(server: McpServer, api: HelioApi): void {
  server.registerTool(
    "list_dashboards",
    {
      title: "List dashboards",
      description:
        "List all dashboards visible to the authenticated user (paginated envelope: items, total, offset, limit).",
      inputSchema: {
        limit: z.number().int().positive().max(500).optional(),
        offset: z.number().int().nonnegative().optional(),
      },
    },
    ({ limit, offset }) => guarded(() => api.listDashboards(limit, offset)),
  );

  server.registerTool(
    "get_dashboard",
    {
      title: "Get dashboard (with panels)",
      description:
        "Get one dashboard with its panels. Composed from the dashboard list record and the " +
        "/export snapshot, because the backend on `main` exposes neither GET /api/dashboards/:id " +
        "nor GET /api/dashboards/:id/panels. Each panel includes its title, type, and typed config " +
        "(the config carries the bound DataType id + field mapping for data panels).",
      inputSchema: { dashboardId: z.string().min(1) },
    },
    ({ dashboardId }) => guarded(() => api.getDashboard(dashboardId)),
  );

  server.registerTool(
    "list_data_sources",
    {
      title: "List data sources",
      description:
        "List data sources (CSV, REST API, SQL, static) — the roots of the canonical path " +
        "DataSource → Pipeline → DataType → Panel. Discriminated on `type`.",
      inputSchema: {
        limit: z.number().int().positive().max(500).optional(),
        offset: z.number().int().nonnegative().optional(),
      },
    },
    ({ limit, offset }) => guarded(() => api.listDataSources(limit, offset)),
  );

  server.registerTool(
    "list_source_objects",
    {
      title: "Inspect a data source (preview)",
      description:
        "Inspect what a data source contains. NOTE: the brief's GET /api/data-sources/:id/sources " +
        "endpoint does not exist on `main`; this surfaces the real per-source preview instead " +
        "(headers+rows for CSV/static, row objects for REST/SQL), selected by source type. Use it " +
        "to see a source's shape before building a pipeline over it.",
      inputSchema: { sourceId: z.string().min(1) },
    },
    ({ sourceId }) => guarded(() => api.listSourceObjects(sourceId)),
  );

  server.registerTool(
    "list_data_types",
    {
      title: "List DataTypes",
      description:
        "List DataTypes with their columns (fields) and computed fields. A DataType with " +
        "sourceId === null is a pipeline OUTPUT and is the only kind a panel may bind to (V41). " +
        "A DataType with a non-null sourceId is a source companion (not panel-bindable).",
      inputSchema: {
        limit: z.number().int().positive().max(500).optional(),
        offset: z.number().int().nonnegative().optional(),
      },
    },
    ({ limit, offset }) => guarded(() => api.listDataTypes(limit, offset)),
  );

  server.registerTool(
    "get_data_type_rows",
    {
      title: "Get DataType rows",
      description:
        "Fetch the latest pipeline-run row snapshot for a DataType ({ rows, rowCount }). Rows exist " +
        "only after the DataType's producing pipeline has run successfully.",
      inputSchema: { dataTypeId: z.string().min(1) },
    },
    ({ dataTypeId }) => guarded(() => api.getDataTypeRows(dataTypeId)),
  );

  server.registerTool(
    "list_pipelines",
    {
      title: "List pipelines",
      description:
        "List pipelines as summaries (source, output DataType, last-run status/row-count). Pipelines " +
        "are the only path that produces panel-bindable DataTypes. Use get_pipeline or " +
        "analyze_pipeline for step detail.",
      inputSchema: {},
    },
    () => guarded(() => api.listPipelines()),
  );

  server.registerTool(
    "get_pipeline",
    {
      title: "Get pipeline (with steps)",
      description:
        "Get one pipeline's summary plus its ordered steps. Composed from GET /api/pipelines/:id " +
        "(summary; carries no steps) and GET /api/pipelines/:id/steps.",
      inputSchema: { pipelineId: z.string().min(1) },
    },
    ({ pipelineId }) => guarded(() => api.getPipeline(pipelineId)),
  );

  server.registerTool(
    "analyze_pipeline",
    {
      title: "Analyze pipeline",
      description:
        "Analyze a pipeline: returns the source schema and, per step, its input/output schema and any " +
        "validation error. This is how you learn the exact columns the output DataType will have " +
        "before running it.",
      inputSchema: { pipelineId: z.string().min(1) },
    },
    ({ pipelineId }) => guarded(() => api.analyzePipeline(pipelineId)),
  );

  server.registerTool(
    "list_connectors",
    {
      title: "List connectors",
      description:
        "List every registered connector kind (csv/rest_api/sql/static/text/pdf/image) with its " +
        "capability metadata: displayName, whether it supports incremental refresh, its auth model, " +
        "and requiredFields (name/label/secret descriptors, no values). Call this before a " +
        "create_*_data_source tool to learn what a connector kind needs.",
      inputSchema: {},
    },
    () => guarded(() => api.listConnectors()),
  );

  server.registerTool(
    "get_workspace_context",
    {
      title: "Get workspace context",
      description:
        "One compact snapshot of the whole workspace: data sources, DataTypes (with columns), " +
        "pipelines (with steps and per-step output columns), and dashboards. Read this first to " +
        "reason about what exists (e.g. which DataType is a single-row pipeline output) instead of " +
        "fanning out many calls yourself. Same payload as the helio://workspace/context resource.",
      inputSchema: {},
    },
    () => guarded(() => buildWorkspaceContext(api)),
  );
}
