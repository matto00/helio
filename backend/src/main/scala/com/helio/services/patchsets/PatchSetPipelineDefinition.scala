package com.helio.services.patchsets

import com.helio.api.protocols.pipelines.PipelineStepResponse
import com.helio.domain.model.{Output, PipelineId, PipelineRootId, PipelineStep, PipelineStepId}
import com.helio.infrastructure.persistence.pipelines.PipelineRepository.PipelineSummary
import PatchSetApplyServiceJson._
import spray.json._

import slick.dbio.DBIO

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

  /** The definition for a summary the caller already read. Delegates to [[ofAction]], which re-reads the head (name, tag,
   *  roots) itself on the privileged pool, so a rename after the caller's summary read IS reflected; `summary` only supplies
   *  the pipeline id, and its fields stand in when the pipeline has vanished (empty children, as before). */
  def of(summary: PipelineSummary, ctx: PatchSetApplyContext)(implicit ec: ExecutionContext): Future[JsObject] =
    ctx.pipelineRepo.runPrivileged(ofAction(PipelineId(summary.id), ctx)).recover {
      case _: PipelineDefinitionGone => assemble(summary, Vector.empty, Map.empty, Vector.empty, Map.empty, Map.empty, Map.empty, None)
    }

  /** The definition as ONE composable `DBIO` (HEL-1629): the draft save runs it inside its transaction after taking its locks,
   *  and `GET /api/pipelines/:id` runs it on a REPEATABLE READ snapshot. Fails with [[PipelineDefinitionGone]] when the pipeline
   *  does not exist. MUST run on the privileged pool at every call site: it covers other users' panels and alert rules, and a
   *  user-context run would hide them, never match the save's hash, and make the save answer 409 forever. */
  def ofAction(pipelineId: PipelineId, ctx: PatchSetApplyContext)(implicit ec: ExecutionContext): DBIO[JsObject] =
    ctx.pipelineRepo.findDefinitionHeadAction(pipelineId).flatMap {
      case None => DBIO.failed(PipelineDefinitionGone(pipelineId.value))
      case Some(head) =>
        for {
          stepsAndRoots <- ctx.pipelineStepRepo.listWithRootIdsAction(pipelineId)
          outputs       <- ctx.outputRepo.listByPipelineAction(pipelineId)
          outputIds      = outputs.map(_.id.value)
          configs       <- ctx.outputRepo.findConfigsByIdsAction(outputIds)
          schedule      <- ctx.pipelineRepo.findScheduleDefinitionAction(pipelineId)
          panelIds      <- ctx.panelRepo.findIdsByOutputIdsAction(outputIds)
          alertRules    <- ctx.outputRepo.findAlertRuleDefinitionsAction(outputIds)
        } yield assemble(head, stepsAndRoots._1, stepsAndRoots._2, outputs, configs, panelIds, alertRules, schedule)
    }

  private def assemble(
      head: PipelineSummary,
      steps: Vector[PipelineStep],
      rootIds: Map[PipelineStepId, PipelineRootId],
      outputs: Vector[Output],
      configs: Map[String, JsObject],
      panelIds: Map[String, Vector[String]],
      alertRules: Map[String, Vector[(String, String, String, String, Boolean, String)]],
      schedule: Option[(String, String, Boolean, String)]
  ): JsObject =
    JsObject(
      Map(
        "name"    -> JsString(head.name),
        "roots"   -> JsArray(head.roots.map(r => JsObject("id" -> JsString(r.id), "dataSourceId" -> JsString(r.dataSourceId)))),
        "steps"   -> JsArray(stepsJson(steps, rootIds)),
        "outputs" -> JsArray(outputsJson(outputs, configs, panelIds, alertRules))
      ) ++ head.tag.map("tag" -> JsString(_)) ++ schedule.map { case (kind, expression, enabled, timezone) =>
        "schedule" -> JsObject(
          "kind" -> JsString(kind), "expression" -> JsString(expression), "enabled" -> JsBoolean(enabled), "timezone" -> JsString(timezone)
        )
      }
    )

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

/** Raised by [[PatchSetPipelineDefinition.ofAction]] when the pipeline does not exist (a racer deleted it). */
final case class PipelineDefinitionGone(pipelineId: String) extends RuntimeException(s"Pipeline not found: $pipelineId")
