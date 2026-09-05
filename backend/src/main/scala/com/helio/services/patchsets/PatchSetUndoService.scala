package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.PipelineService
import com.helio.services.sources.DataSourceService
import com.helio.api.protocols.dashboards.DashboardResponse
import com.helio.api.protocols.sources.{DataSourceResponse, UpdateDataSourceRequest}
import com.helio.api.protocols.pipelines.{OutputResponse, PipelineSummaryResponse, UpdatePipelineRequest, UpdatePipelineStepRequest}
import com.helio.api.protocols.patchsets.{EditUndoOutcome, PatchSetUndoResponse}
import com.helio.api.protocols.panels.{CreatePanelRequest, PanelResponse}
import com.helio.domain.model.{AuthenticatedUser, DashboardId, DataFieldType, DataSourceId, OutputKind, PanelId, PatchSetApplicationId, PipelineId, PipelineStepId}
import com.helio.domain.engine.SchemaField
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import PatchSetApplicationRepository.JournaledEdit
import PatchSetApplyServiceJson._
import org.slf4j.LoggerFactory
import spray.json._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/** `POST /api/patch-sets/:id/undo` (design.md D4/D4a/D4b/D5) — restores every edit in a
 *  successfully-journaled `PatchSetApplyService.apply` call to its pre-apply state, or none of
 *  them. Two phases, mirroring `PatchSetApplyService`'s own pre-validate-then-act shape:
 *
 *   1. Phase 1 ([[PatchSetUndoConflictCheck]], no mutation): the journal row is loaded (RLS +
 *      owner check via [[PatchSetApplicationRepository.findById]], 404 otherwise), then EVERY
 *      journaled edit's eligibility is determined before any restore begins — a conflicting
 *      `update`/`create` edit, or a structurally-unrecoverable `delete`-kind edit
 *      (`dashboard`/`dataSource`/`dataType`/`pipeline`), each abort the WHOLE undo with `409`,
 *      naming every blocking edit and its reason. Nothing is restored.
 *   2. Phase 2 (this class's own `restoreAll`): reverse-walks the journaled edits (mirrors
 *      `PatchSetApplyRollback`'s own reverse order), restoring each via the SAME per-kind service
 *      method the apply/rollback paths use, reusing [[PatchSetUndoInverse]]'s full-overwrite
 *      request builders. A genuine, Phase-1-undetectable runtime failure stops the walk and
 *      reports every not-yet-reached edit `notAttempted` — edits already restored earlier in that
 *      SAME walk are never compensated back (design.md D4's narrower, explicitly-documented third
 *      guarantee tier). */
