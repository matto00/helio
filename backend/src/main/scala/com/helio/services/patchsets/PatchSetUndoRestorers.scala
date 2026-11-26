package com.helio.services.patchsets

import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.{LayoutWritePolicy, PanelService}
import com.helio.services.pipelines.{LegacyOutputFormat, PipelineService}
import com.helio.services.sources.DataSourceService
import com.helio.api.protocols.dashboards.DashboardResponse
import com.helio.api.protocols.sources.{DataSourceResponse, UpdateDataSourceRequest}
import com.helio.api.protocols.pipelines.{OutputResponse, PipelineSummaryResponse, UpdatePipelineRequest, UpdatePipelineStepRequest}
import com.helio.api.protocols.patchsets.EditUndoOutcome
import com.helio.api.protocols.panels.PanelResponse
import com.helio.domain.model.{AuthenticatedUser, DashboardId, DataFieldType, DataSourceId, OutputKind, PanelId, PipelineId, PipelineStepId}
import com.helio.domain.engine.SchemaField
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository.JournaledEdit
import PatchSetApplyServiceJson._
import PatchSetUndoRestorers.{missingPriorState, restoreFailed}
import spray.json._

import scala.concurrent.{ExecutionContext, Future}

/** The update and delete restorers of [[PatchSetUndoService]] (HEL-1797 split): each restores one journaled edit through
 *  the same per-kind service method the apply/rollback paths use. The walk, its logger, the guard wrappers and the
 *  create-undo arms stay in the service. */
