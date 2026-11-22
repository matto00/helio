package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.services.dashboards.DashboardService
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.PipelineService
import com.helio.services.pipelines.draft.{DraftRestore, DraftSaveJournal}
import com.helio.services.sources.DataSourceService
import com.helio.api.protocols.patchsets.{EditUndoOutcome, PatchSetUndoResponse}
import com.helio.domain.model.{AuthenticatedUser, DashboardId, DataSourceId, OutputId, PanelId, PatchSetApplicationId, PipelineId, PipelineStepId}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{OutputRepository, PipelineRepository, PipelineStepRepository}
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import PatchSetApplicationRepository.JournaledEdit
import PatchSetUndoRestorers.restoreFailed
import org.slf4j.LoggerFactory

import java.time.Instant
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
    // HEL-1256: required, no default; non-null asserted by `PatchSetUndoContext` (HEL-1337).
    outputRepo: OutputRepository,
    // HEL-1629: restores a `pipelineDefinition` journal row (an atomic draft save); null in fixtures without the save.
    draftRestore: DraftRestore = null
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(getClass)

  private[services] val context: PatchSetUndoContext =
    PatchSetUndoContext.build(panelRepo, dashboardRepo, dataSourceRepo, pipelineRepo, pipelineStepRepo, outputRepo)

  private val restorers = new PatchSetUndoRestorers(panelService, dashboardService, dataSourceService, pipelineService, context)

  def undo(applicationId: PatchSetApplicationId, user: AuthenticatedUser): Future[Either[ServiceError, PatchSetUndoResponse]] =
    applicationRepo.findById(applicationId, user).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Patch-set application not found")))
      // HEL-1629: a draft save is one `pipelineDefinition` edit, restored atomically through the save's own transaction
      // against the post-save fingerprint, not edit by edit; dispatched before the per-edit conflict check, which has no
      // arm for it.
      case Some(record) if record.edits.exists(_.targetKind == DraftSaveJournal.TargetKind) =>
        if (draftRestore == null) Future.successful(Left(ServiceError.InternalError("Undo of a draft save is unavailable")))
        else draftRestore.restore(record.edits.find(_.targetKind == DraftSaveJournal.TargetKind).get, user)
      case Some(record) =>
        PatchSetUndoConflictCheck.checkAll(record.edits, user, context, record.appliedAt).flatMap { blockers =>
          if (blockers.nonEmpty)
            Future.successful(Left(ServiceError.Conflict(blockers.mkString("; "))))
          else
            restoreAll(record.edits, user, record.appliedAt).map(outcomes => Right(PatchSetUndoResponse(outcomes)))
        }
    }


  private def restoreAll(edits: Vector[JournaledEdit], user: AuthenticatedUser, appliedAt: Instant): Future[Vector[EditUndoOutcome]] = {
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
            safeRestoreOne(edit, edits, user, appliedAt).flatMap {
              case Right(outcome) => loop(remaining.tail, acc :+ outcome, failedOnwards = false)
              case Left(reason) =>
                log.error(s"undo restore failed for edit ${edit.index} (kind=${edit.targetKind}, op=${edit.op}): $reason")
                loop(remaining.tail, acc :+ EditUndoOutcome(edit.index, "failed", None, None), failedOnwards = true)
            }
      }
    loop(edits.reverse, Vector.empty, failedOnwards = false).map(_.sortBy(_.index))
  }

  private def safeRestoreOne(edit: JournaledEdit, edits: Vector[JournaledEdit], user: AuthenticatedUser, appliedAt: Instant): Future[Either[String, EditUndoOutcome]] =
    restoreOne(edit, edits, user, appliedAt).recover { case NonFatal(ex) => Left(s"edit ${edit.index}: ${ex.getMessage}") }

  private def restoreOne(edit: JournaledEdit, edits: Vector[JournaledEdit], user: AuthenticatedUser, appliedAt: Instant): Future[Either[String, EditUndoOutcome]] =
    (edit.targetKind, edit.op) match {
      case ("panel", "update")        => restorers.restorePanelUpdate(edit, user)
      case ("panel", "create")        => restoreCreateUndo(edit, id => panelService.delete(PanelId(id), user))
      case ("panel", "delete")        => restorers.restorePanelDelete(edit, user)
      case ("dashboard", "update")    => restorers.restoreDashboardUpdate(edit, user)
      case ("dashboard", "create")    => ifStillUnbound(edit, edits, user, appliedAt)(restoreCreateUndo(edit, id => dashboardService.delete(DashboardId(id), user)))
      case ("dataSource", "update")   => restorers.restoreDataSourceUpdate(edit, user)
      // HEL-987: `DataSourceService.delete` returns `Either[DataSourceDeleteError, Unit]` now
      // (the 409-conflict wrapper) -- `.err` is `restoreCreateUndo`'s `ServiceError` shape,
      // unaffected by whether the failure carried a structured conflict.
      case ("dataSource", "create")   => ifNoLaterDatasetWork(edit, appliedAt)(restoreCreateUndo(edit, id => deleteCreatedDataSource(DataSourceId(id), user)))
      case ("pipeline", "update")     => restorers.restorePipelineUpdate(edit, user)
      case ("pipeline", "create")     => ifStillUnbound(edit, edits, user, appliedAt)(restorePipelineCreateUndo(edit, user, appliedAt))
      case ("pipelineStep", "update") => restorers.restorePipelineStepUpdate(edit, user)
      case ("pipelineStep", "delete") => restorers.restorePipelineStepDelete(edit, user)
      // HEL-914 task 5.6 / HEL-1720 / HEL-1795: undoing an added lane deletes the step through `pipelineService.deleteStep`'s own
      // transactional cascade. `ifStillUnbound` has just re-checked that no panel, and no Output or step the patch set did not
      // create, would go with it, so the outcome is the plain create-undo shape: no removed-placement count to report.
      case ("pipelineStep", "create") => ifStillUnbound(edit, edits, user, appliedAt)(restoreCreateUndo(edit, id => pipelineService.deleteStep(PipelineStepId(id), user).map(_.map(_ => ()))))
      // HEL-1639 D2: delete the Output the apply created (and any panel still bound to it; undo walks the set in reverse,
      // so a panel created in the same set is already gone).
      case ("output", "create")       => restoreCreateUndo(edit, id => deleteCreatedOutput(OutputId(id), user))
      case (kind, op) =>
        Future.successful(Left(s"edit ${edit.index}: no undo path for target.kind '$kind' op '$op'"))
    }

  /** HEL-1796: a delete refused with a structured conflict means work landed on the source since the Phase-1 check, so it
   *  reports the fixed "gained use" phrase; any other failure keeps its own `ServiceError`. */
  private def deleteCreatedDataSource(id: DataSourceId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    dataSourceService.delete(id, user).map(_.left.map { e =>
      if (e.conflict.isDefined) ServiceError.Conflict(PatchSetUndoDatasetLaterWork.gainedUseDuringUndo) else e.err
    })

  private def deleteCreatedOutput(id: OutputId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    context.outputRepo.findById(id, user).flatMap {
      case None    => Future.successful(Left(ServiceError.NotFound("Output not found")))
      // HEL-1720 D4: the Output row is locked and its bound panels re-counted inside the delete's own transaction; a panel
      // bound since Phase 1 aborts it (a Left with a fixed phrase and a count, never a title or id: it is logged at ERROR).
      case Some(_) =>
        context.outputRepo.deleteIfUnboundInternal(id).map {
          case Right(_) => Right(())
          case Left((panels, rules)) => Left(ServiceError.Conflict(PatchSetUndoLaterChildren.outputBoundDuringUndo(panels, rules)))
        }
    }

  /** HEL-1720 D4 (pipelineStep / pipeline / dashboard arms): re-runs the Phase-1 bound-panels check immediately before the
   *  delete and reports the edit failed (so the walk stops) when a panel has been bound since. These deletes run inside
   *  service-owned transactions, so the window from this re-check to the cascade remains: the same accepted residual as
   *  V130's RESIDUAL paragraph (and HEL-1485's "panel created after the pre-lock"). */
  private def ifStillUnbound(edit: JournaledEdit, edits: Vector[JournaledEdit], user: AuthenticatedUser, appliedAt: Instant)(
      restore: => Future[Either[String, EditUndoOutcome]]
  ): Future[Either[String, EditUndoOutcome]] =
    PatchSetUndoBoundPanels.blockingPanelIds(edit, edits, context).flatMap {
      case ids if ids.nonEmpty => Future.successful(Left(restoreFailed(edit, PatchSetUndoBoundPanels.boundDuringUndo(ids.size))))
      // HEL-1795 D4: the same re-check for Outputs and steps the patch set did not create
      case _ if PatchSetUndoLaterChildren.guards(edit) =>
        PatchSetUndoLaterChildren.blocking(edit, edits, appliedAt, user, context).flatMap { later =>
          if (later.isEmpty) restore
          else Future.successful(Left(restoreFailed(edit, PatchSetUndoLaterChildren.addedDuringUndo(later.size))))
        }
      case _ => restore
    }

  /** HEL-1796: re-runs the Phase-1 later-work check immediately before the source delete (which cascades its rows) and
   *  reports the edit failed, with counts only, when work has landed since. The window from here to the delete remains. */
  private def ifNoLaterDatasetWork(edit: JournaledEdit, appliedAt: Instant)(
      restore: => Future[Either[String, EditUndoOutcome]]
  ): Future[Either[String, EditUndoOutcome]] =
    PatchSetUndoDatasetLaterWork.blocking(edit, appliedAt, context).flatMap { found =>
      if (found.isEmpty) restore
      else Future.successful(Left(restoreFailed(edit, PatchSetUndoDatasetLaterWork.changedDuringUndo(found))))
    }

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


  /** HEL-1493 (owner option B): deletes the pipeline exactly as `restoreCreateUndo` does, then removes each inline root
   *  source the apply journaled, when nothing references it, and reports each one. The edit is `restored` whatever those
   *  per-source results are, because the pipeline undo itself succeeded; the outcome carries `inlineSources` only when
   *  the journal recorded at least one (a legacy row records none and keeps today's behaviour: the source survives). */
  private def restorePipelineCreateUndo(edit: JournaledEdit, user: AuthenticatedUser, appliedAt: Instant): Future[Either[String, EditUndoOutcome]] =
    // HEL-1796 fold-in: re-check the inline dataset roots (references included) right before the pipeline delete
    PatchSetUndoDatasetLaterWork.inlineFindings(edit, appliedAt, user, context).flatMap {
      case found if found.nonEmpty => Future.successful(Left(restoreFailed(edit, PatchSetUndoDatasetLaterWork.inlineChangedDuringUndo(found.size))))
      case _                       => deletePipelineAndInlineSources(edit, user)
    }

  private def deletePipelineAndInlineSources(edit: JournaledEdit, user: AuthenticatedUser): Future[Either[String, EditUndoOutcome]] =
    restoreCreateUndo(edit, id => pipelineService.delete(PipelineId(id), user)).flatMap {
      case Right(restored) =>
        edit.inlineSources.filter(_.nonEmpty) match {
          case None => Future.successful(Right(restored))
          case Some(sources) =>
            PatchSetUndoInlineSources.cleanup(sources, pipelineService.inlineSourceCleanup, user, s"undo of edit ${edit.index}")
              .map(outcomes => Right(restored.copy(inlineSources = Some(outcomes))))
        }
      case left => Future.successful(left)
    }
}
