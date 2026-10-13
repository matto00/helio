package com.helio.services.patchsets

import com.helio.api.protocols.pipelines.PipelineStepResponse
import com.helio.domain.model.{Output, PipelineId, PipelineRootId, PipelineStep, PipelineStepId}
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
import PatchSetApplyServiceJson._
import spray.json._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/** A pipeline's definition for the patch-set fingerprint (HEL-1458): the summary fields apply reads (name, tag, roots)
 *  plus everything that is deleted with the pipeline and is configuration rather than data -- its steps, Outputs and
 *  schedule, and, through the Output cascade (V94 `ON DELETE CASCADE` on `panels.output_id` and
 *  `alert_rules.target_output_id`), the panels bound to each Output and the alert rules targeting it. Run history, payload history and snapshots are data and are left out, as are tick- and run-maintained
 *  fields (`lastRun*`, timestamps, `next_run_at`).
 *
 *  Children are read with the privileged `*Internal` repository methods: the pipeline was already resolved as the
 *  caller's own by the update/delete resolver, so the ids read here are never caller-supplied. */
private[services] object PatchSetPipelineDefinition {

  private val StepKeys   = Vector("id", "type", "config", "position", "enabled", "parentStepId", "rootId")
  private val OutputKeys = Vector("id", "name", "kind", "nodeStepId", "config")

  def of(summary: PipelineSummary, ctx: PatchSetApplyContext)(implicit ec: ExecutionContext): Future[JsObject] = {
    val pipelineId = PipelineId(summary.id)
    for {
      stepsAndRoots <- ctx.pipelineStepRepo.listWithRootIdsInternal(pipelineId)
      outputs       <- ctx.outputRepo.listByPipelineInternal(pipelineId)
      configs       <- ctx.outputRepo.findConfigsByIdsInternal(outputs.map(_.id.value))
      schedule      <- ctx.pipelineRepo.findScheduleDefinitionInternal(pipelineId)
      outputIds      = outputs.map(_.id.value)
      panelIds      <- ctx.panelRepo.findIdsByOutputIdsInternal(outputIds)
      alertRules    <- ctx.outputRepo.findAlertRuleDefinitionsInternal(outputIds)
    } yield {
      val (steps, rootIds) = stepsAndRoots
      val stepJson   = stepsJson(steps, rootIds)
      val outputJson = outputsJson(outputs, configs, panelIds, alertRules)
      JsObject(
        Map(
          "name"    -> JsString(summary.name),
          "roots"   -> JsArray(summary.roots.map(r => JsObject("id" -> JsString(r.id), "dataSourceId" -> JsString(r.dataSourceId)))),
          "steps"   -> JsArray(stepJson),
          "outputs" -> JsArray(outputJson)
        ) ++ summary.tag.map("tag" -> JsString(_)) ++ schedule.map { case (kind, expression, enabled, timezone) =>
          "schedule" -> JsObject(
            "kind" -> JsString(kind), "expression" -> JsString(expression), "enabled" -> JsBoolean(enabled), "timezone" -> JsString(timezone)
          )
        }
      )
    }
  }

  /** The steps as fingerprinted JSON, sorted by id (shared by the pipeline and step-delete fingerprints). */
  def stepsJson(steps: Vector[PipelineStep], rootIds: Map[PipelineStepId, PipelineRootId]): Vector[JsObject] = {
    val rootIdByStep = rootIds.map { case (step, root) => step.value -> root.value }
    steps
      .map(step => pick(pipelineStepResponseFormat.write(PipelineStepResponse.fromDomain(step, rootIdByStep)), StepKeys))
      .sortBy(_.fields("id").toString)
  }

  /** The Outputs as fingerprinted JSON, each with its bound panel ids and targeting alert rules, sorted by id. The one
   *  projection behind the pipeline, output-delete and step-delete fingerprints (HEL-1522), so they cannot drift. */
  def outputsJson(
      outputs: Vector[Output],
      configs: Map[String, JsObject],
      panelIds: Map[String, Vector[String]],
      alertRules: Map[String, Vector[(String, String, String, String, Boolean, String)]]
  ): Vector[JsObject] =
    outputs.map { output =>
      val own = pick(outputResponseFormat.write(outputResponseFrom(output, configs.getOrElse(output.id.value, JsObject.empty))), OutputKeys)
      JsObject(own.fields +
        ("panelIds" -> panelIdsJson(panelIds.getOrElse(output.id.value, Vector.empty))) +
        ("alertRules" -> alertRulesJson(alertRules.getOrElse(output.id.value, Vector.empty))))
    }.sortBy(_.fields("id").toString)

  def panelIdsJson(ids: Vector[String]): JsArray = JsArray(ids.map(JsString(_)))

  def alertRulesJson(rules: Vector[(String, String, String, String, Boolean, String)]): JsArray = JsArray(rules.map(alertRuleJson))

  /** The Outputs (with their configs, panel ids and alert rules) as fingerprinted JSON. */
  def outputsWithCascade(outputs: Vector[Output], ctx: PatchSetApplyContext)(implicit ec: ExecutionContext): Future[Vector[JsObject]] = {
    val ids = outputs.map(_.id.value)
    for {
      configs    <- ctx.outputRepo.findConfigsByIdsInternal(ids)
      panelIds   <- ctx.panelRepo.findIdsByOutputIdsInternal(ids)
      alertRules <- ctx.outputRepo.findAlertRuleDefinitionsInternal(ids)
    } yield outputsJson(outputs, configs, panelIds, alertRules)
  }

  private def alertRuleJson(rule: (String, String, String, String, Boolean, String)): JsValue = {
    val (id, metric, condition, name, enabled, severity) = rule
    JsObject(
      "id" -> JsString(id), "metric" -> JsString(metric), "condition" -> Try(condition.parseJson).getOrElse(JsString(condition)),
      "name" -> JsString(name), "enabled" -> JsBoolean(enabled), "severity" -> JsString(severity)
    )
  }

  private def pick(json: JsValue, keys: Vector[String]): JsObject = {
    val fields = json.asJsObject.fields
    JsObject(keys.flatMap(key => fields.get(key).map(key -> _)).toMap)
  }
}