private[patchsets] final class PatchSetUndoRestorers(
    panelService: PanelService,
    dashboardService: DashboardService,
    dataSourceService: DataSourceService,
    pipelineService: PipelineService,
    context: PatchSetUndoContext
)(implicit ec: ExecutionContext) {

  def restorePanelUpdate(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[String, EditUndoOutcome]] =
    edit.priorState match {
      case None => Future.successful(Left(missingPriorState(edit)))
      case Some(json) =>
        val prior = json.convertTo[PanelResponse]
        panelService.update(PanelId(prior.id), PatchSetUndoInverse.fullPanelInverse(prior), user).map {
          case Right(panel) =>
            Right(EditUndoOutcome(edit.index, "restored", None, Some(panelResponseFormat.write(PanelResponse.fromDomain(panel)))))
          case Left(err) => Left(restoreFailed(edit, err.message))
        }
    }

  /** design.md D5: a `panel` `delete` edit's undo recreates under a NEW id (inherited unchanged
   *  from `PatchSetApplyRollback`'s own D3a v1 limit — no existing API accepts a caller-specified
   *  id, so a dashboard's layout entry for the OLD id is not repointed). */
  def restorePanelDelete(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[String, EditUndoOutcome]] =
    edit.priorState match {
      case None => Future.successful(Left(missingPriorState(edit)))
      case Some(json) =>
        val prior = json.convertTo[PanelResponse]
        panelService.create(PatchSetUndoInverse.panelCreateRequestFromResponse(prior), user).map {
          case Right((panel, _)) =>
            Right(EditUndoOutcome(edit.index, "recreated", Some(panel.id.value), Some(panelResponseFormat.write(PanelResponse.fromDomain(panel)))))
          case Left(err) => Left(restoreFailed(edit, err.message))
        }
    }


  def restoreDashboardUpdate(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[String, EditUndoOutcome]] =
    edit.priorState match {
      case None => Future.successful(Left(missingPriorState(edit)))
      case Some(json) =>
        val prior = json.convertTo[DashboardResponse]
        dashboardService.update(DashboardId(prior.id), PatchSetUndoInverse.fullDashboardInverse(prior), user, LayoutWritePolicy.RestorePriorStored).map {
          case Right(dashboard) =>
            Right(EditUndoOutcome(edit.index, "restored", None, Some(dashboardResponseFormat.write(DashboardResponse.fromDomain(dashboard)))))
          case Left(err) => Left(restoreFailed(edit, err.message))
        }
    }


  def restoreDataSourceUpdate(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[String, EditUndoOutcome]] =
    edit.priorState match {
      case None => Future.successful(Left(missingPriorState(edit)))
      case Some(json) =>
        val prior = json.convertTo[DataSourceResponse]
        dataSourceService.update(DataSourceId(prior.id), UpdateDataSourceRequest(name = Some(prior.name)), user).map {
          case Right(ds) =>
            Right(EditUndoOutcome(edit.index, "restored", None, Some(dataSourceResponseFormat.write(DataSourceResponse.fromDomain(ds)))))
          case Left(err) => Left(restoreFailed(edit, err.message))
        }
    }


  def restorePipelineUpdate(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[String, EditUndoOutcome]] =
    edit.priorState match {
      case None => Future.successful(Left(missingPriorState(edit)))
      case Some(json) =>
        val prior = json.convertTo[PipelineSummaryResponse]
        pipelineService.updateName(PipelineId(prior.id), UpdatePipelineRequest(name = prior.name), user).map {
          case Right(summary) =>
            Right(EditUndoOutcome(edit.index, "restored", None, Some(pipelineSummaryResponseFormat.write(summary))))
          case Left(err) => Left(restoreFailed(edit, err.message))
        }
    }

  // ── pipelineStep (HEL-914 task 5.2: create added below) ────────────────────

  def restorePipelineStepUpdate(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[String, EditUndoOutcome]] =
    edit.priorState match {
      case None => Future.successful(Left(missingPriorState(edit)))
      case Some(json) =>
        val fields = json.asJsObject.fields
        val idStr  = fields.get("id").map(_.convertTo[String]).getOrElse("")
        pipelineService.updateStep(PipelineStepId(idStr), PatchSetUndoInverse.fullPipelineStepInverse(json), user).map {
          case Right(step) =>
            Right(EditUndoOutcome(edit.index, "restored", None, Some(pipelineStepResponseFormat.write(step))))
          case Left(err) => Left(restoreFailed(edit, err.message))
        }
    }

  /** design.md D5 (mirrors `PatchSetApplyRollback.compensatePipelineStepDelete`): recreate via
   *  `addStep`, then `updateStep(position = ...)` if it landed elsewhere (a new step is always
   *  appended). Reports `recreated` with whichever id ends up correct even if the reposition
   *  follow-up itself fails -- content restoration (not position) is the bar. */
  /** HEL-914 task 5.8 (patch-set-lane-edits spec, "Removing a lane by patch set and undoing it
   *  restores its Outputs and placements"): the journaled `priorState` for a `pipelineStep`
   *  delete is `{"step": <PipelineStepResponse>, "boundOutputs": [{"output": <OutputResponse>,
   *  "placements": [<PanelResponse>, ...]}, ...]}` (`PatchSetPipelineStepResolvers
   *  .buildPipelineStepDeletePriorState`) -- unwrapped here, tolerating a LEGACY journal entry
   *  that predates this fix (the bare step JSON, no `"boundOutputs"` key) by treating the whole
   *  value as the step JSON in that case. Recreates the step first (unchanged from before), then
   *  every bound Output (under the recreated step's NEW id) and every one of THOSE Outputs'
   *  placements (under each new Output's NEW id) -- same "recreate under a new id" v1 limit
   *  `PatchSetUndoInverse.panelCreateRequestFromResponse` already documents for a plain panel
   *  delete-undo. */
  def restorePipelineStepDelete(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[String, EditUndoOutcome]] =
    edit.priorState match {
      case None => Future.successful(Left(missingPriorState(edit)))
      case Some(json) =>
        val obj = json.asJsObject
        val (stepJson, boundOutputsJson) = obj.fields.get("boundOutputs") match {
          case Some(arr) => (obj.fields.getOrElse("step", json), arr)
          case None      => (json, JsArray()) // legacy journal entry, pre-task-5.8
        }
        val fields        = stepJson.asJsObject.fields
        val pipelineIdStr = fields.get("pipelineId").map(_.convertTo[String]).getOrElse("")
        val positionOpt   = fields.get("position").map(_.convertTo[Int])
        pipelineService.addStep(PipelineId(pipelineIdStr), PatchSetUndoInverse.pipelineStepCreateRequestFromResponse(stepJson), user).flatMap {
          case Left(err) => Future.successful(Left(restoreFailed(edit, err.message)))
          case Right(created) =>
            val repositionF = positionOpt match {
              case Some(pos) if pos != created.position =>
                pipelineService.updateStep(PipelineStepId(created.id), UpdatePipelineStepRequest(None, None, Some(pos)), user).map {
                  case Right(repositioned) => repositioned
                  // Content is restored even though the reposition follow-up failed -- still
                  // `recreated`, not a Phase-2 failure (mirrors PatchSetApplyRollback's identical choice).
                  case Left(_) => created
                }
              case _ => Future.successful(created)
            }
            repositionF.flatMap { finalStep =>
              restoreBoundOutputs(finalStep.id, boundOutputsJson, user).map { _ =>
                Right(EditUndoOutcome(edit.index, "recreated", Some(finalStep.id), Some(pipelineStepResponseFormat.write(finalStep))))
              }
            }
        }
    }

  def restoreBoundOutputs(newStepId: String, boundOutputsJson: JsValue, user: AuthenticatedUser): Future[Unit] = {
    val entries = boundOutputsJson match {
      case arr: JsArray => arr.elements
      case _            => Vector.empty
    }
    Future.traverse(entries) { entry =>
      val entryObj       = entry.asJsObject
      val outputResponse = entryObj.fields("output").convertTo[OutputResponse]
      val placements      = entryObj.fields.get("placements").map(_.convertTo[Vector[PanelResponse]]).getOrElse(Vector.empty)
      val kind            = OutputKind.fromString(outputResponse.kind).getOrElse(OutputKind.Table)
      val schema          = outputResponse.schema.flatMap(f => DataFieldType.fromString(f.`type`).map(t => SchemaField(f.name, DataFieldType.asString(t))))
      // HEL-1313: raw restore of previously stored data -- deliberately NOT run through
      // OutputConfigValidation; restoring stored state must never be refused. HEL-1409/HEL-1441: but a
      // journal written before V117/V118 may hold the V94/HEL-877 dead keys or an object `format`, so the
      // config is normalised (V117 then V118 mapping) rather than written raw -- the journal is untouched.
      context.outputRepo.insertInternal(
        PipelineId(outputResponse.pipelineId), Some(PipelineStepId(newStepId)), user.id, outputResponse.name, kind,
        config = LegacyOutputFormat.normaliseRestored(kind, outputResponse.config.asJsObject), schema = schema, tag = None, explicitRootId = None, actor = user
      ).flatMap { newOutput =>
        Future.traverse(placements) { panelResponse =>
          val baseRequest = PatchSetUndoInverse.panelCreateRequestFromResponse(panelResponse)
          val patchedConfig = baseRequest.config.map { cfg =>
            JsObject(cfg.asJsObject.fields + ("outputId" -> JsString(newOutput.id.value))): JsValue
          }
          panelService.create(baseRequest.copy(config = patchedConfig), user)
        }
      }
    }.map(_ => ())
  }

}

private[patchsets] object PatchSetUndoRestorers {
  def missingPriorState(edit: JournaledEdit): String =
    s"edit ${edit.index} (${edit.targetKind} ${edit.op}): journal is missing its captured prior state"

  def restoreFailed(edit: JournaledEdit, message: String): String =
    s"edit ${edit.index} (${edit.targetKind} ${edit.op}): restore failed: $message"
}
