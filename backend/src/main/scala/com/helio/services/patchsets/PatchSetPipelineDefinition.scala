package com.helio.services.patchsets

import com.helio.api.protocols.pipelines.PipelineStepResponse
import com.helio.domain.model.PipelineId
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
      val rootIdByStep     = rootIds.map { case (step, root) => step.value -> root.value }
      val stepJson = steps
        .map(step => pick(pipelineStepResponseFormat.write(PipelineStepResponse.fromDomain(step, rootIdByStep)), StepKeys))
        .sortBy(_.fields("id").toString)
      val outputJson = outputs.map { output =>
        val own = pick(outputResponseFormat.write(outputResponseFrom(output, configs.getOrElse(output.id.value, JsObject.empty))), OutputKeys)
        JsObject(own.fields +
          ("panelIds" -> JsArray(panelIds.getOrElse(output.id.value, Vector.empty).map(JsString(_)))) +
          ("alertRules" -> JsArray(alertRules.getOrElse(output.id.value, Vector.empty).map(alertRuleJson))))
      }.sortBy(_.fields("id").toString)
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
