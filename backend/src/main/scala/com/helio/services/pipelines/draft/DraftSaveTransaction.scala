package com.helio.services.pipelines.draft

import com.helio.api.protocols.pipelines.{DraftSaveRequest, OutputResponse, PipelineRootSummaryResponse, PipelineStepConfigCodec, PipelineStepResponse}
import com.helio.domain.model.AuditEvent.NewAuditEvent
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, PatchSetApplicationId, PipelineId, UserId}
import com.helio.domain.steps.{UpsertSourceConfig, UpsertTarget}
import com.helio.domain.pipelines.LaneCycleViolations
import com.helio.infrastructure.persistence.audit.AuditEventRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository
import com.helio.infrastructure.persistence.patchsets.PatchSetApplicationRepository.{JournaledEdit, PatchSetApplicationRecord}
import com.helio.infrastructure.persistence.pipelines.{DefinitionRows, OutputRepository, PipelineCycleGuard, PipelineDraftWrites, PipelineRootRepository, PipelineStepRepository, PipelineWriteAccess}
import com.helio.services.ServiceError
import com.helio.services.ServiceError.{CascadeImpact, StaleTarget}
import com.helio.services.patchsets.{PatchSetApplyContext, PatchSetPipelineDefinition, PatchSetStaleMessage, PatchSetTargetFingerprint}
import com.helio.services.pipelines.PipelineWriteRefusal
import slick.jdbc.PostgresProfile.api._
import spray.json._

import java.time.Instant
import java.util.UUID
import scala.concurrent.ExecutionContext
import scala.util.{Failure, Success}

/** How a save was asked for. `Restore` is the server replaying a journaled definition (undo): explicit ids are accepted and
 *  the cascade confirmation is derived under the locks instead of read from the request. */
sealed trait DraftSaveMode { def restoring: Boolean }
object DraftSaveMode {
  case object Public  extends DraftSaveMode { val restoring = false }
  case object Restore extends DraftSaveMode { val restoring = true }
}

/** A failure inside the save's transaction that must roll it back and answer with `error`. */
final case class DraftSaveAbort(error: ServiceError) extends RuntimeException(error.message)

/** What a committed save returns. */
final case class DraftSaved(
    fingerprint: String,
    steps: Vector[PipelineStepResponse],
    outputs: Vector[OutputResponse],
    applicationId: String,
    roots: Vector[PipelineRootSummaryResponse] = Vector.empty
)

/** The single privileged transaction of `POST /api/pipelines/:id/draft/save` (HEL-1629, design D2-D5): locks in the verified
 *  order, fingerprint compare, re-plan on the locked state, cascade confirmation, the apply chain, the journal row and the
 *  audit row. Everything is one `DBIO`, run by the caller in one transaction; a `DraftSaveAbort` anywhere rolls it all back. */
