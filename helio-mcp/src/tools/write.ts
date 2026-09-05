/**
 * Registers the Phase-3 write/composition tools. Each tool is a thin call to an
 * existing Helio endpoint and returns the created resource (with its id) so an
 * agent can chain the canonical path Source → Pipeline → Output → Dashboard
 * (HEL-903/904/907; DataType/Metric retired outright, no wire trace remains)
 * without re-listing. No business logic lives here — the backend owns
 * validation.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { HelioApi } from "../helioApi.js";
import { HelioApiError } from "../httpClient.js";
import type { ProposalPanel } from "../types.js";
import { addPipelineStepHandler } from "./assertSchemas.js";
import { createConnectorSchema } from "./connectorSchema.js";
import {
  augmentFetchErrorWithConnectorsHint,
  createConnectorHandler,
} from "./connectorHandlers.js";
import { assertExactlyOneCsvInput } from "./csvDataSourceSchema.js";
import { panelSchema } from "./proposal.js";
import { createRestDataSourceSchema } from "./restDataSourceSchema.js";
import {
  DELETE_PIPELINE_SCHEDULE_DESCRIPTION,
  deletePipelineScheduleHandler,
  GET_PIPELINE_SCHEDULE_DESCRIPTION,
  getPipelineScheduleHandler,
  SET_PIPELINE_SCHEDULE_DESCRIPTION,
  setPipelineScheduleHandler,
  UPDATE_DASHBOARD_DESCRIPTION,
  updateDashboardHandler,
} from "./scheduleTools.js";
import { buildUpdatePanelBody, buildUpdatePipelineStepBody } from "./updateSchemas.js";

// HEL-907 task 3.6: `boundPipelineStepSchema` REMOVED outright -- its only real caller,
// create_bound_panel, is retired (see below); pipelineProposal.ts owns its own separate,
// clientId/parentStepId-bearing step schema now.

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
        "Source → Pipeline → Output → Dashboard. Returns the created source id ONLY -- this tool " +
        "creates no pipeline and no Output; build a pipeline over the returned source id " +
        "(create_pipeline) with an `outputs[]` entry if a panel-bindable projection is needed, or " +
        "add_output onto an existing pipeline afterward. For a real integration use " +
        "create_csv_data_source, create_rest_data_source, or create_sql_data_source instead. " +
        "Optional `tag` (HEL-366, free-form grouping key, max 200 chars) lets a whole workflow " +
        "run's resources be torn down together later with teardown_resources.",
      inputSchema: {
        name: z.string().min(1),
        columns: z.array(z.object({ name: z.string().min(1), type: z.string().min(1) })).min(1),
        rows: z.array(z.array(z.unknown())),
        tag: z.string().min(1).max(200).optional(),
      },
    },
    ({ name, columns, rows, tag }) =>
      guarded(() => api.createDataSource({ name, columns, rows: rows as unknown[][], tag })),
  );

  server.registerTool(
    "create_csv_data_source",
    {
      title: "Create data source (CSV)",
      description:
        "Create a `csv` data source from EITHER inline CSV text content OR an HTTPS `sourceUrl` — " +
        "exactly one of `content`/`sourceUrl` is required; supplying neither or both fails before " +
        "any HTTP call, naming both arguments. `content` — no filesystem access from the MCP " +
        "process required — posts as a multipart upload to the same endpoint the UI's file-upload " +
        "flow uses; that source's refresh always re-reads the originally-uploaded content, and it " +
        "cannot refresh on a schedule. `sourceUrl` MUST be `https` (an internal/link-local address " +
        "is also rejected); the backend fetches it at create time, and — unlike `content` — a " +
        "URL-backed source RE-FETCHES the URL on every manual refresh AND on every scheduled " +
        "pipeline run, so it is the only variant that reflects upstream changes automatically. This " +
        "tool accepts NO caller-supplied filesystem `path` of any kind — only `content` or " +
        "`sourceUrl`. Returns the created source id ONLY -- creates no pipeline and no Output; " +
        "build a pipeline over the returned source id (create_pipeline) with an `outputs[]` entry " +
        "if a panel-bindable projection is needed, or add_output onto an existing pipeline " +
        "afterward. Optional `tag` (HEL-366, free-form grouping key, max 200 chars) lets a whole " +
        "workflow run's resources be torn down together later with teardown_resources.",
      inputSchema: {
        name: z.string().min(1),
        content: z.string().min(1).optional(),
        sourceUrl: z.string().min(1).optional(),
        tag: z.string().min(1).max(200).optional(),
      },
    },
    ({ name, content, sourceUrl, tag }) =>
      guarded(() => {
        assertExactlyOneCsvInput(content, sourceUrl);
        return api.createCsvDataSource({ name, content, sourceUrl, tag });
      }),
  );

  server.registerTool(
    "create_connector",
    {
      title: "Create connector (unauthenticated hosts only)",
      description:
        "Create a Connector for an UNAUTHENTICATED host only (authType: none) — the one gap that " +
        "blocks an MCP-only client from authoring a REST source from a clean workspace (HEL-886). " +
        "This tool accepts NO credential under any key: `auth`/`apiKey`/`token`/`password`/" +
        "`credential` are all REJECTED with a validation error, and credentials are never returned " +
        'by this or any tool. If the host actually needs a credential, pass `authType: "bearer"` ' +
        'or `"api_key"` to get an actionable refusal naming the human-completed path — no ' +
        "Connector is created in that case. `kind` defaults to `rest_api`. On success the result " +
        "carries a constant `note`: if the host in fact requires authentication, requests through " +
        "it will fail with 401/403 and a human must create a credentialed Connector at " +
        "/connectors — this applies even when `authType` was omitted and defaulted to `none`. " +
        "Use the returned `id` as `connectorId` for create_rest_data_source.",
      inputSchema: createConnectorSchema,
    },
    (input) => createConnectorHandler(api, input),
  );

  server.registerTool(
    "create_rest_data_source",
    {
      title: "Create data source (REST API)",
      description:
        "Create a `rest_api` data source against an existing Connector — call list_connectors first " +
        "to obtain a connectorId, or create_connector if none exist yet (unauthenticated hosts " +
        "only). This tool accepts NO url or auth/credential field of any kind — " +
        "the Connector's configured auth is resolved and applied server-side, never passed through " +
        "this call, and credentials are never returned by this or any tool. An `auth`/`apiKey`/`token`/" +
        "`password`/`credential` field is REJECTED with a validation error naming connectorId, not " +
        "silently dropped. The backend attempts an " +
        "initial fetch at creation time: on success the response includes the re-inferred " +
        "`inferredSchema`; on failure it returns `inferredSchema: null` and a fetchError message " +
        "instead of an opaque error (a 401/403 fetchError additionally names the /connectors " +
        "out-of-band path, since it means the Connector needs a credential a human must supply), " +
        "so a bad endpoint can be diagnosed and retried. Build a " +
        "pipeline over the returned source id (create_pipeline, with an `outputs[]` entry) to " +
        "produce a panel-bindable Output. `queryParams` (HEL-982) accepts EITHER a JSON object " +
        "(unique keys only) OR an ordered `[{name, value}]` array — use the array form to " +
        "express a repeated key (e.g. `?tag=a&tag=b`) or to control the order query params are " +
        "sent in; the object form cannot express either.",
      inputSchema: createRestDataSourceSchema,
    },
    ({
      name,
      connectorId,
      endpoint,
      method,
      queryParams,
      headers,
      body,
      bodyContentType,
      rootSelector,
    }) =>
      guarded(async () => {
        const result = await api.createRestDataSource({
          name,
          connectorId,
          endpoint,
          method,
          queryParams,
          headers,
          body,
          bodyContentType,
          rootSelector,
        });
        return { ...result, fetchError: augmentFetchErrorWithConnectorsHint(result.fetchError) };
      }),
  );

  server.registerTool(
    "create_sql_data_source",
    {
      title: "Create data source (SQL)",
      description:
        "Create a `sql` data source. `query` MUST be a read-only SELECT — the backend rejects " +
        "DDL/DML keywords (CREATE, DROP, ALTER, DELETE, INSERT, UPDATE, TRUNCATE) verbatim and no " +
        "source is created if rejected. The backend runs the query once at creation time: on success " +
        "the response includes the re-inferred `inferredSchema`; on failure it returns " +
        "`inferredSchema: null` and a fetchError message. The password is redacted server-side and " +
        "never appears in this tool's result. Build a pipeline over the returned source id " +
        "(create_pipeline, with an `outputs[]` entry) to produce a panel-bindable Output.",
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

  // HEL-907 task 3.2: create_pipeline REMOVED from here (no alias) -- rewritten onto the
  // Outputs model in its own file, tools/pipelines.ts (registerPipelineTools), since its shape
  // changed materially (sourceId OR inline source, steps[] with parentStepId, optional
  // outputs[]) rather than a small in-place patch.

  server.registerTool(
    "add_pipeline_step",
    {
      title: "Add pipeline step",
      description:
        "Append a transform step to a pipeline. `type` is one of rename/filter/join/compute/" +
        "groupBy/cast/select/limit/sort/aggregate/datebucket/pivot/window/unpivot/dedupe/fillnull/" +
        "stringops/union/lookup; `config` shape is " +
        "keyed by `type` (e.g. limit → {count}, select → {fields:[…]}, sort → {sortBy:[{field,direction}]}, " +
        "datebucket → {field, granularity: 'day'|'week'|'month'|'quarter'|'year', outputColumn?} " +
        "— floors `field` to the start of the granularity bucket in UTC, writing the result to " +
        "`outputColumn` if given, else overwriting `field` in place; " +
        "pivot → {index: string[], column, values, agg: 'sum'|'count'|'avg'|'min'|'max'|'first'} " +
        "— groups rows by `index`, and for each distinct value of `column` emits an output column " +
        "named `<values>_<value>` holding `agg` applied to `values` for that group+value; the " +
        "dynamic `<values>_<value>` columns are data-dependent and do NOT appear in " +
        "analyze_pipeline's output schema — only the `index` fields do; " +
        "window → {partitionBy: string[], orderBy: [{field,direction}], " +
        "function: 'row_number'|'rank'|'dense_rank'|'running_sum'|'lag'|'lead', field?, " +
        "outputColumn, offset?} — partitions rows by `partitionBy`, orders each partition by " +
        "`orderBy`, and appends `outputColumn` per row (row count is preserved, unlike pivot). " +
        "`field` is required by running_sum/lag/lead (ignored by the rank family); `offset` " +
        "(default 1) is used by lag/lead only. `outputColumn`'s type is statically knowable and " +
        "DOES appear in analyze_pipeline's output schema — integer for row_number/rank/dense_rank, " +
        "number for running_sum, same type as `field` for lag/lead); " +
        "unpivot → {idVars: string[], valueVars: string[], varName?, valueName?} — the inverse of " +
        "pivot: for each input row, emits one output row per `valueVars` entry, carrying `idVars` " +
        "unchanged plus `varName` (default 'variable') = the source column's name and `valueName` " +
        "(default 'value') = that column's cell value. Row count multiplies: (input rows) * " +
        "(valueVars length). Unlike pivot, unpivot's output schema is fully static and DOES appear " +
        "in analyze_pipeline's output schema — idVars (types carried through) + varName (string) + " +
        "valueName (the common type of valueVars if uniform, else string); " +
        "dedupe → {keys: string[], keep?: 'first'|'last'} — removes duplicate rows. Empty `keys` " +
        "(default) compares whole rows (distinct); non-empty `keys` compares only those fields' " +
        "values. `keep` (default 'first') selects which occurrence survives — 'first' or 'last' by " +
        "original row order; only the literal 'last' selects last-occurrence, anything else falls " +
        "back to 'first'. Output preserves the relative order of kept rows. Pure row filter — output " +
        "schema equals input schema (identity, like limit); " +
        "fillnull → {columns: string[], strategy: 'constant'|'forwardFill'|'mean'|'median'|'mode', " +
        "value?: string} — replaces only null cells (missing key or explicit null) in `columns`; " +
        "non-null cells and unlisted columns pass through unchanged. `constant` fills with `value` " +
        "(required for this strategy, fails otherwise); `forwardFill` carries the last non-null " +
        "value seen so far per column in original row order (a leading null run stays null); " +
        "`mean`/`median`/`mode` compute one value per column over the batch's non-null values " +
        "(mean/median coerce numerically, non-numeric values excluded; mode uses raw values, ties " +
        "broken by first-encountered order) and use it to fill every null cell in that column — an " +
        "all-null column stays null, never a hard failure. Schema-preserving — output schema equals " +
        "input schema (identity, like cast); " +
        "stringops → {operation: 'trim'|'upper'|'lower'|'split'|'extractRegex'|'concat', field, " +
        "outputColumn, pattern?, separator?, index?, fields?} — a per-value column transform " +
        "writing a derived string to `outputColumn` (row count unchanged; distinct from the " +
        "row-exploding `splittext` op). `outputColumn` equal to `field` overwrites the source " +
        "column in place, otherwise appends a distinct column — and DOES appear in " +
        "analyze_pipeline's output schema, typed string. `trim`/`upper`/`lower` transform `field`'s " +
        "value directly (null/absent `field` yields null). `split` splits `field`'s value by the " +
        "literal (non-regex) `separator` and takes the `index`-th segment (both required; an " +
        "out-of-bounds `index` yields null for that row). `extractRegex` extracts `pattern`'s first " +
        "capturing group from `field`'s value (`pattern` MUST contain a capturing group — fails at " +
        "execute time otherwise; no match yields null). `concat` joins `fields` (string[]) with " +
        "`separator`, treating a null/missing field as an empty string (never whole-output null) — " +
        "`field` is unused by concat. An unsupported `operation` fails at execute time naming the " +
        "six supported values; " +
        "union → {secondaryInput: {kind:'source',dataSourceId} | {kind:'lane',stepId}, " +
        "mode: 'byPosition'|'byName'} — the second async/repo-touching op (like join): " +
        "`secondaryInput.kind:'source'` resolves `dataSourceId` as a second DataSource (pipeline " +
        "ACL is the gate, mirroring join); `kind:'lane'` resolves another step's already-evaluated " +
        "rows within the SAME pipeline (no DataSource lookup, no ACL check — same-pipeline " +
        "membership is the whole gate; a stepId belonging to another pipeline, or forming a cycle " +
        "with this step's own ancestors, is rejected at write time). Either way the resolved rows " +
        "stack onto the current row set. `byPosition` (default) appends rows as-is with no column " +
        "reconciliation — use when both sides share identical columns. `byName` unions the two " +
        "sides' column sets (derived from each side's first row) and backfills a column missing on " +
        "either side with null for that side's rows. Row count is additive; output schema is a " +
        "best-effort passthrough of the input schema — verify the union's actual shape with " +
        "preview/run rather than trusting the analyzed schema. A missing/unresolvable " +
        "`secondaryInput` or an unrecognized `mode` fails at execute time naming the problem. " +
        "There is NO legacy flat `otherDataSourceId` field — a config carrying it is rejected " +
        "outright, not silently upgraded; " +
        "lookup → {secondaryInput: {kind:'source',dataSourceId} | {kind:'lane',stepId}, sourceKey, " +
        "lookupKey, columns: string[]} — a constrained single-key left-join against the resolved " +
        "second input (same `secondaryInput` semantics as union above), bringing in only the named " +
        "`columns` (every other field from the second input is dropped). For each row, `sourceKey`'s " +
        "value is matched against `lookupKey` on the second input's rows; a match brings in " +
        "`columns`' values, overwriting any colliding field on the current row; multiple matches " +
        "use only the first (no row multiplication); no match null-fills `columns` (row preserved " +
        "— a true left join, row count never changes). `columns` DOES appear in analyze_pipeline's " +
        "output schema, appended typed string as a documented best-effort. A missing/unresolvable " +
        "`secondaryInput` fails at execute time naming the problem. There is NO legacy flat " +
        "`referenceDataSourceId` field — a config carrying it is rejected outright; " +
        "assert → {rules: [{kind, field?, params, severity}]} — evaluates data-trustworthiness " +
        "rules against the rows at this step's position and records one pass/fail result per rule " +
        "(row data itself passes through unchanged; results surface later via " +
        "get_workspace_context's lastRunAssertions). Six v1 `kind`s, each with its own required " +
        "`field`/`params` shape (validated client-side by a dedicated Zod schema BEFORE any " +
        "network call — an invalid rule shape is rejected with no request reaching the backend): " +
        "notNull {field} — fails if `field` is null/absent on any row (params: {}); " +
        "unique {field} — fails if any two rows share the same non-null `field` value (params: {}); " +
        "range {field, params: {min?, max?}} — fails if `field`'s numeric value falls outside the " +
        "given bound(s) (at least one of min/max required); " +
        "rowCountMin {params: {count}} / rowCountMax {params: {count}} — dataset-level row-count " +
        "checks; `field` is NOT used and must be omitted for these two kinds; " +
        "regex {field, params: {pattern}} — fails if `field`'s value doesn't match `pattern` " +
        "(partial match, like String.find). Every rule additionally requires `severity`: " +
        '"warn" or "error". Use analyze_pipeline to ' +
        "see each step's resulting output columns. Optional parentStepId (HEL-907 task 3.3) " +
        "splices the new step in directly after that EXISTING step id, branching a NEW tail off " +
        "any existing node -- absent extends the trunk (unchanged default). Optional rootId " +
        "(HEL-913 task 9.5, multi-root only) is the alternative anchor: for a PARENTLESS step, " +
        "names WHICH root's trunk to extend -- mutually exclusive with parentStepId (both -> " +
        "400); on a single-root pipeline neither is needed (unambiguous by construction). With " +
        "MORE than one root and neither parentStepId nor rootId given, the backend refuses with " +
        "a named 400 rather than silently picking a root.",
      inputSchema: {
        pipelineId: z.string().min(1),
        type: z.string().min(1),
        config: z.record(z.string(), z.unknown()).default({}),
        parentStepId: z.string().min(1).optional(),
        rootId: z.string().min(1).optional(),
      },
    },
    ({ pipelineId, type, config, parentStepId, rootId }) =>
      guarded(() =>
        addPipelineStepHandler(api, { pipelineId, type, config, parentStepId, rootId }),
      ),
  );

  // HEL-907 task 3.4: create_pipeline_from_shape REMOVED from here (no alias) -- replaced by
  // add_outputs_from_shape(pipelineId, stepId?, shapeId, params, outputName, outputKind?) in
  // tools/pipelines.ts (registerPipelineTools), which expands a shape onto an EXISTING
  // pipeline node instead of always creating a brand-new pipeline.

  server.registerTool(
    "run_pipeline",
    {
      title: "Run pipeline",
      description:
        "Run a pipeline to completion and write rows to its Output(s). The run is " +
        "SYNCHRONOUS: this returns only once rows exist, so it is safe to bind a panel immediately " +
        "after. Returns { pipelineId, status, rowCount, sourceRowCount, truncated, " +
        "availableRowCount, truncationNotice } -- call list_outputs(pipelineId) afterward for the " +
        "produced Output id(s). rowCount is NOT guaranteed to be the source's complete row count: " +
        "every run caps its source read at 1000 rows, and when the source (or a join/union/lookup " +
        "secondary source) has more rows than that, truncated is true and truncationNotice explains " +
        "exactly what was read vs. what exists — read it before treating a filter/sort/aggregate " +
        "result as complete. Set dry=true to validate without persisting rows.",
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
      description:
        "Create an empty dashboard. Returns its id (add panels with place_outputs for Output " +
        "data or create_content_panel for text/markdown/image). Pass " +
        'ifExists:"return" (HEL-363) for idempotent get-or-create: an owner-scoped, ' +
        "case-insensitive/trimmed name match is returned instead (200, same dashboard id as any " +
        "prior call) rather than creating a duplicate — useful for a scheduled rebuild script that " +
        "targets a stable dashboard without first listing + scanning for a name match. Omit " +
        "ifExists for the original behavior: always creates a new dashboard (201), even if a " +
        "same-named one already exists. Note: this is a sequential-call idempotency guarantee, not " +
        "a hard uniqueness constraint — two truly concurrent calls with the same name can both create. " +
        "Optional `tag` (HEL-366 convention, free-form, max 200 chars, set only at create time) lets " +
        "this dashboard be torn down together with a tagged workflow's other resources via " +
        "teardown_resources — a dashboard created with no tag is not reachable by tag-scoped teardown.",
      inputSchema: {
        name: z.string().min(1),
        ifExists: z.literal("return").optional(),
        tag: z.string().min(1).max(200).optional(),
      },
    },
    ({ name, ifExists, tag }) => guarded(() => api.createDashboard({ name, ifExists, tag })),
  );

  server.registerTool(
    "replace_dashboard_contents",
    {
      title: "Atomically replace a dashboard's panels",
      description:
        "Replace ALL of an existing dashboard's panels with the supplied set, atomically " +
        "(PUT /api/dashboards/:id/contents, HEL-363) — in one server-side transaction, instead of " +
        "hand-rolling delete_panel-per-panel followed by place_outputs-per-panel (which leaves the " +
        "live dashboard observably half-empty mid-rebuild and is not atomic). Every panel is " +
        "validated (structure + Output binding, RLS-owner-scoped) BEFORE any write: on " +
        "any invalid panel, the response is a 400 naming the offending panel by index/title and " +
        "NOTHING is deleted or created — the dashboard's existing panel set is left byte-for-byte " +
        "unchanged. On success, every prior panel is gone and every supplied panel exists; the " +
        "response is the rebuilt dashboard + panels (same shape as apply_proposal). Panels use the " +
        "exact same shape as propose_dashboard/apply_proposal's `panels` array (see those tools' " +
        "descriptions for the full per-type config/binding rules) — no pre-existing panel id is " +
        "needed since every panel gets a freshly minted id; per-panel `layout` (if given) is applied " +
        "on the rebuilt dashboard. Two overlapping calls for the SAME dashboard are last-writer-" +
        "wins (each still returns 200 for the write it made, but the later commit's panel set is " +
        "what survives) — call this serially per dashboard, as a scheduled rebuild naturally would.",
      inputSchema: {
        dashboardId: z.string().min(1),
        panels: z.array(panelSchema),
      },
    },
    ({ dashboardId, panels }) =>
      guarded(() => api.replaceDashboardContents(dashboardId, panels as ProposalPanel[])),
  );

  server.registerTool(
    "upload_image",
    {
      title: "Upload an image",
      description:
        "Upload an image (POST /api/uploads/image, single `file` multipart part — the same pattern " +
        "as create_csv_data_source). `content` is the image bytes, base64-encoded by default " +
        '(images are binary); pass encoding:"utf8" only for text content. Returns { id, url, ' +
        "markdownRef }: `url` is the Bearer-free served path (/api/uploads/image/<id>) usable as an " +
        "image panel's config.imageUrl; `markdownRef` is `helio://uploads/image/<id>` to embed in a " +
        "markdown panel's config.content (e.g. `![caption](helio://uploads/image/<id>)`). The " +
        "backend's 413 (image exceeds the configured max size) is surfaced verbatim.",
      inputSchema: {
        content: z.string().min(1),
        filename: z.string().min(1),
        mime: z.string().optional(),
        encoding: z.enum(["base64", "utf8"]).optional(),
      },
    },
    ({ content, filename, mime, encoding }) =>
      guarded(() => api.uploadImage({ content, filename, mime, encoding })),
  );

  // HEL-907 task 3.6: create_panel/create_panels/bind_panel/create_bound_panel REMOVED from
  // here (no alias) -- replaced by place_outputs/create_content_panel in tools/placements.ts
  // (registerPlacementTools). create_bound_panel's own backend route (POST /api/panels/bound)
  // no longer exists (retired during the Outputs remodel) -- every call has 404'd since then,
  // undetected because no test covered it; bind_panel's PATCH body (config: {dataTypeId,
  // fieldMapping}) is also meaningless against an output-kind panel's real config shape
  // (OutputPanelConfig only has outputId).

  server.registerTool(
    "update_panel_appearance",
    {
      title: "Update panel appearance",
      description:
        "Update a panel's appearance (background, color, transparency 0–1, and chart appearance). " +
        "True partial merge (HEL-362): any field you omit keeps its currently-stored value — you " +
        "never need to resend the whole object. This applies inside `chart` too, at its own field " +
        'level: {chart: {chartType: "bar"}} changes only chartType and leaves the panel\'s stored ' +
        "seriesColors/legend/tooltip/axisLabels untouched (previously a partial chart object was " +
        "rejected with 400; it is now accepted). To clear a field back to its default, send it as " +
        "`null` explicitly (e.g. {background: null}); {chart: null} clears the whole chart " +
        "sub-object. The one exception: {chart: {chartType: null}} clears just chartType (renders " +
        "as the line default) rather than resetting the rest of chart.",
      inputSchema: {
        panelId: z.string().min(1),
        appearance: z.record(z.string(), z.unknown()),
      },
    },
    ({ panelId, appearance }) => guarded(() => api.updatePanelAppearance(panelId, appearance)),
  );

  // update_panel (HEL-627) is the general edit-in-place sibling of
  // update_panel_appearance above (same resource, same PATCH endpoint) — the
  // missing fifth resource in the HEL-328 edit-in-place parity set (data
  // source/DataType/pipeline/pipeline step), registered here rather than in
  // the `## Edit-in-place (HEL-328)` block below, whose section comment names
  // that ticket's own fixed four-tool set.
  server.registerTool(
    "update_panel",
    {
      title: "Update panel (title/type/config/appearance) -- placement fields only",
      description:
        "Partially update a panel — title, type, config, and/or appearance — in place " +
        "(PATCH /api/panels/:id), without the delete-and-recreate round trip that churns the " +
        "panel's id and dashboard layout position. `title`/`type`/`config`/`appearance` are each " +
        "independently optional: an OMITTED argument leaves that field unchanged server-side.\n" +
        "`title`, when supplied, is trimmed and rejected (400) if blank.\n" +
        "`type`, when supplied, is validated against the panel's STORED kind: a matching value is a " +
        "harmless no-op, a MISMATCHED value is REJECTED (400, a panel's kind is immutable once " +
        "created) — never silently dropped or applied.\n" +
        "`appearance` is the SAME true partial merge as update_panel_appearance (HEL-362): an " +
        "omitted field keeps its stored value; an explicit `null` clears it. See that tool's " +
        "description for the `chart` sub-object's own field-level merge/clear rules.\n" +
        "`config` is decoded server-side against the panel's EXISTING stored `type` and is ALSO a " +
        "genuine per-field partial merge — the SAME absent/null convention as `appearance`. " +
        "HEL-907: a panel now carries ONLY placement fields — there is no per-bound-kind " +
        "fieldMapping/aggregation config on a panel anymore (that all moved to the Output itself, " +
        '`target.kind: "output"` via update_output). Patchable `config` fields, per the panel\'s ' +
        "stored type:\n" +
        "• output — `outputId` (rebind this placement to a DIFFERENT existing Output; use " +
        "update_output instead if you want to change the CURRENT Output's name/fieldMapping).\n" +
        "• text/markdown — `content`; absent leaves it unchanged, explicit `null` clears it to " +
        '`""` (not "removed").\n' +
        '• image — `imageUrl` clears to "" on `null`; `imageFit` RESETS to the default ' +
        '`"contain"` on `null` (NOT a clear-to-empty) and is enum-validated on a non-null value; ' +
        "`caption` clears on `null` OR a blank/whitespace string.\n" +
        '• divider — `orientation` RESETS to the default `"horizontal"` on `null` (NOT a clear, ' +
        "enum-validated on a non-null value); `weight`/`color` clear on `null`.\n" +
        "Returns the updated panel.",
      inputSchema: {
        panelId: z.string().min(1),
        title: z.string().optional(),
        // Unlike create_content_panel's `type` enum (text/markdown/image/divider only -- no
        // "output", which place_outputs creates instead), this tool's `type` validates against an
        // EXISTING panel's stored kind, so "output" is included here.
        type: z.enum(["output", "text", "markdown", "image", "divider"]).optional(),
        config: z.record(z.string(), z.unknown()).optional(),
        appearance: z.record(z.string(), z.unknown()).optional(),
      },
    },
    ({ panelId, title, type, config, appearance }) =>
      guarded(() =>
        api.updatePanel(panelId, buildUpdatePanelBody({ title, type, config, appearance })),
      ),
  );

  // ── Workspace tag-teardown (HEL-366) ────────────────────────────────────────

  server.registerTool(
    "teardown_resources",
    {
      title: "Bulk-delete every resource carrying a tag",
      description:
        "Permanently delete every data source, pipeline, and dashboard the caller owns that " +
        "carries `tag` (POST /api/workspace/teardown) — the tag-based replacement for scanning " +
        "resource names to find and delete a workflow run's resources. Give resources this same " +
        "`tag` at create time (create_data_source/create_csv_data_source's `tag`, create_pipeline's " +
        "`tag`, create_dashboard's `tag`) so they can all be torn down together in one call. A " +
        "pipeline's Outputs and their placement panels carry no tag of their own — they cascade " +
        "automatically when their owning pipeline is deleted, and a dashboard's panels cascade " +
        "automatically when it is deleted; neither needs (or accepts) its own separate tag.\n" +
        "**Refuse-on-out-of-batch-dependent**: the WHOLE call is refused (still HTTP 200, " +
        "`blocked: true`, NOTHING deleted — not even the unblocked portion of the tagged set) if " +
        "any tagged data source has a dependent pipeline outside this same tag batch that an " +
        "ordinary single-resource delete's cascade would otherwise reach: a tagged data source " +
        "whose dependent pipeline is untagged OR tagged with a *different* value (e.g. teardown " +
        "tag `T`, dependent pipeline tagged `U`) both block identically — being untagged and being " +
        "tagged into another live batch are treated the same way, neither is silently swept in. " +
        "Dashboards and pipelines carry no analogous guard of their own (nothing else has a hard " +
        "FK dependency requiring a same-batch check). `conflicts` in the response names each " +
        "blocked resource, its kind, and the out-of-batch dependent causing the block; resolve by " +
        "tagging the dependent into this same batch too, or deleting it individually first, then " +
        "retry.\n" +
        "**Always call with `dryRun: true` first** to preview exactly what would be deleted (or " +
        "why it would be blocked) before running for real — the response reports the same " +
        "`sourcesDeleted`/`pipelinesDeleted`/`dashboardsDeleted` counts and/or `conflicts` a real " +
        "call would, but deletes nothing. Idempotent: a repeat call with the same tag after a " +
        "successful teardown reports all-zero counts. Owner-scoped: never discovers, counts, " +
        "reports, or deletes another user's resources, even if they carry the same tag. " +
        "Irreversible once `dryRun` is omitted/false and the call succeeds.",
      inputSchema: {
        tag: z.string().min(1).max(200),
        dryRun: z.boolean().optional(),
      },
    },
    ({ tag, dryRun }) => guarded(() => api.teardownResources({ tag, dryRun })),
  );

  // ── Edit-in-place (HEL-328) ─────────────────────────────────────────────
  // Each PATCHes an existing, unmodified backend endpoint — no backend
  // changes in this ticket. Thin pass-throughs; the two multi-field tools
  // build their PATCH body via `updateSchemas.ts`'s `buildUpdate*Body`
  // before calling `HelioApi`.

  server.registerTool(
    "update_data_source",
    {
      title: "Update data source (rename)",
      description:
        "Rename an existing data source (PATCH /api/data-sources/:id). Rename-only — the backend's " +
        "update surface for a data source has no other mutable field today; there is no way to edit " +
        "connection config (CSV/REST/SQL) in place via this tool, only its name. `name` is required " +
        "(there is nothing else to patch, so an all-omitted call would be a pointless no-op). " +
        "Returns the updated data source.",
      inputSchema: {
        dataSourceId: z.string().min(1),
        name: z.string().min(1),
      },
    },
    ({ dataSourceId, name }) => guarded(() => api.updateDataSource(dataSourceId, name)),
  );

  server.registerTool(
    "update_pipeline",
    {
      title: "Update pipeline (rename)",
      description:
        "Rename an existing pipeline (PATCH /api/pipelines/:id). Rename-only — the backend's update " +
        "surface for a pipeline has exactly one, required field; there is no way to edit its " +
        "source/output-type wiring in place via this tool, only its name. Returns the updated " +
        "pipeline summary.",
      inputSchema: {
        pipelineId: z.string().min(1),
        name: z.string().min(1),
      },
    },
    ({ pipelineId, name }) => guarded(() => api.updatePipeline(pipelineId, name)),
  );

  server.registerTool(
    "update_dashboard",
    {
      title: "Update dashboard (rename)",
      description: UPDATE_DASHBOARD_DESCRIPTION,
      inputSchema: {
        dashboardId: z.string().min(1),
        name: z.string().min(1),
      },
    },
    ({ dashboardId, name }) => guarded(() => updateDashboardHandler(api, dashboardId, name)),
  );

  server.registerTool(
    "get_pipeline_schedule",
    {
      title: "Get pipeline schedule",
      description: GET_PIPELINE_SCHEDULE_DESCRIPTION,
      inputSchema: {
        pipelineId: z.string().min(1),
      },
    },
    ({ pipelineId }) => guarded(() => getPipelineScheduleHandler(api, pipelineId)),
  );

  server.registerTool(
    "set_pipeline_schedule",
    {
      title: "Set pipeline schedule (create or replace)",
      description: SET_PIPELINE_SCHEDULE_DESCRIPTION,
      inputSchema: {
        pipelineId: z.string().min(1),
        kind: z.enum(["cron", "interval"]),
        expression: z.string().min(1),
        timezone: z.string().min(1),
        enabled: z.boolean().optional(),
      },
    },
    ({ pipelineId, kind, expression, timezone, enabled }) =>
      guarded(() =>
        setPipelineScheduleHandler(api, { pipelineId, kind, expression, timezone, enabled }),
      ),
  );

  server.registerTool(
    "delete_pipeline_schedule",
    {
      title: "Delete pipeline schedule",
      description: DELETE_PIPELINE_SCHEDULE_DESCRIPTION,
      inputSchema: {
        pipelineId: z.string().min(1),
      },
    },
    ({ pipelineId }) => guarded(() => deletePipelineScheduleHandler(api, pipelineId)),
  );

  server.registerTool(
    "update_pipeline_step",
    {
      title: "Update pipeline step",
      description:
        "Edit an existing pipeline transform step's config and/or position in place " +
        "(PATCH /api/pipeline-steps/:id) — without the delete_pipeline_step + add_pipeline_step " +
        "round trip, which loses the step's original position in the ordering. `config` and " +
        "`position` are each independently optional: an OMITTED argument leaves that field " +
        "unchanged server-side. There is deliberately NO `type` field on this tool — the backend " +
        "always 400s if a PATCH `type` differs from the step's existing kind ('delete the step and " +
        "create a new one instead'), and a matching `type` is accepted but does nothing, so " +
        "exposing it would only invite a dead-end call; a step's type is immutable once created. " +
        "`config`, when provided, is decoded against the step's EXISTING kind — same shape/" +
        "validation as add_pipeline_step's `config` for that type (see that tool's description for " +
        "the full per-type config catalogue). The step's id and ordering (unless you explicitly set " +
        "`position`) are unchanged. Call analyze_pipeline afterward to see the edited step's config " +
        "reflected in the pipeline's projected schema.",
      inputSchema: {
        stepId: z.string().min(1),
        config: z.record(z.string(), z.unknown()).optional(),
        position: z.number().int().optional(),
      },
    },
    ({ stepId, config, position }) =>
      guarded(() =>
        api.updatePipelineStep(stepId, buildUpdatePipelineStepBody({ config, position })),
      ),
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
        "dashboard's panels are deleted with it. Data sources, pipelines, and Outputs are NOT " +
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
        "Outputs. Irreversible — prefer deleting dependent pipelines/dashboards first if you want " +
        "to control the blast radius.",
      inputSchema: { dataSourceId: z.string().min(1) },
    },
    ({ dataSourceId }) => guarded(() => api.deleteDataSource(dataSourceId)),
  );

  server.registerTool(
    "delete_panel",
    {
      title: "Delete panel",
      description:
        "Permanently delete a single panel from its dashboard (DELETE /api/panels/:id). Does not " +
        "affect the dashboard or the Output the panel was bound to. Irreversible.",
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
        "steps, run history, AND its Outputs (and their placements) — unlike the retired DataType " +
        "model, an Output has no independent lifecycle from its producing pipeline. Owner-only. " +
        "Irreversible.",
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
        "Under the tree model (parentStepId), deleting a step ALSO deletes every descendant step " +
        "branching off it — the response's removedTailStepCount reports how many descendants were " +
        "removed alongside the named step, so you always know the true blast radius. Re-run the " +
        "pipeline afterward to reflect the change. Irreversible.",
      inputSchema: { stepId: z.string().min(1) },
    },
    ({ stepId }) => guarded(() => api.deletePipelineStep(stepId)),
  );

  // ── Layout ────────────────────────────────────────────────────────────────

  server.registerTool(
    "update_dashboard_layout",
    {
      title: "Update dashboard grid layout",
      description:
        "Position/size a dashboard's panels on its responsive grid (PATCH /api/dashboards/:id). " +
        "Pass `items` as [{panelId,x,y,w,h}] on a 12-column grid: x 0-11, w 1-12, and y/h in row " +
        "units (row height is fixed by the frontend). The same placement is applied to all " +
        "breakpoints. Panels not listed keep their current/auto position. Returns the updated " +
        "dashboard. Create + bind panels first, then call this with their ids.",
      inputSchema: {
        dashboardId: z.string().min(1),
        items: z
          .array(
            z.object({
              panelId: z.string().min(1),
              x: z.number().int().min(0),
              y: z.number().int().min(0),
              w: z.number().int().positive(),
              h: z.number().int().positive(),
            }),
          )
          .min(1),
      },
    },
    ({ dashboardId, items }) => guarded(() => api.updateDashboardLayout(dashboardId, items)),
  );

  server.registerTool(
    "auto_layout_dashboard",
    {
      title: "Auto-pack panel sizes into a non-overlapping layout",
      description:
        "Server-side geometry helper (POST /api/dashboards/:id/auto-layout) that replaces having to " +
        "compute panel positions yourself — pass ONLY sizes ([{panelId,w,h}], no x/y) and the backend " +
        "flows them left-to-right on a 12-column grid (configurable via `cols`), wrapping to a new row " +
        "when one fills, widening a nearly-full row to close a ragged right edge, and clamping any " +
        "out-of-bounds size to its panel kind's readable min/max (e.g. a chart too short to show its " +
        "axis labels). Input order IS visual order. Panels omitted from `items` keep their current " +
        "saved position; a `panelId` not on the target dashboard is rejected with 400 (surfaced " +
        "verbatim, nothing persisted). Same placement is applied to all four responsive breakpoints. " +
        "Create/place panels first (create_pipeline + place_outputs / create_content_panel), then " +
        "call this with their ids and your chosen sizes — no need to reimplement " +
        "shelf-packing/clamping client-side.",
      inputSchema: {
        dashboardId: z.string().min(1),
        items: z
          .array(
            z.object({
              panelId: z.string().min(1),
              w: z.number().int().positive(),
              h: z.number().int().positive(),
            }),
          )
          .min(1),
        cols: z.number().int().positive().optional(),
      },
    },
    ({ dashboardId, items, cols }) =>
      guarded(() => api.autoLayoutDashboard(dashboardId, items, cols)),
  );
}
