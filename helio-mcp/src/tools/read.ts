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
import type { ConnectorSummary } from "../types.js";

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

/** HEL-886 design.md Decision 5: builds `list_connectors`' result -- the JSON payload stays a
 *  bare `ConnectorSummary[]` array (unchanged, so the existing "empty list" spec scenario and
 *  every consumer of the shape are unaffected); when the list is empty a SECOND text content
 *  block is appended naming `create_connector`, never merged into the JSON block. Exported and
 *  pure (no `guarded`/HTTP concern) so a unit test can exercise it directly. */
export function buildListConnectorsResult(items: ConnectorSummary[]): CallToolResult {
  const result = jsonResult(items);
  if (items.length !== 0) return result;
  return {
    ...result,
    content: [
      ...result.content,
      {
        type: "text",
        text:
          "No Connectors exist yet. Call create_connector to create one — it creates " +
          "unauthenticated (authType: none) Connectors only; a credentialed host is " +
          "completed by a human at the in-app /connectors page.",
      },
    ],
  };
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
        "nor GET /api/dashboards/:id/panels. Each panel includes its title, type, typed config " +
        "(the config carries the bound DataType id + field mapping for data panels), and a stable " +
        "`id` (the panel's real, non-remapped id) — use `id` for programmatic identification.",
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
        "DataSource → Pipeline → DataType → Panel. Discriminated on `type`. Each entry's `tag` " +
        "(HEL-366, omitted when unset) is its free-form grouping key. Optional `tag` param " +
        "restricts to the caller's sources with an exact tag match — a preview of exactly what " +
        "teardown_resources would discover for that tag, without deleting anything.",
      inputSchema: {
        limit: z.number().int().positive().max(500).optional(),
        offset: z.number().int().nonnegative().optional(),
        tag: z.string().min(1).optional(),
      },
    },
    ({ limit, offset, tag }) => guarded(() => api.listDataSources(limit, offset, tag)),
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

  // HEL-907 task 3.7/3.9: get_panel_capabilities REMOVED outright (no alias) -- it called
  // GET /api/types/:id/panel-capabilities, a route HEL-904 deleted alongside DataTypeRoutes;
  // every call has 404'd since then. Replaced by get_output_capabilities(pipelineId, stepId?)
  // in tools/outputs.ts, which calls the route that actually exists
  // (GET /api/pipelines/:id/capabilities?stepId=, HEL-906 task 3.4).

  server.registerTool(
    "list_pipelines",
    {
      title: "List pipelines",
      description:
        "List pipelines as summaries (source, last-run status/row-count). Pipelines are the only " +
        "path that produces panel-bindable Outputs (see get_workspace_context / list_outputs). " +
        "Use get_pipeline or " +
        "analyze_pipeline for step detail. Each entry's `tag` (HEL-366, omitted when unset) is its " +
        "free-form grouping key. Optional `tag` param restricts to the caller's pipelines with an " +
        "exact tag match — a preview of exactly what teardown_resources would discover for that " +
        "tag, without deleting anything.",
      inputSchema: {
        tag: z.string().min(1).optional(),
      },
    },
    ({ tag }) => guarded(() => api.listPipelines(tag)),
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
        "validation error. This is how you learn the exact columns an Output attached to a given " +
        "step (or the source, for nodeStepId: null) will have " +
        "before running it.",
      inputSchema: { pipelineId: z.string().min(1) },
    },
    ({ pipelineId }) => guarded(() => api.analyzePipeline(pipelineId)),
  );

  server.registerTool(
    "list_connector_types",
    {
      title: "List connector types",
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
    "list_connectors",
    {
      title: "List connectors",
      description:
        "List the caller's real Connectors: id, name, kind, and host (base host/origin) only. " +
        "Distinct from list_connector_types, which lists connector KIND capability metadata, not " +
        "instances. Credentials are NEVER returned by this or any tool, in any form, including " +
        "partially masked — do not waste turns trying to retrieve one. Call this before " +
        "create_rest_data_source to obtain a connectorId to author against. If this returns " +
        "empty, call create_connector to create one (unauthenticated hosts only).",
      inputSchema: {},
    },
    async () => {
      try {
        return buildListConnectorsResult(await api.listConnectorInstances());
      } catch (err) {
        const message =
          err instanceof HelioApiError
            ? `${err.name} (status ${err.status}) for ${err.url}: ${err.message}`
            : `${(err as Error)?.name ?? "Error"}: ${(err as Error)?.message ?? String(err)}`;
        return { content: [{ type: "text", text: message }], isError: true };
      }
    },
  );

  server.registerTool(
    "list_pipeline_shapes",
    {
      title: "List pipeline shapes",
      description:
        "List every registered smart pipeline shape (GET /api/pipeline-shapes; thin pass-through). " +
        "A shape is a named, parameterized pipeline template that expands into an ordered list of " +
        "ordinary pipeline steps via add_outputs_from_shape, instead of hand-assembling them " +
        "with add_pipeline_step. Each catalog entry carries id/label/description/paramsSchema " +
        "(descriptive only — NOT a validating JSON Schema; real validation happens inside " +
        "add_outputs_from_shape's expand call, whose message is returned verbatim on failure) " +
        "and outputContract (rowCount + description; the rowCount/description text carries the " +
        "real signal about the shape's output). Registered shape ids on `main`: " +
        "`passthrough` (params: fields: string[] — selects those fields, one `select` step), " +
        '`single-row` (params: mode: "aggregate"|"filter", plus measures: {fn,field,alias}[] ' +
        "for aggregate mode or conditions: {field,operator,value}[] + optional combinator for " +
        "filter mode — reduces to exactly one row), " +
        '`top-n` (params: measure: string, direction: "asc"|"desc", n: integer, optional ' +
        "ties — sorts by measure and keeps the top/bottom N rows via sort + limit), " +
        '`time-series` (params: timeField: string, granularity: "day"|"week"|"month"|' +
        '"quarter"|"year", measures: {fn,field,alias}[] — buckets timeField and aggregates ' +
        "measures per bucket via datebucket + aggregate + sort), " +
        "`pivot-matrix` (params: index: string[], column: string, values: string, agg: " +
        '"sum"|"count"|"avg"|"min"|"max"|"first" — reshapes into a crosstab via an ' +
        "optional pre-aggregate then pivot). Call " +
        "add_outputs_from_shape(pipelineId, stepId?, shape, params) with one of these ids to " +
        "instantiate it onto an existing pipeline.",
      inputSchema: {},
    },
    () => guarded(() => api.listPipelineShapes()),
  );

  server.registerTool(
    "get_workspace_context",
    {
      title: "Get workspace context",
      description:
        "One compact snapshot of the whole workspace: data sources (with their inferredSchema, " +
        "name/type pairs), pipelines (with steps, per-step output columns, and their Outputs — " +
        "id/name/kind/nodeStepId/schema/placements — the panel-bindable surface a create_content_panel " +
        "or place_outputs call targets), dashboards, and the pipelineShapes catalog " +
        "(id/label/description/paramsSchema/outputRowCount/outputDescription for every registered " +
        "smart pipeline shape — see list_pipeline_shapes / add_outputs_from_shape). There is no " +
        "DataType/Metric catalog here (HEL-904 retired that model) — an Output's own schema is the " +
        "grounding source for a fieldMapping. Each pipeline entry's lastRunAssertions (HEL-581) is " +
        "the trustworthiness signal for whether that pipeline's MOST RECENT run's data can be " +
        "trusted: passed/warnFailed/errorFailed counts plus a failures list " +
        "(kind/field/severity/message) naming which assert rules failed. Reason about a dashboard's " +
        "data quality by checking a bound Output's producing pipeline's lastRunAssertions.errorFailed " +
        "before treating its last run's rows as reliable — always present and zero-valued (not " +
        "omitted) for a pipeline with no assert step or no runs yet. Also includes agentContext: the " +
        "authenticated token owner's stored agent-authoring preferences plus up to 20 of their " +
        "most-recently-useful memory entries (facts/goals/preference-notes), most-recently-useful " +
        "first — read this to reason about how the user generally likes dashboards built, without a " +
        "separate call. Fetching it never updates any memory entry's lastUsedAt (a pure read). " +
        "Read this first to reason about what exists (e.g. which Output is single-row, which shape " +
        "ids are available, or which pipeline already produces a needed field) instead of fanning " +
        "out many calls yourself. Same payload as the helio://workspace/context resource.",
      inputSchema: {},
    },
    () => guarded(() => buildWorkspaceContext(api)),
  );
}
