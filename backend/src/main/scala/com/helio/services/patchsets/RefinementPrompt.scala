package com.helio.services.patchsets

import com.helio.api.protocols.panels.PanelCapabilitiesResponse
import com.helio.api.protocols.pipelines.{PipelineStepProtocol, PipelineStepResponse, PipelineSummaryResponse}
import com.helio.api.protocols.workspace.WorkspaceContextOutput
import com.helio.domain.model.{Dashboard, Panel}
import spray.json.JsObject

/** Builds the natural-language prompt `RefinementService` sends to `ClaudeClient` (design.md D2a) —
 *  kept in its own file so neither this nor `RefinementService` grows past CONTRIBUTING's ~250-line
 *  soft budget; the large worked-example text itself lives in `RefinementEditShape` (split out for
 *  the same budget reason — this file holds only orchestration).
 *
 *  HEL-390's `ClaudeRequest` models only `user`/`assistant` messages, no separate `system` field (see
 *  `com.helio.ai.ClaudeModels`) — so the instructions + grounding context + the user's message are
 *  all composed into ONE initial `user` message, exactly mirroring `DashboardAuthoringPrompt`'s own
 *  precedent.
 *
 *  Extends `PipelineStepProtocol` (skeptic-final-1.md finding) solely for `pipelineStepResponseFormat`
 *  — `pipelineStateText` needs it to serialize each step's REAL current `config` into the grounding
 *  block (see that method's own doc comment for why this is load-bearing, not cosmetic). */
object RefinementPrompt extends PipelineStepProtocol {

  private val Instructions: String =
    "You are refining an EXISTING Helio dashboard or pipeline from a user's natural-language message. " +
      "Respond with ONLY a single JSON object — no prose, no markdown code fences, nothing before or " +
      "after it — matching exactly this shape (a PatchSet):\n\n" + RefinementEditShape.Description + "\n\n" +
      "Rules:\n" +
      "- Every edit's target.id (for update/delete) MUST be a real, currently-existing resource id " +
      "taken from the state listed below — a panel/step/output id from the target's own current " +
      "state, or a resource id from the workspace context. Never invent an id.\n" +
      "- HEL-670: a create edit's real id does NOT exist until the WHOLE patch set has been applied " +
      "— never emit a second edit in the SAME patch set whose target.id is meant to mean \"the thing " +
      "the create edit above just made\". If a message wants both a create AND an immediate follow-up " +
      "change to that exact same new resource, put the COMPLETE desired end state directly in the " +
      "create edit's own patch instead of splitting it across two edits — never guess or reuse an " +
      "unrelated existing id as a stand-in for a not-yet-created one; that silently mutates the wrong " +
      "real resource instead of failing loudly.\n" +
      "- A panel edit's config.outputId (create or update) MUST be a real, currently-existing Output " +
      "id from the state listed below — an output-kind panel has NO fieldMapping/aggregation/" +
      "chartType/baseType/layout/timelineOptions of its own at all; those all live on the Output " +
      "itself (target.kind: \"output\"), never on the panel.\n" +
      "- An output edit's config.fieldMapping (create or update) MUST only use slot names that " +
      "output kind's panel-capability entry below marks bindable, and each mapped value MUST be a " +
      "column name that EXISTS in that Output's own node's projected schema (shown below) — not the " +
      "trunk's, not a sibling tail's, if this Output targets a specific step.\n" +
      "- A pipelineStep UPDATE edit's config MUST be a COMPLETE config matching that step's REAL " +
      "current config shown in \"Current steps\" below — carry over every existing key unchanged " +
      "except the one(s) the message actually asks to change. NEVER emit a guessed, abbreviated, or " +
      "differently-named key set: an unrecognized key is silently DROPPED (not rejected) by this " +
      "step's decoder, which can silently empty out the step's real behavior even though the call " +
      "still succeeds. This applies to EVERY pipelineStep kind, not only the ones with a worked " +
      "example below. Two kinds with easily-confused, similarly-named shapes: an \"aggregate\" step's " +
      "config needs groupBy:[{name,type}] objects and aggregations:[{alias,fn,field}] objects (fn is " +
      "one of sum|avg|min|max|count); a \"groupby\" step's config is a DIFFERENT, single-aggregation " +
      "shape — groupBy:[string] (plain strings, not objects), aggColumn:string, aggFunction:string. " +
      "Never mix the two kinds' key names.\n" +
      "- If the message can only be partially satisfied from the state/data available, return the " +
      "best-effort patch set you can build from what is listed below — never fabricate an id.\n" +
      "- Return one Edit per distinct change; an empty edits array is valid if nothing should change."

