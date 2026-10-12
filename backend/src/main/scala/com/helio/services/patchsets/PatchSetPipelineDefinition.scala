package com.helio.services.patchsets

import com.helio.api.protocols.pipelines.PipelineStepResponse
import com.helio.domain.model.PipelineId
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
import PatchSetApplyServiceJson._
import spray.json._

import scala.concurrent.{ExecutionContext, Future}

/** A pipeline's definition for the patch-set fingerprint (HEL-1458): the summary fields apply reads (name, tag, roots)
 *  plus everything that is deleted with the pipeline and is configuration rather than data -- its steps, Outputs and
 *  schedule. Run history, payload history and snapshots are data and are left out, as are tick- and run-maintained
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
    } yield {
      val (steps, rootIds) = stepsAndRoots
      val rootIdByStep     = rootIds.map { case (step, root) => step.value -> root.value }
      val stepJson = steps
        .map(step => pick(pipelineStepResponseFormat.write(PipelineStepResponse.fromDomain(step, rootIdByStep)), StepKeys))
        .sortBy(_.fields("id").toString)
      val outputJson = outputs.map { output =>
        pick(outputResponseFormat.write(outputResponseFrom(output, configs.getOrElse(output.id.value, JsObject.empty))), OutputKeys)
      }
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

  private def pick(json: JsValue, keys: Vector[String]): JsObject = {
    val fields = json.asJsObject.fields
    JsObject(keys.flatMap(key => fields.get(key).map(key -> _)).toMap)
  }
}
