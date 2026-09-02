package com.helio.services.proposals

import com.helio.api.protocols.agents.AgentPreferencesResponse
import com.helio.api.protocols.panels.PanelCapabilitiesResponse
import com.helio.api.protocols.workspace.{WorkspaceContextAgentSection, WorkspaceContextOutput}

/** Builds the natural-language prompt `DashboardAuthoringService` sends to `ClaudeClient`
 *  (HEL-392 design.md D4) — kept in its own file so neither this nor `DashboardAuthoringService`
 *  grows past CONTRIBUTING's ~250-line soft budget.
 *
 *  HEL-390's `ClaudeRequest` models only `user`/`assistant` messages, no separate `system` field
 *  (see `com.helio.ai.ClaudeModels`) — so the instructions + grounding context + the user's goal
 *  are all composed into ONE initial `user` message, not a distinct system prompt. */
object DashboardAuthoringPrompt {

  /** The `DashboardProposal`/`ProposalPanel` wire shape, described textually (design.md D4 —
   *  "schema included verbatim in the prompt"). `schemas/dashboards/dashboard-proposal.schema.json` itself
   *  isn't on the production classpath (it's read at test time only, by walking the filesystem —
   *  see `JsonSchemaValidation`), so this is a hand-maintained mirror of that schema's fields —
   *  keep the two in sync by hand if `ProposalPanel`'s fields change. */
  private val ProposalShapeDescription: String =
    """{
      |  "dashboardName": "string, required, 1-120 chars",
      |  "panels": [
      |    {
      |      "title": "string, required, 1-160 chars",
      |      "type": "one of: text | markdown | image | output",
      |      "outputId": "string — REQUIRED for output panels; must be one of the pipeline-output Output ids listed below (the field is named outputId for wire-schema stability, but the value is actually an Output id)",
      |      "content": "string — text/markdown panel body",
      |      "url": "string — image panel URL",
      |      "layout": { "x": "integer >= 0", "y": "integer >= 0", "w": "integer >= 1", "h": "integer >= 1" }
      |    }
      |  ]
      |}""".stripMargin

  private val Instructions: String =
    "You are authoring a Helio dashboard proposal from a user's natural-language goal. " +
      "Respond with ONLY a single JSON object — no prose, no markdown code fences, nothing before " +
      "or after it — matching exactly this shape:\n\n" + ProposalShapeDescription + "\n\n" +
      "Rules:\n" +
      "- Every output panel's outputId MUST be one of the pipeline-output Output ids listed " +
      "below. Never invent an id or bind to an Output not listed.\n" +
      "- Only use the output panel kind for an Output when its panel-capability entry below marks " +
      "it bindable.\n" +
      "- If the goal can only be partially satisfied from the data available, return the best-effort " +
      "proposal you can build from what is listed below — never fabricate an id."

  /** One line per pipeline-output DataType: its id/name, columns (name/type/semantic role, from the
   *  HEL-371 grounding context), and its panel-capability menu (HEL-365) — the exact per-DataType
   *  facts the spec.md "grounded in the caller's real data types" scenario asserts on. */
  private def groundingSection(
      dataTypes: Vector[WorkspaceContextOutput],
      capabilities: Map[String, PanelCapabilitiesResponse]
  ): String = {
    val entries = dataTypes.map { dt =>
      val columns = dt.columns.map(c => s"${c.name} (${c.dataType}, ${c.semanticRole})").mkString(", ")
      val capText = capabilities.get(dt.id).map(capabilityMenuFor).getOrElse("no panel-capability data available for this data type")
      s"- Output id=${dt.id} name=\"${dt.name}\"\n  columns: $columns\n  panel capabilities: $capText"
    }
    "Available pipeline Outputs:\n" + entries.mkString("\n")
  }

  private def capabilityMenuFor(capabilities: PanelCapabilitiesResponse): String = {
    val bindableKinds = capabilities.capabilities.collect { case (kind, capability) if capability.bindable =>
      s"$kind(required=${capability.requiredSlots.mkString(",")}; optional=${capability.optionalSlots.mkString(",")})"
    }
    if (bindableKinds.isEmpty) "none bindable" else bindableKinds.mkString("; ")
  }

  /** HEL-521 (420-C) design.md Decision 5: a compact "the user generally prefers/knows..." block,
   *  appended after `groundingSection`'s existing output -- kept as its own small,
   *  self-contained function rather than interleaved with the per-DataType grounding text, so it
   *  reads as its own paragraph to the model and `groundingSection`'s existing, already-tested
   *  signature stays untouched. Returns `""` when BOTH `preferences` and `memory` are empty (spec
   *  scenario "Prompt omits the section cleanly when agentContext is empty" -- never a bare header
   *  with nothing under it). `private[services]` so `DashboardAuthoringPromptSpec` can unit-test
   *  it directly. */
  private[services] def agentContextSection(agentContext: WorkspaceContextAgentSection): String = {
    val preferencesLine = preferencesSummary(agentContext.preferences)
    val memoryLines      = agentContext.memory.map(m => s"- (${m.kind}) ${m.content}")

    if (preferencesLine.isEmpty && memoryLines.isEmpty) ""
    else {
      val sections = Vector(
        preferencesLine.map(line => s"User preferences: $line"),
        if (memoryLines.isEmpty) None
        else Some("Remembered facts/goals/preferences about this user:\n" + memoryLines.mkString("\n"))
      ).flatten
      sections.mkString("\n\n")
    }
  }

  /** `None` when every field is empty/absent -- `extras` is always a present `JsObject` on the
   *  wire (never `Option`), so an empty `{}` there must NOT by itself make this `Some("")`. */
  private def preferencesSummary(prefs: AgentPreferencesResponse): Option[String] = {
    val bits = Vector(
      prefs.defaultSeriesColors.filter(_.nonEmpty).map(colors => s"default series colors: ${colors.mkString(", ")}"),
      prefs.defaultPanelStyle.filter(_.fields.nonEmpty).map(style => s"default panel style: ${style.compactPrint}"),
      prefs.namingConventions.filter(_.fields.nonEmpty).map(nc => s"naming conventions: ${nc.compactPrint}"),
      if (prefs.extras.fields.nonEmpty) Some(s"other preferences: ${prefs.extras.compactPrint}") else None
    ).flatten
    if (bits.isEmpty) None else Some(bits.mkString("; "))
  }

  def userMessage(
      goal: String,
      dataTypes: Vector[WorkspaceContextOutput],
      capabilities: Map[String, PanelCapabilitiesResponse],
      agentContext: WorkspaceContextAgentSection
  ): String = {
    val agentSection = agentContextSection(agentContext)
    val groundingWithAgent = if (agentSection.isEmpty) groundingSection(dataTypes, capabilities) else groundingSection(dataTypes, capabilities) + "\n\n" + agentSection
    Instructions + "\n\n" + groundingWithAgent + "\n\nUser goal: " + goal
  }

  /** Design.md D5's single repair round-trip: fed back alongside the model's own prior response
   *  (as an `assistant` message) so the model sees exactly what it said and exactly why it was
   *  rejected. */
  def repairMessage(errorText: String): String =
    "Your previous response was invalid: " + errorText +
      "\n\nRespond again with ONLY a corrected JSON object matching the exact shape described " +
      "above — no prose, no markdown code fences."
}
