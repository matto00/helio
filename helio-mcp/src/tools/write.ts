/**
 * Registers the Phase-3 write/composition tools. Each tool is a thin call to an
 * existing Helio endpoint and returns the created resource (with its id) so an
 * agent can chain the canonical path DataSource → Pipeline → DataType → Panel
 * without re-listing. No business logic lives here — the backend owns
 * validation (including the V41 pipeline-only binding rule, whose 400 is
 * surfaced verbatim).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { HelioApi } from "../helioApi.js";
import { HelioApiError } from "../httpClient.js";

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

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

export function registerWriteTools(server: McpServer, api: HelioApi): void {
  server.registerTool(
    "create_data_source",
    {
      title: "Create data source (static)",
      description:
        "Create a `static` data source from inline columns + rows — the root of the canonical path " +
        "DataSource → Pipeline → DataType → Panel. The backend auto-creates a source-companion " +
        "DataType (NOT panel-bindable); build a pipeline over the returned source id to produce a " +
        "bindable output type. Returns the created source id. For a real integration use " +
        "create_csv_data_source, create_rest_data_source, or create_sql_data_source instead.",
      inputSchema: {
        name: z.string().min(1),
        columns: z.array(z.object({ name: z.string().min(1), type: z.string().min(1) })).min(1),
        rows: z.array(z.array(z.unknown())),
      },
    },
    ({ name, columns, rows }) =>
      guarded(() => api.createDataSource({ name, columns, rows: rows as unknown[][] })),
  );

  server.registerTool(
    "create_csv_data_source",
    {
      title: "Create data source (CSV)",
      description:
        "Create a `csv` data source from inline CSV text content — no filesystem access from the " +
        "MCP process required. Posts the content as a multipart upload to the same endpoint the " +
        "UI's file-upload flow uses. Like `static`, the backend auto-creates a source-companion " +
        "DataType (NOT returned inline — inspect it via list_source_objects); build a pipeline over " +
        "the returned source id to produce a panel-bindable output type.",
      inputSchema: {
        name: z.string().min(1),
        content: z.string().min(1),
      },
    },
    ({ name, content }) => guarded(() => api.createCsvDataSource({ name, content })),
  );

  const restAuthSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("none") }),
    z.object({ type: z.literal("bearer"), token: z.string().min(1) }),
    z.object({
      type: z.literal("api_key"),
      name: z.string().min(1),
      value: z.string().min(1),
      in: z.enum(["header", "query"]),
    }),
  ]);

  server.registerTool(
    "create_rest_data_source",
    {
      title: "Create data source (REST API)",
      description:
        "Create a `rest_api` data source. The backend attempts an initial fetch at creation time: " +
        "on success the response includes the auto-created companion DataType; on failure it returns " +
        "dataType: null and a fetchError message instead of an opaque error, so a bad URL or " +
        "credential can be diagnosed and retried. Bearer tokens / api-key values are redacted by the " +
        "backend and never appear in this tool's result. Build a pipeline over the returned source id " +
        "to produce a panel-bindable output type.",
      inputSchema: {
        name: z.string().min(1),
        url: z.string().min(1),
        method: z.string().optional(),
        headers: z.record(z.string()).optional(),
        auth: restAuthSchema.optional(),
      },
    },
    ({ name, url, method, headers, auth }) =>
      guarded(() => api.createRestDataSource({ name, url, method, headers, auth })),
  );

  server.registerTool(
    "create_sql_data_source",
    {
      title: "Create data source (SQL)",
      description:
        "Create a `sql` data source. `query` MUST be a read-only SELECT — the backend rejects " +
        "DDL/DML keywords (CREATE, DROP, ALTER, DELETE, INSERT, UPDATE, TRUNCATE) verbatim and no " +
        "source is created if rejected. The backend runs the query once at creation time: on success " +
        "the response includes the auto-created companion DataType; on failure it returns " +
        "dataType: null and a fetchError message. The password is redacted server-side and never " +
        "appears in this tool's result. Build a pipeline over the returned source id to produce a " +
        "panel-bindable output type.",
      inputSchema: {
        name: z.string().min(1),
        dialect: z.string().min(1),
        host: z.string().min(1),
        port: z.number().int(),
        database: z.string().min(1),
        user: z.string().min(1),
        password: z.string(),
        query: z.string().min(1),
      },
    },
    ({ name, dialect, host, port, database, user, password, query }) =>
      guarded(() =>
        api.createSqlDataSource({ name, dialect, host, port, database, user, password, query }),
      ),
  );

  server.registerTool(
    "create_pipeline",
    {
      title: "Create pipeline",
      description:
        "Create a pipeline from a source. Creates a NEW pipeline-output DataType named " +
        "`outputDataTypeName` (this is the panel-bindable type). Returns the pipeline summary " +
        "including `id` and `outputDataTypeId`. Add steps with add_pipeline_step, then run_pipeline.",
      inputSchema: {
        name: z.string().min(1),
        sourceDataSourceId: z.string().min(1),
        outputDataTypeName: z.string().min(1),
      },
    },
    ({ name, sourceDataSourceId, outputDataTypeName }) =>
      guarded(() => api.createPipeline({ name, sourceDataSourceId, outputDataTypeName })),
  );

  server.registerTool(
    "add_pipeline_step",
    {
      title: "Add pipeline step",
      description:
        "Append a transform step to a pipeline. `type` is one of rename/filter/join/compute/" +
        "groupBy/cast/select/limit/sort/aggregate; `config` shape is keyed by `type` (e.g. " +
        "limit → {count}, select → {fields:[…]}, sort → {sortBy:[{field,direction}]}). Use " +
        "analyze_pipeline to see each step's resulting output columns.",
      inputSchema: {
        pipelineId: z.string().min(1),
        type: z.string().min(1),
        config: z.record(z.unknown()).default({}),
      },
    },
    ({ pipelineId, type, config }) =>
      guarded(() => api.addPipelineStep(pipelineId, { type, config })),
  );

  server.registerTool(
    "run_pipeline",
    {
      title: "Run pipeline",
      description:
        "Run a pipeline to completion and write rows to its output DataType. The run is " +
        "SYNCHRONOUS: this returns only once rows exist, so it is safe to bind a panel immediately " +
        "after. Returns { status, rowCount, outputDataTypeId }. Set dry=true to validate without " +
        "persisting rows.",
      inputSchema: {
        pipelineId: z.string().min(1),
        dry: z.boolean().default(false),
      },
    },
    ({ pipelineId, dry }) => guarded(() => api.runPipeline(pipelineId, dry)),
  );

  server.registerTool(
    "create_dashboard",
    {
      title: "Create dashboard",
      description: "Create an empty dashboard. Returns its id (add panels with create_panel).",
      inputSchema: { name: z.string().min(1) },
    },
    ({ name }) => guarded(() => api.createDashboard({ name })),
  );

  server.registerTool(
    "create_panel",
    {
      title: "Create panel",
      description:
        "Create a panel on a dashboard. `type` ∈ metric/chart/table/text/markdown/image/divider. " +
        "For data panels (metric/chart/table) create it then bind_panel to a pipeline-output " +
        "DataType; for text/markdown pass config.content. Returns the panel id.",
      inputSchema: {
        dashboardId: z.string().min(1),
        title: z.string().optional(),
        type: z
          .enum(["metric", "chart", "table", "text", "markdown", "image", "divider"])
          .optional(),
        config: z.record(z.unknown()).optional(),
      },
    },
    ({ dashboardId, title, type, config }) =>
      guarded(() => api.createPanel({ dashboardId, title, type, config })),
  );

  server.registerTool(
    "bind_panel",
    {
      title: "Bind panel to a DataType",
      description:
        "Bind a metric/chart/table panel to a pipeline-output DataType and set its field mapping. " +
        "fieldMapping keys by panel type: metric → {value,label?,unit?}; chart → {xAxis,yAxis,series?}; " +
        "table → {columns}. The DataType MUST be a pipeline output (sourceId null); binding a source " +
        "companion is rejected with 400 (V41). Pass panelType to match the panel's type.",
      inputSchema: {
        panelId: z.string().min(1),
        dataTypeId: z.string().min(1),
        fieldMapping: z.record(z.string()),
        panelType: z.enum(["metric", "chart", "table"]).optional(),
      },
    },
    ({ panelId, dataTypeId, fieldMapping, panelType }) =>
      guarded(() => api.bindPanel(panelId, { dataTypeId, fieldMapping, panelType })),
  );

  server.registerTool(
    "update_panel_appearance",
    {
      title: "Update panel appearance",
      description:
        "Update a panel's appearance (background, color, transparency 0–1, and chart appearance). " +
        "Partial — only the provided fields change.",
      inputSchema: {
        panelId: z.string().min(1),
        appearance: z.record(z.unknown()),
      },
    },
    ({ panelId, appearance }) => guarded(() => api.updatePanelAppearance(panelId, appearance)),
  );

  // ── Delete tools ──────────────────────────────────────────────────────────
  // Each wraps a backend DELETE (204 No Content). Deletion is PERMANENT and
  // owner-scoped; the backend's 403 (not owner) / 404 (unknown id) is surfaced
  // verbatim by `guarded`. On success the tool returns `{ deleted: true, id }`.

  server.registerTool(
    "delete_dashboard",
    {
      title: "Delete dashboard",
      description:
        "Permanently delete a dashboard (DELETE /api/dashboards/:id). This CASCADES: all of the " +
        "dashboard's panels are deleted with it. Data sources, pipelines, and DataTypes are NOT " +
        "affected. Owner-only — a non-owner gets 403, an unknown id 404. Irreversible.",
      inputSchema: { dashboardId: z.string().min(1) },
    },
    ({ dashboardId }) => guarded(() => api.deleteDashboard(dashboardId)),
  );

  server.registerTool(
    "delete_data_source",
    {
      title: "Delete data source",
      description:
        "Permanently delete a data source (DELETE /api/data-sources/:id). This CASCADES to any " +
        "pipeline built on this source — and transitively that pipeline's steps, run history, and " +
        "output DataType. The source's own companion DataType is not deleted (its sourceId is " +
        "cleared). Irreversible — prefer deleting dependent pipelines/dashboards first if you want " +
        "to control the blast radius.",
      inputSchema: { dataSourceId: z.string().min(1) },
    },
    ({ dataSourceId }) => guarded(() => api.deleteDataSource(dataSourceId)),
  );

  server.registerTool(
    "delete_data_type",
    {
      title: "Delete data type",
      description:
        "Permanently delete a DataType (DELETE /api/types/:id). If it is a pipeline OUTPUT type this " +
        "CASCADES to the pipeline that produces it (and that pipeline's steps and run history). Any " +
        "panels bound to this DataType are unbound (not deleted). Irreversible.",
      inputSchema: { dataTypeId: z.string().min(1) },
    },
    ({ dataTypeId }) => guarded(() => api.deleteDataType(dataTypeId)),
  );

  server.registerTool(
    "delete_panel",
    {
      title: "Delete panel",
      description:
        "Permanently delete a single panel from its dashboard (DELETE /api/panels/:id). Does not " +
        "affect the dashboard or the DataType the panel was bound to. Irreversible.",
      inputSchema: { panelId: z.string().min(1) },
    },
    ({ panelId }) => guarded(() => api.deletePanel(panelId)),
  );

  server.registerTool(
    "delete_pipeline",
    {
      title: "Delete pipeline",
      description:
        "Permanently delete a pipeline (DELETE /api/pipelines/:id). This CASCADES to the pipeline's " +
        "steps and run history. Its output DataType is NOT deleted (delete it separately with " +
        "delete_data_type if you also want to remove the bindable type). Owner-only. Irreversible.",
      inputSchema: { pipelineId: z.string().min(1) },
    },
    ({ pipelineId }) => guarded(() => api.deletePipeline(pipelineId)),
  );

  server.registerTool(
    "delete_pipeline_step",
    {
      title: "Delete pipeline step",
      description:
        "Permanently delete a single pipeline transform step (DELETE /api/pipeline-steps/:stepId). " +
        "NOTE: a step is addressed by its OWN id at a flat top-level path, not nested under its " +
        "pipeline — pass the step id (from get_pipeline / add_pipeline_step), not the pipeline id. " +
        "Re-run the pipeline afterward to reflect the change. Irreversible.",
      inputSchema: { stepId: z.string().min(1) },
    },
    ({ stepId }) => guarded(() => api.deletePipelineStep(stepId)),
  );
}