  /** One line per current panel, including its REAL id (AC5's "grounded in current state" — the exact
   *  fact `spec.md`'s "A dashboard refinement grounds in its current panels" scenario asserts on). */
  def dashboardStateText(dashboard: Dashboard, panels: Vector[Panel]): String = {
    val panelLines =
      if (panels.isEmpty) "  (no panels yet)"
      else
        panels
          .map { p =>
            s"""  - panel id="${p.id.value}" title="${p.title}" type=${p.kind}"""
          }
          .mkString("\n")
    s"""Target: dashboard id="${dashboard.id.value}" name="${dashboard.name}"
       |Current panels:
       |$panelLines""".stripMargin
  }

  /** One line per current step, including its REAL id (AC5's pipeline-target analogue) AND its REAL
   *  current `config` (skeptic-final-1.md finding, D2a's pipelineStep gap) — an UPDATE edit's config
   *  Rules requirement below ("carry over every existing field, change only what's asked") is
   *  meaningless unless the model can actually SEE the current shape to carry over; before this fix,
   *  only `id`/`position`/`type` were shown, so the model had no current-config anchor at all and
   *  routinely guessed a plausible-looking but wrong key set (`{as,op}` instead of `{alias,fn}` for
   *  an `aggregate` step, silently dropped by `AggregateConfig.decode`'s tolerant `flatMap` — see
   *  that file's own doc comment). `pipelineStepResponseFormat.write` reuses the SAME per-subtype
   *  dispatch `GET /api/pipelines/:id/steps` itself serializes through — never a re-derived shape. */
  def pipelineStateText(summary: PipelineSummaryResponse, steps: Vector[PipelineStepResponse]): String = {
    val stepLines =
      if (steps.isEmpty) "  (no steps yet)"
      else
        // HEL-904 follow-on ruling: `steps` arrives already in executionOrder
        // (trunk/tail structural order, via PipelineService.listSteps ->
        // listByPipelineInternal) -- a `.sortBy(_.position)` here would
        // re-break the order, since every trunk step's `position` is now
        // constantly `0`.
        steps
          .map { s =>
            val configJson = pipelineStepResponseFormat.write(s).asJsObject.fields.getOrElse("config", JsObject.empty)
            s"""  - step id="${s.id}" position=${s.position} type=${s.`type`} config=${configJson.compactPrint}"""
          }
          .mkString("\n")
    s"""Target: pipeline id="${summary.id}" name="${summary.name}"
       |Current steps:
       |$stepLines""".stripMargin
  }

  /** Mirrors `DashboardAuthoringPrompt.groundingSection`/`capabilityMenuFor` verbatim — one line per
   *  workspace-wide pipeline-output DataType: its id/name, columns, and its panel-capability menu
   *  (HEL-365) — so a create edit binding a DataType not yet used on the target dashboard has
   *  something to bind to (AC5). */
  private def groundingSection(
      dataTypes: Vector[WorkspaceContextOutput],
      capabilities: Map[String, PanelCapabilitiesResponse]
  ): String = {
    val entries = dataTypes.map { dt =>
      val columns = dt.columns.map(c => s"${c.name} (${c.dataType}, ${c.semanticRole})").mkString(", ")
      val capText = capabilities.get(dt.id).map(capabilityMenuFor).getOrElse("no panel-capability data available for this data type")
      s"- DataType id=${dt.id} name=\"${dt.name}\"\n  columns: $columns\n  panel capabilities: $capText"
    }
    if (entries.isEmpty) "Available pipeline-output data types: (none yet)"
    else "Available pipeline-output data types:\n" + entries.mkString("\n")
  }

  private def capabilityMenuFor(capabilities: PanelCapabilitiesResponse): String = {
    val bindableKinds = capabilities.capabilities.collect { case (kind, capability) if capability.bindable =>
      s"$kind(required=${capability.requiredSlots.mkString(",")}; optional=${capability.optionalSlots.mkString(",")})"
    }
    if (bindableKinds.isEmpty) "none bindable" else bindableKinds.mkString("; ")
  }

  private def targetStateText(ctx: RefinementGroundedContext): String =
    (ctx.dashboard, ctx.pipeline) match {
      case (Some((dashboard, panels)), _) => dashboardStateText(dashboard, panels)
      case (_, Some((summary, steps)))    => pipelineStateText(summary, steps)
      // Unreachable in real use: RefinementGrounding.assemble always populates exactly one side,
      // matching the request's own target.kind, before this is ever called.
      case _ => "Target: (no live state available)"
    }

  def userMessage(ctx: RefinementGroundedContext, message: String): String =
    Instructions + "\n\n" + targetStateText(ctx) + "\n\n" + groundingSection(ctx.dataTypes, ctx.capabilities) +
      "\n\nUser message: " + message

  /** Design.md D2's single repair round-trip: fed back alongside the model's own prior response (as
   *  an `assistant` message) so the model sees exactly what it said and exactly why it was rejected —
   *  mirrors `DashboardAuthoringPrompt.repairMessage` verbatim. */
  def repairMessage(errorText: String): String =
    "Your previous response was invalid: " + errorText +
      "\n\nRespond again with ONLY a corrected JSON object matching the exact shape described " +
      "above — no prose, no markdown code fences."
}
