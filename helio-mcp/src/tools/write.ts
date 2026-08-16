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
import type { ProposalPanel } from "../types.js";
import { addPipelineStepHandler } from "./assertSchemas.js";
import {
  buildUpdateMetricBody,
  metricAggregationSchema,
  metricFormatSchema,
} from "./metricSchemas.js";
import { panelSchema } from "./proposal.js";
import {
  buildUpdateDataTypeBody,
  buildUpdatePanelBody,
  buildUpdatePipelineStepBody,
  computedFieldSchema,
  dataFieldSchema,
} from "./updateSchemas.js";

// Hoisted to module scope (HEL-385 design.md D3 — round-1 skeptic correction):
// originally declared inside `registerWriteTools`, where `export` cannot
// legally apply to a function-local `const`. The declaration closes over
// nothing (no reference to `server`/`api`/any other local), so this
// relocation is behavior-preserving — `create_bound_panel` below continues to
// resolve it via normal module-scope lookup, exactly as before. Exported so
// `pipelineProposal.ts`'s `steps` field can reuse it verbatim instead of a
// second, drift-prone copy — mirrors this file's own existing import of
// `panelSchema` from `proposal.ts`.
export const boundPipelineStepSchema = z.object({
  type: z.string().min(1),
  config: z.record(z.unknown()).default({}),
});

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
        "create_csv_data_source, create_rest_data_source, or create_sql_data_source instead. " +
        "Optional `tag` (HEL-366, free-form grouping key, max 200 chars) is propagated to the " +
        "auto-created companion DataType too, and lets a whole workflow run's resources be torn " +
        "down together later with teardown_resources.",
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
        "Create a `csv` data source from inline CSV text content — no filesystem access from the " +
        "MCP process required. Posts the content as a multipart upload to the same endpoint the " +
        "UI's file-upload flow uses. Like `static`, the backend auto-creates a source-companion " +
        "DataType (NOT returned inline — inspect it via list_source_objects); build a pipeline over " +
        "the returned source id to produce a panel-bindable output type. Optional `tag` (HEL-366, " +
        "free-form grouping key, max 200 chars) is propagated to the auto-created companion " +
        "DataType too, and lets a whole workflow run's resources be torn down together later with " +
        "teardown_resources.",
      inputSchema: {
        name: z.string().min(1),
        content: z.string().min(1),
        tag: z.string().min(1).max(200).optional(),
      },
    },
    ({ name, content, tag }) => guarded(() => api.createCsvDataSource({ name, content, tag })),
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
        "including `id` and `outputDataTypeId`. Add steps with add_pipeline_step, then run_pipeline. " +
        "Optional `tag` (HEL-366, free-form grouping key, max 200 chars) is propagated to the " +
        "newly-created output DataType too, and lets a whole workflow run's resources be torn down " +
        "together later with teardown_resources.",
      inputSchema: {
        name: z.string().min(1),
        sourceDataSourceId: z.string().min(1),
        outputDataTypeName: z.string().min(1),
        tag: z.string().min(1).max(200).optional(),
      },
    },
    ({ name, sourceDataSourceId, outputDataTypeName, tag }) =>
      guarded(() => api.createPipeline({ name, sourceDataSourceId, outputDataTypeName, tag })),
  );

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
        "union → {otherDataSourceId, mode: 'byPosition'|'byName'} — the second async/repo-touching " +
        "op (like join): resolves `otherDataSourceId` as a second DataSource (pipeline ACL is the " +
        "gate, mirroring join) and stacks its rows onto the current row set. `byPosition` (default) " +
        "appends rows as-is with no column reconciliation — use when both sources share identical " +
        "columns. `byName` unions the two sides' column sets (derived from each side's first row) " +
        "and backfills a column missing on either side with null for that side's rows. Row count is " +
        "additive (current rows + other source's rows); output schema is a best-effort passthrough " +
        "of the input schema (the other source's schema isn't resolved by analyze_pipeline) — " +
        "verify the union's actual shape with preview/run rather than trusting the analyzed schema. " +
        "A missing/unresolvable `otherDataSourceId` or an unrecognized `mode` fails at execute time " +
        "naming the problem; " +
        "lookup → {referenceDataSourceId, sourceKey, lookupKey, columns: string[]} — a constrained " +
        "single-key left-join against a reference DataSource (pipeline ACL is the gate, mirroring " +
        "join/union), bringing in only the named `columns` (every other reference-row field is " +
        "dropped). For each row, `sourceKey`'s value is matched against `lookupKey` on the " +
        "reference source's rows; a match brings in `columns`' values, overwriting any " +
        "colliding field on the current row; multiple reference matches use only the first " +
        "(no row multiplication); no match null-fills `columns` (row preserved — a true left " +
        "join, row count never changes). `columns` DOES appear in analyze_pipeline's output " +
        "schema, appended typed string as a documented best-effort (the reference source's real " +
        "schema isn't resolved by analyze_pipeline — verify actual types with preview/run). A " +
        "missing/unresolvable `referenceDataSourceId` fails at execute time naming the problem; " +
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
        "see each step's resulting output columns.",
      inputSchema: {
        pipelineId: z.string().min(1),
        type: z.string().min(1),
        config: z.record(z.unknown()).default({}),
      },
    },
    ({ pipelineId, type, config }) =>
      guarded(() => addPipelineStepHandler(api, { pipelineId, type, config })),
  );

  server.registerTool(
    "create_pipeline_from_shape",
    {
      title: "Create pipeline from a smart shape",
      description:
        "Instantiate a smart pipeline shape into a NEW pipeline in one call, instead of hand-" +
        "assembling steps with create_pipeline + add_pipeline_step. Validates `params` against the " +
        "shape's own expand FIRST (POST /api/pipeline-shapes/:shapeId/expand) — if that fails " +
        "(unknown shapeId, or params rejected), NO pipeline is created and the tool returns an " +
        "error whose message is the backend's 404/422 message verbatim (an unknown shapeId's " +
        "message lists every registered id). Only once expand succeeds does it create the pipeline " +
        "(new panel-bindable output DataType named outputDataTypeName) and add each expanded step " +
        "in order, the same way add_pipeline_step would. Does NOT run the pipeline — call " +
        "run_pipeline afterward (you may also add further non-shape steps first, e.g. a rename). " +
        "Call list_pipeline_shapes first to see every registered shapeId + its params shape. " +
        "Registered shape ids + params: " +
        "`passthrough` {fields: string[]}; " +
        '`single-row` {mode:"aggregate"|"filter", measures?:{fn,field,alias}[], ' +
        "conditions?:{field,operator,value}[], combinator?}; " +
        '`top-n` {measure, direction:"asc"|"desc", n, ties?}; ' +
        '`time-series` {timeField, granularity:"day"|"week"|"month"|"quarter"|"year", ' +
        "measures:{fn,field,alias}[]}; " +
        '`pivot-matrix` {index:string[], column, values, agg:"sum"|"count"|"avg"|"min"|' +
        '"max"|"first"}. Returns the created pipeline summary plus the ordered list of created ' +
        "steps. Optional `tag` (HEL-366, free-form grouping key, max 200 chars) is propagated to " +
        "the newly-created output DataType too, and lets a whole workflow run's resources be torn " +
        "down together later with teardown_resources.",
      inputSchema: {
        name: z.string().min(1),
        sourceDataSourceId: z.string().min(1),
        outputDataTypeName: z.string().min(1),
        shapeId: z.string().min(1),
        params: z.record(z.unknown()).default({}),
        tag: z.string().min(1).max(200).optional(),
      },
    },
    ({ name, sourceDataSourceId, outputDataTypeName, shapeId, params, tag }) =>
      guarded(() =>
        api.createPipelineFromShape({
          name,
          sourceDataSourceId,
          outputDataTypeName,
          shapeId,
          params,
          tag,
        }),
      ),
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
      description:
        "Create an empty dashboard. Returns its id (add panels with create_panel). Pass " +
        'ifExists:"return" (HEL-363) for idempotent get-or-create: an owner-scoped, ' +
        "case-insensitive/trimmed name match is returned instead (200, same dashboard id as any " +
        "prior call) rather than creating a duplicate — useful for a scheduled rebuild script that " +
        "targets a stable dashboard without first listing + scanning for a name match. Omit " +
        "ifExists for the original behavior: always creates a new dashboard (201), even if a " +
        "same-named one already exists. Note: this is a sequential-call idempotency guarantee, not " +
        "a hard uniqueness constraint — two truly concurrent calls with the same name can both create.",
      inputSchema: { name: z.string().min(1), ifExists: z.literal("return").optional() },
    },
    ({ name, ifExists }) => guarded(() => api.createDashboard({ name, ifExists })),
  );

  server.registerTool(
    "replace_dashboard_contents",
    {
      title: "Atomically replace a dashboard's panels",
      description:
        "Replace ALL of an existing dashboard's panels with the supplied set, atomically " +
        "(PUT /api/dashboards/:id/contents, HEL-363) — in one server-side transaction, instead of " +
        "hand-rolling delete_panel-per-panel followed by create_panel-per-panel (which leaves the " +
        "live dashboard observably half-empty mid-rebuild and is not atomic). Every panel is " +
        "validated (structure + V41 pipeline-only binding, RLS-owner-scoped) BEFORE any write: on " +
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

  server.registerTool(
    "create_panel",
    {
      title: "Create panel",
      description:
        "Create a panel on a dashboard. `type` ∈ " +
        "metric/chart/table/text/markdown/image/collection/timeline (there is no `divider`: " +
        "divider creation was dropped for agent/UI parity, mirroring the human app — the backend " +
        "wire still accepts it on other paths, the MCP just no longer offers it). Data panels " +
        "(metric/chart/table/collection/timeline) are created then bound with bind_panel to a " +
        "pipeline-output DataType.\n" +
        "config by type:\n" +
        "• metric — bind later; literal `label`/`unit` overrides optional.\n" +
        "• chart — `chartOptions` keyed by chart type (line {smooth,showPoints,areaFill}; " +
        "bar {orientation:vertical|horizontal, stacking:none|stacked|normalized, barGapPct:0-100}; " +
        "pie {donutHolePct:0-90, showPercentLabels}; scatter {sizeField,colorField}). Set the " +
        "chart's TYPE via `appearance.chart.chartType` (line|bar|pie|scatter), not config. " +
        "Optional `aggregation` ({groupBy, agg:count|sum|avg|min|max, yField}) groups bound rows by " +
        "`groupBy` and plots one aggregate mark per group instead of one mark per row — honored for " +
        "bar/line/pie (for pie, one `{name,value}` slice per group); REJECTED (400) if combined with " +
        '`chartType: "scatter"`, since scatter plots a raw {x,y} coordinate pair per row with no ' +
        "groupBy semantic. " +
        "Optional `annotation` (static string) renders as a subtitle/footnote beneath the chart; " +
        "omit it for no annotation. To source the annotation dynamically from a bound DataType " +
        "column instead, set the reserved `fieldMapping.annotation` slot (see bind_panel) rather " +
        "than the static `annotation` string — the static literal wins if both are set.\n" +
        "• table — `density` (condensed|normal|spacious) and `columnOrder` (string[] of visible " +
        "column keys, in order).\n" +
        "• collection — `baseType` (metric) and `layout` (grid|list); set these here at create " +
        "time (they survive a later bind_panel merge-patch). One bound row = one rendered item.\n" +
        "• timeline — `timelineOptions.sort` (asc|desc, default asc); set here at create time (it " +
        "survives a later bind_panel merge-patch). Renders a vertical chronological event list, " +
        "one bound row = one rendered event.\n" +
        "• text/markdown — `content` (literal/static text). In markdown `content`, reference an " +
        "uploaded image with the `helio://uploads/image/<id>` scheme (get <id> from upload_image).\n" +
        "• image — `imageUrl` (use an uploaded image's served `url`, or its " +
        "`helio://uploads/image/<id>` ref), optional `imageFit` (contain|cover|fill), and optional " +
        "`caption` (static string) rendered as a strip beneath the image; omit it for no caption.\n" +
        "`appearance` is an optional passthrough (same shape as update_panel_appearance); its " +
        "`chart.chartType` is the create-time channel for a bar/pie/scatter chart. Returns the " +
        "panel id.",
      inputSchema: {
        dashboardId: z.string().min(1),
        title: z.string().optional(),
        type: z
          .enum(["metric", "chart", "table", "text", "markdown", "image", "collection", "timeline"])
          .optional(),
        config: z.record(z.unknown()).optional(),
        appearance: z.record(z.unknown()).optional(),
      },
    },
    ({ dashboardId, title, type, config, appearance }) =>
      guarded(() => api.createPanel({ dashboardId, title, type, config, appearance })),
  );

  server.registerTool(
    "create_panels",
    {
      title: "Create panels (batch)",
      description:
        "Create several panels on ONE dashboard in a single call (POST /api/panels/batch, HEL-370) " +
        "— the preferred path whenever you're laying down more than one panel on a dashboard (e.g. a " +
        "story's image + markdown pair, or a batch of pre-created data panels to bind afterward with " +
        "bind_panel), instead of N sequential create_panel calls. All panels are created atomically: " +
        "one bad item (unrecognized type, invalid chart.chartType, or a config.dataTypeId binding " +
        "that violates the pipeline-only rule) creates NOTHING in the batch and the tool surfaces the " +
        "backend's 400 verbatim, naming the offending item by 1-based index and title. On success, " +
        "returns every created panel (with ids) in the same order supplied. Each entry in `panels` " +
        "has the exact same shape as create_panel's arguments minus `dashboardId` (supplied once here) " +
        "— see create_panel's description for the full per-type config/appearance rules. Like " +
        "create_panel, this only creates plain or pre-bound-DataType panels; it does not build a " +
        "source/pipeline/run chain (bind_panel or create_bound_panel remain the paths for that). " +
        "create_panel remains available and unchanged for a single panel.",
      inputSchema: {
        dashboardId: z.string().min(1),
        panels: z.array(
          z.object({
            title: z.string().optional(),
            type: z
              .enum([
                "metric",
                "chart",
                "table",
                "text",
                "markdown",
                "image",
                "collection",
                "timeline",
              ])
              .optional(),
            config: z.record(z.unknown()).optional(),
            appearance: z.record(z.unknown()).optional(),
          }),
        ),
      },
    },
    ({ dashboardId, panels }) => guarded(() => api.createPanels({ dashboardId, panels })),
  );

  server.registerTool(
    "bind_panel",
    {
      title: "Bind panel to a DataType",
      description:
        "Bind a panel to a pipeline-output DataType and set its field mapping. " +
        "fieldMapping keys by panel type: metric → {value, label?, unit?}; " +
        "chart → {xAxis, yAxis, series?, annotation?} (annotation binds the chart's subtitle/" +
        "footnote to a DataType column — first-row value; omit to keep a static config.annotation); " +
        "text/markdown → {content} (the DataType column whose " +
        "value fills the text/markdown body in Source mode); collection → the base-type slots, " +
        "i.e. for baseType metric {value, label?, unit?} applied to every row/item; " +
        "timeline → {time, event} (time is a timestamp/order column, event is the text " +
        "description) applied to every row/entry; " +
        "table → no fieldMapping needed (omit it — the old `columns` slot is vestigial; visible " +
        "columns come from config.columnOrder set on create_panel). A collection's " +
        "baseType/layout and a timeline's timelineOptions.sort are set on create_panel and " +
        "preserved by this bind (merge-patch). " +
        "The DataType MUST be a pipeline output (sourceId null); binding a source companion is " +
        "rejected with 400 (V41). Pass panelType to match the panel's type.",
      inputSchema: {
        panelId: z.string().min(1),
        dataTypeId: z.string().min(1),
        fieldMapping: z.record(z.string()).optional(),
        panelType: z
          .enum(["metric", "chart", "table", "text", "markdown", "collection", "timeline"])
          .optional(),
      },
    },
    ({ panelId, dataTypeId, fieldMapping, panelType }) =>
      guarded(() => api.bindPanel(panelId, { dataTypeId, fieldMapping, panelType })),
  );

  server.registerTool(
    "create_bound_panel",
    {
      title: "Create one bound panel in a single call",
      description:
        "Build ONE bound data panel with a single tool call — collapses the 6-call chain " +
        "create_data_source/create_pipeline -> add_pipeline_step* -> run_pipeline -> create_panel -> " +
        "bind_panel -> update_panel_appearance into one server-side POST /api/panels/bound (HEL-364). " +
        "This is the PREFERRED path for a single bound panel; the granular tools above remain " +
        "available and unchanged for finer-grained control (e.g. re-running an existing pipeline, or " +
        "building a source once and reusing it across many panels via sourceDataSourceId).\n" +
        "Exactly one of `source` (inline `{name, columns, rows}` — same shape as create_data_source) " +
        "or `sourceDataSourceId` (an existing, caller-owned DataSource id) must be given. `pipeline." +
        "outputDataTypeName` names the new panel-bindable output type; `pipeline.steps` is the same " +
        "ordered `{type, config}` list add_pipeline_step accepts (see that tool's description for the " +
        "full per-op config catalogue) — may be empty to bind the raw source schema unchanged. " +
        "`panel.type` MUST be one of metric/chart/table/collection/timeline (the five data-bindable " +
        "kinds) — any other type is rejected; use create_panel directly for text/markdown/image. " +
        "The backend validates the requested panel type's fieldMapping is satisfiable by the " +
        "pipeline's PROJECTED output schema BEFORE creating anything — an unsatisfiable binding " +
        "(e.g. a chart with no numeric column for yAxis) 400s with nothing created. The pipeline run " +
        "is synchronous, so the returned panel's DataType already has rows (no separate run_pipeline " +
        "call needed) — a run that legitimately produces zero rows (e.g. an over-restrictive filter) " +
        "still succeeds with a bound, empty panel, not an error. On any failure AFTER the validation " +
        "gate, the backend cleans up every resource IT created for this call (the pipeline, its " +
        "steps, the output DataType and its rows, and — only when `source` was created inline by " +
        "this same call — that DataSource too; a reused sourceDataSourceId is never touched) and the " +
        "error message names the failed stage (source/pipeline/steps/run/panel) — surfaced verbatim, " +
        "never retried or silently swallowed. `fieldMapping` (top-level, optional) sets the created " +
        "panel's binding — same per-type slot keys as bind_panel (metric -> {value,label?,unit?}; " +
        "chart -> {xAxis,yAxis,series?,annotation?}; table -> omit; collection -> the base-type " +
        "slots; timeline -> {time,event}). `panel.appearance` (optional) is completed the same way " +
        "create_panel's is — a partial `{chart:{chartType}}` is overlaid onto the full default chart " +
        "appearance. Returns { sourceId, pipelineId, dataTypeId, panel }.",
      inputSchema: {
        dashboardId: z.string().min(1),
        source: z
          .object({
            name: z.string().min(1),
            columns: z.array(z.object({ name: z.string().min(1), type: z.string().min(1) })).min(1),
            rows: z.array(z.array(z.unknown())),
          })
          .optional(),
        sourceDataSourceId: z.string().min(1).optional(),
        pipeline: z.object({
          name: z.string().optional(),
          outputDataTypeName: z.string().min(1),
          steps: z.array(boundPipelineStepSchema).default([]),
        }),
        panel: z.object({
          type: z.enum(["metric", "chart", "table", "collection", "timeline"]),
          title: z.string().min(1),
          config: z.record(z.unknown()).optional(),
          appearance: z.record(z.unknown()).optional(),
        }),
        fieldMapping: z.record(z.string()).optional(),
      },
    },
    ({ dashboardId, source, sourceDataSourceId, pipeline, panel, fieldMapping }) =>
      guarded(() =>
        api.createBoundPanel({
          dashboardId,
          source: source ? { ...source, rows: source.rows as unknown[][] } : undefined,
          sourceDataSourceId,
          pipeline,
          panel,
          fieldMapping,
        }),
      ),
  );

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
        appearance: z.record(z.unknown()),
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
      title: "Update panel (title/type/config/appearance)",
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
        "genuine per-field partial merge — the SAME absent/null convention as `appearance` — NOT a " +
        "wholesale replace like update_data_type's `fields`/`computedFields`. `config.dataTypeId`/" +
        "`config.fieldMapping` are technically patchable through this tool too (every bound kind's " +
        "config carries them), but bind_panel remains the PREFERRED tool for binding changes — it " +
        "additionally validates the V41 pipeline-only rule and `panelType` consistency, which this " +
        "tool does not re-check client-side.\n" +
        "Patchable `config` fields, per the panel's stored type (all nine dispatched by " +
        "PanelConfigCodec.applyConfigPatch):\n" +
        "• metric — `unit`/`label`/`dataTypeId`/`fieldMapping`/`aggregation`/`metricId` (standard " +
        "absent-unchanged/null-clear/set).\n" +
        "• chart — `dataTypeId`/`fieldMapping`/`aggregation`/`metricId` (standard); `annotation` " +
        "clears on `null` OR a blank/whitespace-only string, not only `null`; `chartOptions` clears " +
        "on `null` OR a non-null object that, after per-chart-type (line/bar/pie/scatter) " +
        "validation, carries no populated sub-field — INCLUDING a bare `{}` — so sending " +
        '`chartOptions: {}` "just to be safe" silently WIPES existing display options rather than ' +
        "leaving them unchanged.\n" +
        "• table — `dataTypeId`/`fieldMapping`/`columnWidths`/`metricId` (standard); `density` " +
        "(standard, but enum-validated — an invalid value 400s, not silently dropped); " +
        "`columnOrder` (standard).\n" +
        "• text/markdown — `dataTypeId`/`fieldMapping` (standard); `content` has NO null/absent " +
        "distinction the same way the others do — omitting it leaves it unchanged, but an explicit " +
        '`null` clears it to `""` (not "removed").\n' +
        "• image — `caption` clears on `null` OR a blank/whitespace string (same exception shape as " +
        'chart `annotation`); `imageUrl` clears to `""` on `null` (same shape as `content`); ' +
        '`imageFit` RESETS to the default `"contain"` on `null` (NOT a clear-to-empty) and is ' +
        "enum-validated on a non-null value.\n" +
        "• collection — `dataTypeId`/`fieldMapping` (standard); `baseType` RESETS to the default " +
        '`"metric"` on `null` (NOT a clear); `layout` RESETS to the default `"grid"` on `null` (NOT ' +
        "a clear) and is enum-validated on a non-null value; `itemOptions` clears on `null` OR an " +
        "empty object.\n" +
        "• timeline — `dataTypeId`/`fieldMapping` (standard); `timelineOptions.sort` RESETS to the " +
        'default `"asc"` on `null` OR an empty object (NOT a clear).\n' +
        '• divider — `orientation` RESETS to the default `"horizontal"` on `null` (NOT a clear, ' +
        "enum-validated on a non-null value); `weight`/`color` (standard).\n" +
        "Returns the updated panel.",
      inputSchema: {
        panelId: z.string().min(1),
        title: z.string().optional(),
        // Unlike create_panel's `type` enum (which drops "divider" for
        // agent/UI parity — divider creation is unsupported), this tool's
        // `type` validates against an EXISTING panel's stored kind, and a
        // divider panel can already exist (created before this tool, or via
        // the human app) — so "divider" is included here; every one of the
        // nine kinds below has its own documented config field list.
        type: z
          .enum([
            "metric",
            "chart",
            "table",
            "text",
            "markdown",
            "image",
            "collection",
            "timeline",
            "divider",
          ])
          .optional(),
        config: z.record(z.unknown()).optional(),
        appearance: z.record(z.unknown()).optional(),
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
        "Permanently delete every data source, pipeline, and DataType the caller owns that carries " +
        "`tag` (POST /api/workspace/teardown) — the tag-based replacement for scanning resource " +
        "names to find and delete a workflow run's resources. Give resources this same `tag` at " +
        "create time (create_data_source/create_csv_data_source's `tag`, create_pipeline/" +
        "create_pipeline_from_shape's `tag`) so they can all be torn down together in one call.\n" +
        "**Refuse-on-out-of-batch-dependent**: the WHOLE call is refused (still HTTP 200, " +
        "`blocked: true`, NOTHING deleted — not even the unblocked portion of the tagged set) if " +
        "any tagged resource has a dependent outside this same tag batch that an ordinary single-" +
        "resource delete's cascade would otherwise reach: a tagged data source whose dependent " +
        "pipeline is untagged OR tagged with a *different* value (e.g. teardown tag `T`, dependent " +
        "pipeline tagged `U`) both block identically — being untagged and being tagged into another " +
        "live batch are treated the same way, neither is silently swept in. Likewise a tagged " +
        "output DataType whose producing pipeline is untagged or differently tagged blocks. A " +
        "tagged DataType still bound to a panel, or still linked to a data source that is NOT " +
        "tagged into this SAME batch, also blocks (a source tagged into the SAME batch as its " +
        "companion DataType is fine — both are deleted together, the common case). `conflicts` in " +
        "the response names each blocked resource, its kind, and the out-of-batch dependent causing " +
        "the block; resolve by tagging the dependent into this same batch too, or deleting it " +
        "individually first, then retry.\n" +
        "**Always call with `dryRun: true` first** to preview exactly what would be deleted (or " +
        "why it would be blocked) before running for real — the response reports the same " +
        "`sourcesDeleted`/`pipelinesDeleted`/`typesDeleted` counts and/or `conflicts` a real call " +
        "would, but deletes nothing. Idempotent: a repeat call with the same tag after a successful " +
        "teardown reports all-zero counts. Owner-scoped: never discovers, counts, reports, or " +
        "deletes another user's resources, even if they carry the same tag. Irreversible once " +
        "`dryRun` is omitted/false and the call succeeds.",
      inputSchema: {
        tag: z.string().min(1).max(200),
        dryRun: z.boolean().optional(),
      },
    },
    ({ tag, dryRun }) => guarded(() => api.teardownResources({ tag, dryRun })),
  );

  // ── Metrics (semantic layer, HEL-446/HEL-493/HEL-541) ───────────────────

  server.registerTool(
    "create_metric",
    {
      title: "Create metric",
      description:
        "Define a reusable metric: an aggregation applied to one field over a pipeline-output " +
        "DataType. `dataTypeId` MUST be a caller-owned pipeline-output DataType — V41: sourceId " +
        "absent on that DataType (check via list_data_types/get_panel_capabilities; a source-" +
        "companion DataType's id is rejected with 400). `measureField` and each entry of " +
        "`allowedDimensions` must be columns that actually exist on that DataType (also validated " +
        "server-side, verbatim rejection message on mismatch). Prefer this over re-deriving the same " +
        "aggregation inline in every panel/pipeline step that needs it — call list_metrics first to " +
        "check whether the measure you need is already defined, and reference it (get_metric) " +
        "instead of duplicating the logic.",
      inputSchema: {
        dataTypeId: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        measureField: z.string().min(1),
        aggregation: metricAggregationSchema,
        allowedDimensions: z.array(z.string()),
        format: metricFormatSchema.optional(),
      },
    },
    ({ dataTypeId, name, description, measureField, aggregation, allowedDimensions, format }) =>
      guarded(() =>
        api.createMetric({
          dataTypeId,
          name,
          description,
          measureField,
          aggregation,
          allowedDimensions,
          format,
        }),
      ),
  );

  server.registerTool(
    "update_metric",
    {
      title: "Update metric",
      description:
        "Partially update a defined metric (PATCH /api/metrics/:id). Every field is optional and " +
        "independently patchable: an OMITTED argument leaves that field unchanged server-side. " +
        "`description` and `format` are additionally NULLABLE — pass an explicit `null` to CLEAR " +
        "that field (distinct from omitting it, which leaves it as-is); `format`, when given as an " +
        "object, replaces the whole format object (no deep merge of its own sub-fields: unit/" +
        "decimals/prefix/suffix). `dataTypeId` is not patchable — create a new metric if the measure " +
        "needs to move to a different DataType. `aggregation`, when given, is validated client-side " +
        "against the same enum create_metric uses before any request reaches the backend; " +
        "`measureField`/`allowedDimensions` changes are validated against the metric's DataType " +
        "server-side, same as create_metric.",
      inputSchema: {
        metricId: z.string().min(1),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        measureField: z.string().min(1).optional(),
        aggregation: metricAggregationSchema.optional(),
        allowedDimensions: z.array(z.string()).optional(),
        format: metricFormatSchema.nullable().optional(),
        deprecated: z.boolean().optional(),
      },
    },
    ({
      metricId,
      name,
      description,
      measureField,
      aggregation,
      allowedDimensions,
      format,
      deprecated,
    }) =>
      guarded(() =>
        api.updateMetric(
          metricId,
          buildUpdateMetricBody({
            name,
            description,
            measureField,
            aggregation,
            allowedDimensions,
            format,
            deprecated,
          }),
        ),
      ),
  );

  // ── Edit-in-place (HEL-328) ─────────────────────────────────────────────
  // Each PATCHes an existing, unmodified backend endpoint — no backend
  // changes in this ticket. Thin pass-throughs mirroring `update_metric`
  // above; the two multi-field tools build their PATCH body via
  // `updateSchemas.ts`'s `buildUpdate*Body` before calling `HelioApi`.

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
    "update_data_type",
    {
      title: "Update DataType",
      description:
        "Partially update a DataType (PATCH /api/types/:id). `name`/`fields`/`computedFields` are " +
        "each independently optional: an OMITTED argument leaves that field unchanged server-side. " +
        "When `fields` or `computedFields` IS provided, it REPLACES the existing array WHOLESALE " +
        "server-side (not a per-item merge) — resend the FULL desired array, including any entries " +
        "you want to keep, not just the ones you're adding/changing. `fields` items are " +
        "{name, displayName, dataType, nullable}; `computedFields` items are " +
        "{name, displayName, expression, dataType} — mirroring the backend's own field shapes. " +
        "Returns the updated DataType.",
      inputSchema: {
        dataTypeId: z.string().min(1),
        name: z.string().min(1).optional(),
        fields: z.array(dataFieldSchema).optional(),
        computedFields: z.array(computedFieldSchema).optional(),
      },
    },
    ({ dataTypeId, name, fields, computedFields }) =>
      guarded(() =>
        api.updateDataType(dataTypeId, buildUpdateDataTypeBody({ name, fields, computedFields })),
      ),
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
        config: z.record(z.unknown()).optional(),
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
    "delete_metric",
    {
      title: "Delete metric",
      description:
        "Permanently delete a defined metric (DELETE /api/metrics/:id). Does not affect the " +
        "underlying DataType. Any panel bound to this metric is UNBOUND, not deleted (its " +
        "metric reference is cleared, matching the existing unbind-not-delete convention for a " +
        "deleted DataType/data source). Owner-only — a non-owner gets 403, an unknown id 404. " +
        "Irreversible.",
      inputSchema: { metricId: z.string().min(1) },
    },
    ({ metricId }) => guarded(() => api.deleteMetric(metricId)),
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
        "Create + bind panels first, then call this with their ids and your chosen sizes — no need to " +
        "reimplement shelf-packing/clamping client-side.",
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
