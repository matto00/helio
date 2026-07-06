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
        "bindable output type. Returns the created source id. (CSV/REST/SQL sources are created via " +
        "their own endpoints and are out of this tool's scope.)",
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
}