private[draft] final class DraftSaveTransaction(
    writes: PipelineDraftWrites,
    stepRepo: PipelineStepRepository,
    rootRepo: PipelineRootRepository,
    outputRepo: OutputRepository,
    panelRepo: PanelRepository,
    applicationRepo: PatchSetApplicationRepository,
    auditRepo: AuditEventRepository,
    definitionCtx: PatchSetApplyContext,
    reads: DraftDefinitionReads,
    hooks: DraftSaveHooks
)(implicit ec: ExecutionContext) {

  import DraftHookPoint._

  private def abort[A](error: ServiceError): DBIO[A] = DBIO.failed(DraftSaveAbort(error))
  private def abortIf(cond: Boolean, error: => ServiceError): DBIO[Unit] = if (cond) abort(error) else DBIO.successful(())

  private def definition(pipelineId: String): DBIO[JsObject] =
    PatchSetPipelineDefinition.ofAction(PipelineId(pipelineId), definitionCtx)

  private[draft] def staleError(pipelineId: String, fingerprint: String): ServiceError.PatchSetStale =
    PatchSetStaleMessage.error(Vector(StaleTarget(0, "pipeline", pipelineId))).copy(currentFingerprint = Some(fingerprint))

  def run(
      pipelineId: String,
      pipelineName: String,
      ownerId: UserId,
      actor: AuthenticatedUser,
      req: DraftSaveRequest,
      preLockPlan: DraftPlan,
      mode: DraftSaveMode
  ): DBIO[DraftSaved] =
    for {
      _        <- hooks.at(Begin)
      // Lock (0): the sources this save adds as roots, before any other lock. A source gone by now is an answer, never an FK error.
      _        <- if (writes.sourcesFirst) lockSources(preLockPlan, mode) else DBIO.successful(())
      locked   <- writes.lockDefinition(pipelineId, preLockPlan.needsAdvisory, site => hooks.at(AfterLock(site)))
      _        <- if (writes.sourcesFirst) DBIO.successful(()) else lockSources(preLockPlan, mode)
      _        <- abortIf(!locked, ServiceError.NotFound(s"Pipeline not found: $pipelineId"))
      // HEL-1707 D2: the actor must still be the owner or an editor, re-read right after lock (3); the undo restore comes here too.
      access   <- PipelineWriteAccess.currentAction(pipelineId, actor.id.value)
      _        <- abortIf(!access.mayWrite, PipelineWriteRefusal.toError(access, ServiceError.NotFound(s"Pipeline not found: $pipelineId")))
      prior    <- definition(pipelineId)
      priorFp   = PatchSetTargetFingerprint.of("pipeline", prior)
      _        <- abortIf(priorFp != req.baseFingerprint, staleError(pipelineId, priorFp))
      rows     <- writes.readRows(pipelineId).flatMap(_.fold[DBIO[DefinitionRows]](abort(ServiceError.NotFound(s"Pipeline not found: $pipelineId")))(DBIO.successful))
      plan     <- DraftDiff.plan(rows, req, mode.restoring, () => UUID.randomUUID().toString).fold(e => abort[DraftPlan](e), DBIO.successful)
      // The advisory lock must come before the pipeline row and never after it, so a plan that now needs it when the
      // pre-lock plan did not means the state moved under us: refuse (the base is stale) instead of locking out of order.
      _        <- abortIf(plan.needsAdvisory && !preLockPlan.needsAdvisory, staleError(pipelineId, priorFp))
      _        <- abortIf(!plan.checkedKeys.toSet.subsetOf(preLockPlan.checkedKeys.toSet), staleError(pipelineId, priorFp))
      // Lock (0) was taken for the pre-lock plan's added sources only: a re-plan that adds one more cannot lock it in order.
      _        <- abortIf(!plan.addedSourceIds.toSet.subsetOf(preLockPlan.addedSourceIds.toSet), staleError(pipelineId, priorFp))
      _        <- cycleCheck(pipelineId, pipelineName, actor, plan, mode)
      impact   <- impactOf(plan)
      _        <- cascadeGate(impact, plan, req, mode)
      _        <- hooks.at(AfterCompare)
      saved    <- apply(pipelineId, pipelineName, ownerId, actor, rows, plan, prior)
      _        <- hooks.at(BeforeCommit)
    } yield saved

  /** A root this save adds may not close a pipeline read/write cycle. The advisory lock is already held (the plan asked for
   *  it), so only the read-and-validate half runs. A cycle is a 400, or for an undo a 409 like the other undo refusals. */
  private def cycleCheck(pipelineId: String, pipelineName: String, actor: AuthenticatedUser, plan: DraftPlan, mode: DraftSaveMode): DBIO[Unit] =
    if (plan.rootPlan.creates.isEmpty) DBIO.successful(())
    else {
      val targets = plan.finalSteps.flatMap { w =>
        PipelineStepConfigCodec.decode(w.op, w.config).toOption.collect {
          case UpsertSourceConfig(UpsertTarget.ExistingSource(id), _) if id.trim.nonEmpty => DataSourceId(id)
        }
      }
      PipelineCycleGuard.checkAddedReadsHoldingLockAction(
        rootRepo, stepRepo, actor.id.value, PipelineId(pipelineId), pipelineName, plan.addedSourceIds.map(DataSourceId(_)), targets
      ).asTry.flatMap {
        case Failure(PipelineCycleGuard.PipelineCycleRejected(msg)) =>
          abort(if (mode.restoring) ServiceError.Conflict(s"Undo refused: $msg") else ServiceError.BadRequest(msg))
        case Failure(other) => DBIO.failed(other)
        case Success(_)     => DBIO.successful(())
      }
    }

  private def lockSources(preLockPlan: DraftPlan, mode: DraftSaveMode): DBIO[Unit] =
    writes.lockAddedSources(preLockPlan.addedSourceIds, site => hooks.at(AfterLock(site))).flatMap { found =>
      preLockPlan.addedSourceIds.find(id => !found.contains(id)).fold[DBIO[Unit]](DBIO.successful(()))(id =>
        abort(if (mode.restoring) ServiceError.Conflict(s"Undo refused: source $id no longer exists; nothing was changed.")
              else ServiceError.NotFound(s"Data source not found: $id")))
    }

  private def impactOf(plan: DraftPlan): DBIO[CascadeImpact] =
    for {
      panels <- panelRepo.findIdsByOutputIdsAction(plan.removedOutputIds)
      rules  <- outputRepo.findAlertRuleDefinitionsAction(plan.removedOutputIds)
    } yield {
      val panelIds = panels.values.flatten.toVector.distinct.sorted
      val ruleIds  = rules.values.flatten.map(_._1).toVector.distinct.sorted
      val steps    = plan.removedStepIds.toVector.sorted
      val rootIds  = plan.rootPlan.removedRootIds.sorted
      CascadeImpact(
        steps, plan.removedOutputIds, panelIds, ruleIds,
        Vector(
          if (rootIds.nonEmpty) Some(s"Removes ${rootIds.size} source(s).") else None,
          if (steps.nonEmpty) Some(s"Removes ${steps.size} step(s).") else None,
          if (plan.removedOutputIds.nonEmpty) Some(s"Removes ${plan.removedOutputIds.size} Output(s).") else None,
          if (panelIds.nonEmpty) Some(s"Removes ${panelIds.size} bound panel(s).") else None,
          if (ruleIds.nonEmpty) Some(s"Removes ${ruleIds.size} alert rule(s).") else None
        ).flatten,
        rootIds
      )
    }

  /** Public: every removed step, Output, panel and alert rule must be listed in `confirmCascade`, computed here under the
   *  locks so a panel bound after the client's preview forces a fresh 422 instead of a silent delete. Restore: the
   *  confirmation is derived, but a panel or alert rule in the impact is refused (undo recreates definitions only). */
  private def cascadeGate(impact: CascadeImpact, plan: DraftPlan, req: DraftSaveRequest, mode: DraftSaveMode): DBIO[Unit] =
    if (!plan.removesAnything) DBIO.successful(())
    else if (mode.restoring)
      abortIf(
        impact.panelIds.nonEmpty || impact.alertRuleIds.nonEmpty,
        ServiceError.Conflict {
          // count-only (HEL-1792): this runs under the definition locks on the privileged pool, where naming reads as the
          // undoing user are unavailable, so no id, title or name is ever put in the message
          val parts = Vector(
            Some(s"${impact.panelIds.size} panel(s)").filter(_ => impact.panelIds.nonEmpty),
            Some(s"${impact.alertRuleIds.size} alert rule(s)").filter(_ => impact.alertRuleIds.nonEmpty)
          ).flatten
          s"Undo refused: ${parts.mkString(" and ")} are bound to Outputs this undo would delete; nothing was changed."
        }
      )
    else {
      val c = req.confirmCascade
      val covered =
        impact.stepIds.forall(id => c.exists(_.stepIds.contains(id))) &&
          impact.outputIds.forall(id => c.exists(_.outputIds.contains(id))) &&
          impact.panelIds.forall(id => c.exists(_.panelIds.contains(id))) &&
          impact.alertRuleIds.forall(id => c.exists(_.alertRuleIds.contains(id))) &&
          impact.rootIds.forall(id => c.exists(_.rootIds.contains(id)))
      abortIf(!covered, ServiceError.CascadeConfirmationRequired(impact, "The draft removes more than was confirmed; nothing was saved."))
    }

  private def apply(
      pipelineId: String,
      pipelineName: String,
      ownerId: UserId,
      actor: AuthenticatedUser,
      before: DefinitionRows,
      plan: DraftPlan,
      prior: JsObject
  ): DBIO[DraftSaved] = {
    val actingOwner = ownerId.value
    for {
      // HEL-1734 (D5): new roots go in past every stored position first; removed roots go after their steps and Outputs; then
      // every root is moved to its final index.
      _          <- writes.insertRoots(pipelineId, plan.rootPlan.creates)
      _          <- writes.insertSteps(pipelineId, pipelineName, actingOwner, plan.creates)
      _          <- hooks.at(AfterInserts)
      _          <- writes.relinkSteps(plan.relinks)
      _          <- hooks.at(AfterRelinks)
      _          <- writes.deleteRemoved(plan.removedOutputIds, plan.removedStepIds)
      _          <- writes.deleteRoots(pipelineId, plan.rootPlan.removedRootIds, before.steps, plan.removedStepIds)
      _          <- if (plan.rootPlan.rootsGiven) writes.placeRoots(pipelineId, plan.rootPlan.finalRootIds) else DBIO.successful(())
      _          <- hooks.at(AfterDeletes)
      _          <- writes.updateStepContent(pipelineId, pipelineName, actingOwner, plan.contentUpdates, plan.oldConfigs)
      _          <- hooks.at(AfterUpdates)
      survivorPos = before.outputs.filterNot(o => plan.removedOutputIds.contains(o.id)).map(_.position).maxOption.map(_ + 1).getOrElse(0)
      _          <- writes.insertOutputs(pipelineId, UUID.fromString(actingOwner), survivorPos, plan.outputCreates)
      _          <- writes.updateOutputs(plan.outputUpdates)
      _          <- hooks.at(AfterOutputs)
      after      <- writes.readRows(pipelineId).flatMap(_.fold[DBIO[DefinitionRows]](abort(ServiceError.NotFound(s"Pipeline not found: $pipelineId")))(DBIO.successful))
      _          <- laneGate(before, after, plan)
      state      <- definition(pipelineId)
      newFp       = PatchSetTargetFingerprint.of("pipeline", state)
      appId       = UUID.randomUUID().toString
      now         = Instant.now()
      record      = PatchSetApplicationRecord(
                      PatchSetApplicationId(appId), actor.id, now,
                      Vector(JournaledEdit(0, DraftSaveJournal.TargetKind, DraftSaveJournal.Op,
                        Some(DraftSaveJournal.priorState(pipelineId, prior, before)),
                        Some(DraftSaveJournal.resultingState(pipelineId, newFp)), None, None)),
                      now)
      _          <- applicationRepo.createAction(record)
      _          <- Option(auditRepo).fold[DBIO[Any]](DBIO.successful(()))(_.appendAction(auditEvent(pipelineId, actor, appId, plan)))
      response   <- reads.definition(PipelineId(pipelineId))
    } yield DraftSaved(newFp, response._1, response._2, appId, response._3)
  }

  /** A write may not leave a stored `lane` reference naming its own step's ancestor, descendant or dependent where it did
   *  not before (HEL-1523); judged on the rows just written, and a violation rolls the whole save back. */
  private def laneGate(before: DefinitionRows, after: DefinitionRows, plan: DraftPlan): DBIO[Unit] =
    LaneCycleViolations.introduced(stepRepo.domainOf(before.steps), stepRepo.domainOf(after.steps)).headOption match {
      // Both ids are named by the key the client sent (HEL-1542): a step this save created is judged under its server-minted id.
      case Some(v) => abort(ServiceError.BadRequest(s"Step '${plan.draftKeyOf(v.stepId)}' has a lane reference to '${plan.draftKeyOf(v.targetId)}', which would be ${v.relation.describe}."))
      case None    => DBIO.successful(())
    }

  private def auditEvent(pipelineId: String, actor: AuthenticatedUser, applicationId: String, plan: DraftPlan): NewAuditEvent =
    NewAuditEvent(
      Some(actor.id), actor.tokenId, actor.source, "pipeline.draft.save", "pipeline", Some(pipelineId),
      JsObject(
        "applicationId" -> JsString(applicationId),
        "stepsCreated" -> JsNumber(plan.creates.size), "stepsRemoved" -> JsNumber(plan.removedStepIds.size),
        "outputsCreated" -> JsNumber(plan.outputCreates.size), "outputsRemoved" -> JsNumber(plan.removedOutputIds.size),
        "rootsCreated" -> JsNumber(plan.rootPlan.creates.size), "rootsRemoved" -> JsNumber(plan.rootPlan.removedRootIds.size)
      )
    )
}