// HEL-904 task 3.3: `dataTypeService`/`dataTypeRepo` REMOVED outright --
// `dataType` is no longer a valid target.kind, so undo never restores one.
final class PatchSetUndoService(
    panelService: PanelService,
    dashboardService: DashboardService,
    dataSourceService: DataSourceService,
    pipelineService: PipelineService,
    panelRepo: PanelRepository,
    dashboardRepo: DashboardRepository,
    dataSourceRepo: DataSourceRepository,
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    applicationRepo: PatchSetApplicationRepository,
    // HEL-914 task 5.6: nullable-optional, mirrors PatchSetApplyService.outputRepo's identical
    // convention.
    outputRepo: OutputRepository = null
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  private val context: PatchSetUndoContext =
    PatchSetUndoContext(panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo, outputRepo)

  def undo(applicationId: PatchSetApplicationId, user: AuthenticatedUser): Future[Either[ServiceError, PatchSetUndoResponse]] =
    applicationRepo.findById(applicationId, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Patch-set application not found")))
      case Some(record) =>
        PatchSetUndoConflictCheck.checkAll(record.edits, user, context).flatMap { blockers =>
          if (blockers.nonEmpty)
            Future.successful(Left(ServiceError.Conflict(blockers.mkString("; "))))
          else
            restoreAll(record.edits, user).map(outcomes => Right(PatchSetUndoResponse(outcomes)))
        }
    }


  private def restoreAll(edits: Vector[JournaledEdit], user: AuthenticatedUser): Future[Vector[EditUndoOutcome]] = {
    def loop(
        remaining: Vector[JournaledEdit],
        acc: Vector[EditUndoOutcome],
        failedOnwards: Boolean
    ): Future[Vector[EditUndoOutcome]] =
      remaining.headOption match {
        case None => Future.successful(acc)
        case Some(edit) =>
          if (failedOnwards)
            loop(remaining.tail, acc :+ EditUndoOutcome(edit.index, "notAttempted", None, None), failedOnwards = true)
          else
            safeRestoreOne(edit, user).flatMap {
              case Right(outcome) => loop(remaining.tail, acc :+ outcome, failedOnwards = false)
              case Left(reason) =>
                log.error(s"undo restore failed for edit ${edit.index} (kind=${edit.targetKind}, op=${edit.op}): $reason")
                loop(remaining.tail, acc :+ EditUndoOutcome(edit.index, "failed", None, None), failedOnwards = true)
            }
      }
    loop(edits.reverse, Vector.empty, failedOnwards = false).map(_.sortBy(_.index))
  }

  private def safeRestoreOne(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[String, EditUndoOutcome]] =
    restoreOne(edit, user).recover { case NonFatal(ex) => Left(s"edit ${edit.index}: ${ex.getMessage}") }

  private def restoreOne(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[String, EditUndoOutcome]] =
    (edit.targetKind, edit.op) match {
      case ("panel", "update")        => restorePanelUpdate(edit, user)
      case ("panel", "create")        => restoreCreateUndo(edit, id => panelService.delete(PanelId(id), user))
      case ("panel", "delete")        => restorePanelDelete(edit, user)
      case ("dashboard", "update")    => restoreDashboardUpdate(edit, user)
      case ("dashboard", "create")    => restoreCreateUndo(edit, id => dashboardService.delete(DashboardId(id), user))
      case ("dataSource", "update")   => restoreDataSourceUpdate(edit, user)
      // HEL-987: `DataSourceService.delete` returns `Either[DataSourceDeleteError, Unit]` now
      // (the 409-conflict wrapper) -- `.err` is `restoreCreateUndo`'s `ServiceError` shape,
      // unaffected by whether the failure carried a structured conflict.
      case ("dataSource", "create")   => restoreCreateUndo(edit, id => dataSourceService.delete(DataSourceId(id), user).map(_.left.map(_.err)))
      case ("pipeline", "update")     => restorePipelineUpdate(edit, user)
      case ("pipeline", "create")     => restoreCreateUndo(edit, id => pipelineService.delete(PipelineId(id), user))
      case ("pipelineStep", "update") => restorePipelineStepUpdate(edit, user)
      case ("pipelineStep", "delete") => restorePipelineStepDelete(edit, user)
      case ("pipelineStep", "create") => restorePipelineStepCreate(edit, user)
      case (kind, op) =>
        Future.successful(Left(s"edit ${edit.index}: no undo path for target.kind '$kind' op '$op'"))
    }

  private def missingPriorState(edit: JournaledEdit): String =
    s"edit ${edit.index} (${edit.targetKind} ${edit.op}): journal is missing its captured prior state"

  private def restoreFailed(edit: JournaledEdit, message: String): String =
    s"edit ${edit.index} (${edit.targetKind} ${edit.op}): restore failed: $message"

  /** Shared `create`-undo shape (design.md D5): the created resource is simply deleted via the
   *  SAME per-kind delete method the apply/rollback paths use — `status = "restored"`, no
   *  `resultingState` (the resource no longer exists). `newId` IS populated here with the
   *  deleted resource's own id (skeptic-final-2.md CR1) — not to signal a new resource (there
   *  isn't one), but so the frontend's cache invalidation can still identify WHICH resource was
   *  removed once its `resultingState`/`priorState` are both unavailable (a `create` edit's undo
   *  has neither — nothing survives to describe once the resource is deleted, and `EditUndoOutcome`
   *  carries no `priorState` at all by design). This is the one case (`dashboard` `create`-undo)
   *  where no other field on the wire response, and no field on the ORIGINAL edit's create patch
   *  either (a dashboard doesn't have an id before it exists), can recover that id — unlike a
   *  panel create's undo, whose parent `dashboardId` conveniently survives on the original patch. */
  private def restoreCreateUndo(
      edit: JournaledEdit,
      deleteAction: String => Future[Either[ServiceError, Unit]]
  ): Future[Either[String, EditUndoOutcome]] =
    edit.newId match {
      case None => Future.successful(Left(s"edit ${edit.index} (${edit.targetKind} ${edit.op}): journal is missing its captured newId"))
      case Some(id) =>
        deleteAction(id).map {
          case Right(_)  => Right(EditUndoOutcome(edit.index, "restored", Some(id), None))
          case Left(err) => Left(restoreFailed(edit, err.message))
        }
    }


  private def restorePanelUpdate(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[String, EditUndoOutcome]] =
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
  private def restorePanelDelete(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[String, EditUndoOutcome]] =
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


  private def restoreDashboardUpdate(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[String, EditUndoOutcome]] =
    edit.priorState match {
      case None => Future.successful(Left(missingPriorState(edit)))
      case Some(json) =>
        val prior = json.convertTo[DashboardResponse]
        dashboardService.update(DashboardId(prior.id), PatchSetUndoInverse.fullDashboardInverse(prior), user).map {
          case Right(dashboard) =>
            Right(EditUndoOutcome(edit.index, "restored", None, Some(dashboardResponseFormat.write(DashboardResponse.fromDomain(dashboard)))))
          case Left(err) => Left(restoreFailed(edit, err.message))
        }
    }


  private def restoreDataSourceUpdate(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[String, EditUndoOutcome]] =
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


  private def restorePipelineUpdate(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[String, EditUndoOutcome]] =
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

  private def restorePipelineStepUpdate(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[String, EditUndoOutcome]] =
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
   *  "placements": [<PanelResponse>, ...]}, ...]}` (`PatchSetApplyResolvers
   *  .buildPipelineStepDeletePriorState`) -- unwrapped here, tolerating a LEGACY journal entry
   *  that predates this fix (the bare step JSON, no `"boundOutputs"` key) by treating the whole
   *  value as the step JSON in that case. Recreates the step first (unchanged from before), then
   *  every bound Output (under the recreated step's NEW id) and every one of THOSE Outputs'
   *  placements (under each new Output's NEW id) -- same "recreate under a new id" v1 limit
   *  `PatchSetUndoInverse.panelCreateRequestFromResponse` already documents for a plain panel
   *  delete-undo. */
  private def restorePipelineStepDelete(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[String, EditUndoOutcome]] =
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

  private def restoreBoundOutputs(newStepId: String, boundOutputsJson: JsValue, user: AuthenticatedUser): Future[Unit] = {
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
      outputRepo.insertInternal(
        PipelineId(outputResponse.pipelineId), Some(PipelineStepId(newStepId)), user.id, outputResponse.name, kind,
        config = outputResponse.config.asJsObject, schema = schema, tag = None, explicitRootId = None
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

  /** HEL-914 task 5.6: undoing an added lane removes the step itself, its bound Outputs, AND
   *  those Outputs' placements -- atomically, via `pipelineService.deleteStep`'s own
   *  transactional delete (V94's `outputs.node_step_id`/`panels.output_id` `ON DELETE CASCADE`
   *  chain, the SAME cascade a real delete already relies on -- no second, bespoke teardown to
   *  drift from it). The placement count is read BEFORE the delete purely for the reported
   *  outcome (task 5.6's "reporting the placement count") -- it plays no role in the delete
   *  itself, which is atomic regardless of whether this count succeeds. `outputRepo == null`
   *  (a fixture that never wires one) degrades to reporting a `0` count rather than a NPE. */
  private def restorePipelineStepCreate(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[String, EditUndoOutcome]] =
    edit.newId match {
      case None => Future.successful(Left(s"edit ${edit.index} (pipelineStep create): journal is missing its captured newId"))
      case Some(idStr) =>
        val stepId        = PipelineStepId(idStr)
        val pipelineIdStr = edit.resultingState.map(_.asJsObject.fields.get("pipelineId").map(_.convertTo[String]).getOrElse("")).getOrElse("")
        countPlacementsForStep(PipelineId(pipelineIdStr), stepId).flatMap { placementCount =>
          pipelineService.deleteStep(stepId, user).map {
            case Right(_) =>
              Right(EditUndoOutcome(
                edit.index, "restored", Some(idStr),
                Some(JsObject("removedPlacementCount" -> JsNumber(placementCount)))
              ))
            case Left(err) => Left(restoreFailed(edit, err.message))
          }
        }
    }

  private def countPlacementsForStep(pipelineId: PipelineId, stepId: PipelineStepId): Future[Int] =
    if (outputRepo == null || pipelineId.value.isEmpty) Future.successful(0)
    else
      outputRepo.listByPipelineInternal(pipelineId).flatMap { outputs =>
        val boundOutputIds = outputs.filter(_.node.stepId.contains(stepId)).map(_.id.value)
        if (boundOutputIds.isEmpty) Future.successful(0)
        else panelRepo.countByOutputIdsInternal(boundOutputIds).map(_.values.sum)
      }
}
