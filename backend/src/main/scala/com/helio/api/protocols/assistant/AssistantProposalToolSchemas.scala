package com.helio.api.protocols.assistant

import com.helio.ai.ClaudeTool
import spray.json._

/** JSON-Schema `inputSchema`s for the 4 `propose_*` `ClaudeTool`s (HEL-662 tasks.md 2.4), plus
 *  `test_connection` (HEL-756 tasks.md 1.1) — each mirrors the matching JSON Schema file under
 *  `schemas/` closely enough for Claude's function-calling contract (property names/types/enums),
 *  reusing the SAME hand-rolled-`JsObject` style `WorkspaceAssistantTools` already established for
 *  `find`/`get_resource`. Not a byte-for-byte copy of the JSON Schema files: `$defs`/`$ref`/
 *  `additionalProperties: false` are 2020-12 machinery a tool-call `input_schema` doesn't need —
 *  nested fragments are inlined directly instead.
 *
 *  HEL-700 design.md D2: each schema below also carries a top-level `"examples"` array — one
 *  fully-formed input, authored as a compact parsed-string-literal (`"""...""".parseJson`), never a
 *  hand-rolled `JsObject` tree (unreadable for a whole dashboard/pipeline/patch-set payload). Every
 *  entry is pinned by a decode-round-trip test in `AssistantProposalToolSchemasSpec` through the SAME
 *  `convertTo[T]` path a real `tool_use.input` hits (`AssistantToolExecutor.decode`) — an example
 *  cannot silently drift from the protocol without a red test. Every id in an example is an
 *  obviously-synthetic placeholder (design.md D3) — never a real, dereferenceable resource id.
 *
 *  `private[protocols]`: only `AssistantProtocol` (same package, `object AssistantProtocol extends
 *  AssistantProposalToolSchemas`) needs these vals directly; split into this file purely to keep
 *  `AssistantProtocol.scala` inside CONTRIBUTING's ~250-line soft budget. */
