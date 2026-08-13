package com.helio.services

import com.helio.api.protocols.{PanelCapabilitiesResponse, WorkspaceContextDataType}

/** Builds the natural-language prompt `DashboardAuthoringService` sends to `ClaudeClient`
 *  (HEL-392 design.md D4) — kept in its own file so neither this nor `DashboardAuthoringService`
 *  grows past CONTRIBUTING's ~250-line soft budget.
 *
 *  HEL-390's `ClaudeRequest` models only `user`/`assistant` messages, no separate `system` field
 *  (see `com.helio.ai.ClaudeModels`) — so the instructions + grounding context + the user's goal
 *  are all composed into ONE initial `user` message, not a distinct system prompt. */
object DashboardAuthoringPrompt {

  /** The `DashboardProposal`/`ProposalPanel` wire shape, described textually (design.md D4 —
   *  "schema included verbatim in the prompt"). `schemas/dashboard-proposal.schema.json` itself
   *  isn't on the production classpath (it's read at test time only, by walking the filesystem —
   *  see `JsonSchemaValidation`), so this is a hand-maintained mirror of that schema's fields —
   *  keep the two in sync by hand if `ProposalPanel`'s fields change. */
  private val ProposalShapeDescription: String =
    """{
      |  "dashboardName": "string, required, 1-120 chars",
      |  "panels": [
      |    {
      |      "title": "string, required, 1-160 chars",
      |      "type": "one of: metric | chart | table | text | markdown | image | collection | timeline",
      |      "dataTypeId": "string — REQUIRED for metric/chart/table/collection/timeline; must be one of the pipeline-output DataType ids listed below",
      |      "fieldMapping": "object, panel-type-specific column bindings — metric {value,label?,unit?}; chart {xAxis,yAxis,series?}; table {columns}",
      |      "aggregation": "object, optional — metric {value,agg} or chart {groupBy,agg,yField}; agg is one of count|sum|avg|min|max",
      |      "content": "string — text/markdown panel body",
      |      "url": "string — image panel URL",
      |      "chartType": "one of: bar | line | pie | scatter — chart panels only",
      |      "xAxisLabel": "string — chart panels only",
      |      "yAxisLabel": "string — chart panels only",
      |      "seriesColors": ["string", "..."],
      |      "label": "string — metric panels only, literal display label",
      |      "unit": "string — metric panels only, literal display unit",
      |      "sort": "asc | desc — timeline panels only",
      |      "layout": { "x": "integer >= 0", "y": "integer >= 0", "w": "integer >= 1", "h": "integer >= 1" }
      |    }
      |  ]
      |}""".stripMargin

  private val Instructions: String =
    "You are authoring a Helio dashboard proposal from a user's natural-language goal. " +
      "Respond with ONLY a single JSON object — no prose, no markdown code fences, nothing before " +
      "or after it — matching exactly this shape:\n\n" + ProposalShapeDescription + "\n\n" +
      "Rules:\n" +
      "- Every data-bound panel's dataTypeId MUST be one of the pipeline-output DataType ids listed " +
      "below. Never invent a dataTypeId or bind to a data type not listed.\n" +
      "- Only use a panel kind for a DataType when its panel-capability entry below marks that kind " +
      "bindable, and only reference columns that entry lists as eligible.\n" +
      "- If the goal can only be partially satisfied from the data available, return the best-effort " +
      "proposal you can build from what is listed below — never fabricate a dataTypeId or column."

  /** One line per pipeline-output DataType: its id/name, columns (name/type/semantic role, from the
   *  HEL-371 grounding context), and its panel-capability menu (HEL-365) — the exact per-DataType
   *  facts the spec.md "grounded in the caller's real data types" scenario asserts on. */
  private def groundingSection(
      dataTypes: Vector[WorkspaceContextDataType],
      capabilities: Map[String, PanelCapabilitiesResponse]
  ): String = {
    val entries = dataTypes.map { dt =>
      val columns = dt.columns.map(c => s"${c.name} (${c.dataType}, ${c.semanticRole})").mkString(", ")
      val capText = capabilities.get(dt.id).map(capabilityMenuFor).getOrElse("no panel-capability data available for this data type")
      s"- DataType id=${dt.id} name=\"${dt.name}\"\n  columns: $columns\n  panel capabilities: $capText"
    }
    "Available pipeline-output data types:\n" + entries.mkString("\n")
  }

  private def capabilityMenuFor(capabilities: PanelCapabilitiesResponse): String = {
    val bindableKinds = capabilities.capabilities.collect { case (kind, capability) if capability.bindable =>
      s"$kind(required=${capability.requiredSlots.mkString(",")}; optional=${capability.optionalSlots.mkString(",")})"
    }
    if (bindableKinds.isEmpty) "none bindable" else bindableKinds.mkString("; ")
  }

  def userMessage(
      goal: String,
      dataTypes: Vector[WorkspaceContextDataType],
      capabilities: Map[String, PanelCapabilitiesResponse]
  ): String =
    Instructions + "\n\n" + groundingSection(dataTypes, capabilities) + "\n\nUser goal: " + goal

  /** Design.md D5's single repair round-trip: fed back alongside the model's own prior response
   *  (as an `assistant` message) so the model sees exactly what it said and exactly why it was
   *  rejected. */
  def repairMessage(errorText: String): String =
    "Your previous response was invalid: " + errorText +
      "\n\nRespond again with ONLY a corrected JSON object matching the exact shape described " +
      "above — no prose, no markdown code fences."
}