private[protocols] trait AssistantProposalToolSchemas {

  // ── ProposalPanel / DashboardProposal (schemas/dashboards/dashboard-proposal.schema.json) ─────────────────

  private val ProposalPanelLayoutSchema: JsObject = JsObject(
    "type" -> JsString("object"),
    "properties" -> JsObject(
      "x" -> JsObject("type" -> JsString("integer")),
      "y" -> JsObject("type" -> JsString("integer")),
      "w" -> JsObject("type" -> JsString("integer")),
      "h" -> JsObject("type" -> JsString("integer"))
    ),
    "required" -> JsArray(Vector("x", "y", "w", "h").map(JsString(_)))
  )

  private val ProposalPanelSchema: JsObject = JsObject(
    "type" -> JsString("object"),
    "properties" -> JsObject(
      "title" -> JsObject("type" -> JsString("string")),
      // HEL-904 follow-on ruling (final-skeptic-wire-contract-diff-3.md item 5): the retired
      // metric/chart/table/collection/timeline visualization types are gone (Types/Metrics/Panel
      // visualization kinds deleted wholesale, no deprecation -- see the pipelines/outputs remodel
      // design doc); "output" is the sole data-bindable placement kind now. Matches
      // schemas/dashboards/dashboard-proposal.schema.json's own `type` enum exactly (no `divider`
      // here either -- dropped from the proposal flow's agent-facing type set for parity with
      // create_panel, per that schema file's own description).
      "type" -> enumSchema("text", "markdown", "image", "output"),
      "outputId" -> JsObject(
        "type" -> JsString("string"),
        "description" -> JsString(
          "Required for output panels; must be an existing pipeline-output DataType id returned by " +
            "find/get_resource (or, inside propose_combined only, the literal sentinel " +
            "\"$pipelineOutput\"). Omitted for text/markdown/image."
        )
      ),
      "fieldMapping" -> JsObject("type" -> JsString("object")),
      "aggregation"  -> JsObject("type" -> JsString("object")),
      "content"      -> JsObject("type" -> JsString("string")),
      "url"          -> JsObject("type" -> JsString("string")),
      "orientation"  -> enumSchema("horizontal", "vertical"),
      "chartType"    -> enumSchema("bar", "line", "pie", "scatter"),
      "xAxisLabel"   -> JsObject("type" -> JsString("string")),
      "yAxisLabel"   -> JsObject("type" -> JsString("string")),
      "seriesColors" -> JsObject("type" -> JsString("array"), "items" -> JsObject("type" -> JsString("string"))),
      "label"        -> JsObject("type" -> JsString("string")),
      "unit"         -> JsObject("type" -> JsString("string")),
      "sort"         -> enumSchema("asc", "desc"),
      "layout"       -> ProposalPanelLayoutSchema,
      "config"       -> JsObject("type" -> JsString("object"))
    ),
    "required" -> JsArray(Vector(JsString("title"), JsString("type")))
  )

  // HEL-700 design.md D2/D3 — one fully-formed propose_dashboard call, decode-pinned by
  // AssistantProposalToolSchemasSpec against `dashboardProposalFormat`. "dt_example_from_find" is an
  // obviously-synthetic placeholder id, never a real DataType id.
  private val DashboardProposalExample: JsValue =
    """{
      "dashboardName": "Q1 Revenue",
      "panels": [
        {
          "title": "Total Revenue",
          "type": "output",
          "outputId": "dt_example_from_find",
          "fieldMapping": { "value": "amount" },
          "aggregation": { "value": "amount", "agg": "sum" },
          "label": "Total",
          "unit": "USD"
        }
      ]
    }""".parseJson

  private val DashboardProposalSchema: JsObject = JsObject(
    "type" -> JsString("object"),
    "properties" -> JsObject(
      "dashboardName" -> JsObject("type" -> JsString("string")),
      "panels"        -> JsObject("type" -> JsString("array"), "items" -> ProposalPanelSchema)
    ),
    "required" -> JsArray(Vector(JsString("dashboardName"), JsString("panels"))),
    "examples" -> JsArray(Vector(DashboardProposalExample))
  )

  // ── PipelineProposal (schemas/pipelines/pipeline-proposal.schema.json) ───────────────────────────────────

  private val PipelineProposalSourceSchema: JsObject = JsObject(
    "type" -> JsString("object"),
    "properties" -> JsObject(
      "sourceId" -> JsObject(
        "type" -> JsString("string"),
        "description" -> JsString("Existing-source branch — id of a caller-owned DataSource to reuse as-is.")
      ),
      "type" -> JsObject(
        "type" -> JsString("string"),
        "enum" -> JsArray(Vector("csv", "rest_api", "sql", "static").map(JsString(_))),
        "description" -> JsString(
          "Inline-source branch — mutually exclusive with sourceId. csv is not supported by " +
            "propose_pipeline/validate: it requires an uploaded file byte stream this tool has no channel for."
        )
      ),
      "name" -> JsObject("type" -> JsString("string"), "description" -> JsString("Inline-source branch — the new source's display name.")),
      "config" -> JsObject(
        "type" -> JsString("object"),
        "description" -> JsString(
          "Inline-source branch — the per-kind config payload selected by type: rest_api " +
            "{connectorId, endpoint?, method?, queryParams?, headers?} (connectorId must reference an " +
            "already-created Connector; auth lives on the Connector, never here — a bare 'url' legacy " +
            "shape is dual-supported but resolved ephemerally, never persisting a Connector). " +
            "If list_connectors/find found no suitable existing Connector, use newConnector instead of " +
            "connectorId/url: {name, baseUrl, authType, apiKeyName?, apiKeyPlacement?, " +
            "retrievalInstructions} — exactly one of connectorId/url/newConnector must be set. " +
            "retrievalInstructions must describe WHERE a human obtains the key for this API (e.g. " +
            "'Generate an API key at https://dashboard.stripe.com/apikeys') and must NEVER contain an " +
            "actual key value — you are never given a key to leak, and the review UI renders this " +
            "string as display-only instructions, never as a value that can flow anywhere near the " +
            "credential itself; " +
            "sql {dialect, host, port, database, user, password, query}; " +
            "static {columns, rows}."
        )
      )
    )
  )

  private val PipelineProposalStepSchema: JsObject = JsObject(
    "type" -> JsString("object"),
    "properties" -> JsObject(
      "clientId" -> JsObject(
        "type" -> JsString("string"),
        "description" -> JsString(
          "Request-scoped only, never persisted -- lets a LATER step's parentStepId, or an " +
            "output's nodeStepClientId, target this step within the SAME proposal."
        )
      ),
      "type"         -> JsObject("type" -> JsString("string")),
      "config"       -> JsObject("type" -> JsString("object")),
      "parentStepId" -> JsObject(
        "type" -> JsString("string"),
        "description" -> JsString(
          "Optional -- an EARLIER step's clientId in this same proposal to branch off. Absent " +
            "extends the trunk (parented off the previous trunk step, or the source if this is the " +
            "first step)."
        )
      ),
      "enabled" -> JsObject(
        "type" -> JsArray(Vector(JsString("boolean"), JsString("null"))),
        "description" -> JsString(
          "Optional -- whether this step is active in the pipeline. Absent/null defaults to enabled."
        )
      ),
      "rootClientId" -> JsObject(
        "type" -> JsArray(Vector(JsString("string"), JsString("null"))),
        "description" -> JsString(
          "HEL-913: names WHICH root (by its OWN clientId) a PARENTLESS step attaches to -- " +
            "required (and validated) only when the proposal names more than one root; " +
            "meaningless alongside a non-absent parentStepId."
        )
      )
    ),
    "required" -> JsArray(Vector(JsString("clientId"), JsString("type"), JsString("config")))
  )

  // HEL-907 task 1.1: a proposal's Output(s) -- zero, one, or many, each optionally targeting a
  // specific step (by clientId) rather than always the pipeline's final trunk step.
  private val PipelineProposalOutputSchema: JsObject = JsObject(
    "type" -> JsString("object"),
    "properties" -> JsObject(
      "nodeStepClientId" -> JsObject(
        "type" -> JsString("string"),
        "description" -> JsString(
          "Optional -- a step's clientId in this same proposal's steps[] to attach this Output to. " +
            "Absent means the pipeline's raw source (before any step)."
        )
      ),
      "kind" -> JsObject(
        "type" -> JsString("string"),
        "enum" -> JsArray(Vector("table", "metric", "chart", "collection", "timeline", "markdown").map(JsString(_)))
      ),
      "name"   -> JsObject("type" -> JsString("string")),
      "config" -> JsObject("type" -> JsString("object")),
      "rootClientId" -> JsObject(
        "type" -> JsArray(Vector(JsString("string"), JsString("null"))),
        "description" -> JsString(
          "HEL-913: names WHICH root a root-bound Output (nodeStepClientId absent) attaches to " +
            "-- required (and validated) only when the proposal names more than one root; " +
            "meaningless alongside a non-absent nodeStepClientId."
        )
      )
    ),
    "required" -> JsArray(Vector(JsString("kind"), JsString("name")))
  )

  // HEL-700 design.md D2/D3 — inline-source branch (`type`/`name`/`config`, no `sourceId`),
  // demonstrating source-branch exclusivity. Decode-pinned against `pipelineProposalFormat`.
  private val PipelineProposalExample: JsValue =
    """{
      "pipelineName": "Weekly Signups",
      "source": {
        "type": "rest_api",
        "name": "Signups API",
        "config": { "connectorId": "conn_example_from_find", "endpoint": "/signups", "method": "GET" }
      },
      "steps": [
        { "clientId": "s1", "type": "cast", "config": { "casts": { "signups": "integer" } } }
      ],
      "outputs": [
        { "nodeStepClientId": "s1", "kind": "table", "name": "Weekly Signups" }
      ]
    }""".parseJson

  private val PipelineProposalSchema: JsObject = JsObject(
    "type" -> JsString("object"),
    "properties" -> JsObject(
      "pipelineName" -> JsObject("type" -> JsString("string")),
      "source"       -> PipelineProposalSourceSchema,
      "steps"        -> JsObject("type" -> JsString("array"), "items" -> PipelineProposalStepSchema),
      "outputs"      -> JsObject(
        "type" -> JsString("array"),
        "items" -> PipelineProposalOutputSchema,
        "description" -> JsString("Optional -- omit or leave empty to create the pipeline with zero Outputs.")
      )
    ),
    "required" -> JsArray(Vector("pipelineName", "source", "steps").map(JsString(_))),
    "examples" -> JsArray(Vector(PipelineProposalExample))
  )

  // ── CombinedProposal (schemas/authoring/combined-proposal.schema.json) ───────────────────────────────────

  // HEL-700 design.md D2/D3 — the dashboard panel binds to THIS SAME call's pipeline via the literal
  // sentinel "$pipelineOutput" in place of a real outputId (the pipeline's output doesn't exist
  // yet). Decode-pinned against `combinedProposalFormat`; the sentinel must survive the round trip.
  private val CombinedProposalExample: JsValue =
    """{
      "pipeline": {
        "pipelineName": "Weekly Signups",
        "source": {
          "type": "rest_api",
          "name": "Signups API",
          "config": { "connectorId": "conn_example_from_find", "endpoint": "/signups", "method": "GET" }
        },
        "steps": [],
        "outputs": [
          { "kind": "table", "name": "Weekly Signups" }
        ]
      },
      "dashboard": {
        "dashboardName": "Signups Overview",
        "panels": [
          {
            "title": "Weekly Signups",
            "type": "output",
            "outputId": "$pipelineOutput",
            "fieldMapping": { "value": "signups" },
            "aggregation": { "value": "signups", "agg": "sum" }
          }
        ]
      }
    }""".parseJson

  private val CombinedProposalSchema: JsObject = JsObject(
    "type" -> JsString("object"),
    "properties" -> JsObject(
      "pipeline"  -> PipelineProposalSchema,
      "dashboard" -> DashboardProposalSchema
    ),
    "required" -> JsArray(Vector(JsString("pipeline"), JsString("dashboard"))),
    "examples" -> JsArray(Vector(CombinedProposalExample))
  )

  // ── PatchSet (schemas/patch-sets/patch-set.schema.json) ────────────────────────────────────────────────────

  private val EditTargetSchema: JsObject = JsObject(
    "type" -> JsString("object"),
    "properties" -> JsObject(
      "kind" -> enumSchema("panel", "dashboard", "dataSource", "pipeline", "pipelineStep", "output"),
      "id"   -> JsObject("type" -> JsString("string"))
    ),
    "required" -> JsArray(Vector(JsString("kind")))
  )

  private val EditSchema: JsObject = JsObject(
    "type" -> JsString("object"),
    "properties" -> JsObject(
      "target" -> EditTargetSchema,
      "op"     -> enumSchema("update", "delete", "create"),
      "patch" -> JsObject(
        "type" -> JsString("object"),
        "description" -> JsString(
          "Partial update/create body matching target.kind's existing update-request/create-request " +
            "shape. Absent for delete edits. target.id is required for update/delete."
        )
      )
    ),
    "required" -> JsArray(Vector(JsString("target"), JsString("op")))
  )

  // HEL-700 design.md D2/D3 — an update edit with `target.id` present (required for update/delete)
  // and `patch` matching that kind's existing update-request shape. Decode-pinned against
  // `patchSetFormat`. "panel_example_from_find" is an obviously-synthetic placeholder id.
  private val PatchSetExample: JsValue =
    """{
      "summary": "Rename the revenue panel and update its unit",
      "edits": [
        {
          "target": { "kind": "panel", "id": "panel_example_from_find" },
          "op": "update",
          "patch": { "title": "Total Revenue (USD)" }
        }
      ]
    }""".parseJson

  private val PatchSetSchema: JsObject = JsObject(
    "type" -> JsString("object"),
    "properties" -> JsObject(
      "summary" -> JsObject("type" -> JsString("string")),
      "edits"   -> JsObject("type" -> JsString("array"), "items" -> EditSchema)
    ),
    "required" -> JsArray(Vector(JsString("edits"))),
    "examples" -> JsArray(Vector(PatchSetExample))
  )

  //
  // Reuses the same discriminated `type`/`config` shape `PipelineProposalSourceSchema` documents for
  // its inline branch, and the SAME dispatch convention `SourcePreviewRoutes`'s `POST /sources/test`
  // already uses (`type` selects `RestApiConfigPayload` vs. `SqlSourceConfigPayload`) — no new wire
  // shape invented (design.md D5). `config` is nested under a single `"config"` key (unlike
  // `SourcePreviewRoutes`'s flat request body) so Claude passes the EXACT SAME `config` object it
  // will later place at `propose_pipeline`/`propose_combined`'s `source.config` — the value
  // `AssistantToolExecutor.requireVerifiedInlineSource` (design.md D1) compares by equality.

  // HEL-756 tasks.md 2.1 — one rest_api and one sql example, each decode-pinned by
  // AssistantProposalToolSchemasSpec through the SAME `config` → RestApiConfigPayload/
  // SqlSourceConfigPayload conversion path `AssistantToolExecutor.executeTestConnection` applies to
  // a real `tool_use.input`.
  private val TestConnectionRestExample: JsValue =
    """{
      "type": "rest_api",
      "config": { "connectorId": "conn_example_from_find", "endpoint": "/signups", "method": "GET" }
    }""".parseJson

  private val TestConnectionSqlExample: JsValue =
    """{
      "type": "sql",
      "config": {
        "dialect": "postgresql",
        "host": "db.example.com",
        "port": 5432,
        "database": "app",
        "user": "readonly",
        "password": "",
        "query": "SELECT 1"
      }
    }""".parseJson

  private val TestConnectionSchema: JsObject = JsObject(
    "type" -> JsString("object"),
    "properties" -> JsObject(
      "type" -> JsObject(
        "type" -> JsString("string"),
        "enum" -> JsArray(Vector("rest_api", "sql").map(JsString(_))),
        "description" -> JsString("The kind of connector config to test.")
      ),
      "config" -> JsObject(
        "type" -> JsString("object"),
        "description" -> JsString(
          "The per-kind config payload selected by type: rest_api {connectorId, endpoint?, method?, " +
            "queryParams?, headers?} (connectorId must reference an already-created Connector; " +
            "auth lives on the Connector, never here); " +
            "sql {dialect, host, port, database, user, password, query}. Must be the EXACT config " +
            "you intend to pass to propose_pipeline/propose_combined's inline source — verification " +
            "is by exact equality."
        )
      )
    ),
    "required" -> JsArray(Vector(JsString("type"), JsString("config"))),
    "examples" -> JsArray(Vector(TestConnectionRestExample, TestConnectionSqlExample))
  )

  val testConnectionTool: ClaudeTool = ClaudeTool(
    name = "test_connection",
    description =
      "Test that an inline rest_api or sql data source config is actually reachable (DNS " +
        "resolves, connection succeeds). Returns {ok, error?}. REQUIRED, in its own hop, before " +
        "finalizing a propose_pipeline/propose_combined call whose source is an inline rest_api/sql " +
        "config — that call is rejected unless this tool already returned ok = true for the " +
        "IDENTICAL config earlier in the same turn. Not required for a sourceId-referenced source " +
        "or an inline csv/static source.",
    inputSchema = TestConnectionSchema
  )


  val proposeDashboardTool: ClaudeTool = ClaudeTool(
    name = "propose_dashboard",
    description =
      "Propose a new dashboard (name + panels) bound to EXISTING pipeline-output DataTypes. " +
        "Validated but NEVER created — the user reviews and applies it separately. Use when the " +
        "workspace already has data that answers the goal; check get_resource's panelCapabilities " +
        "for a DataType before proposing a panel kind against it.",
    inputSchema = DashboardProposalSchema
  )

  val proposePipelineTool: ClaudeTool = ClaudeTool(
    name = "propose_pipeline",
    description =
      "Propose a new pipeline (source + ordered transform steps + output DataType name). " +
        "Validated but NEVER created. Use when find turns up no existing DataType that can answer " +
        "the goal.",
    inputSchema = PipelineProposalSchema
  )

  val proposeCombinedTool: ClaudeTool = ClaudeTool(
    name = "propose_combined",
    description =
      "Propose a new pipeline AND a dashboard bound to its not-yet-created output, in one atomic " +
        "proposal. A dashboard panel binds to this call's own pipeline by setting its outputId " +
        "(or, for a non-data panel, config.outputId) to the literal sentinel string " +
        "\"$pipelineOutput\". Validated but NEVER created. Use instead of propose_pipeline alone " +
        "when the user also wants a dashboard built from the new pipeline's output in the same turn.",
    inputSchema = CombinedProposalSchema
  )

  val proposePatchSetTool: ClaudeTool = ClaudeTool(
    name = "propose_patch_set",
    description =
      "Propose an ordered list of targeted edits (update/delete/create) against one or more " +
        "EXISTING resources (panel/dashboard/dataSource/pipeline/pipelineStep). Previewed " +
        "but NEVER applied. Use when the goal is refining something that already exists rather than " +
        "creating something new.",
    inputSchema = PatchSetSchema
  )

  private def enumSchema(values: String*): JsObject =
    JsObject("type" -> JsString("string"), "enum" -> JsArray(values.map(JsString(_)).toVector))
}
