package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.{CreatePipelineStepRequest, PipelineStepConfigCodec, PipelineStepResponse}
import com.helio.domain.model.{AuthenticatedUser, Pipeline, PipelineId, PipelineStep, PipelineStepId, PipelineStepKind, UserId}
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import org.slf4j.LoggerFactory
import spray.json._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** Step creation (`addStepReporting`) and its shared persist branch. Split out of `PipelineService` (HEL-1463). */
private[pipelines] final class PipelineStepCreate(
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    support: PipelineServiceSupport,
    checks: PipelineStepWriteChecks
)(implicit ec: ExecutionContext) {

  import support.{audit, stepResponseWithRoot}

  /** HEL-1069: [[PipelineService.addStep]] plus the ids of existing steps the insert re-parented (empty for a tail
    * attach or a childless anchor). Only the create route consumes the ids; every other caller
    * (patch-set apply/rollback) goes through [[PipelineService.addStep]], which discards them. */
  def addStepReporting(pipelineId: PipelineId, req: CreatePipelineStepRequest, user: AuthenticatedUser): Future[Either[ServiceError, (PipelineStepResponse, Seq[String])]] = {
    // HEL-1722: every read-only pre-write check (type, config, access, ownership, lane, upsert target, placement, `rejectIfReparents`)
    // lives in `PipelineStepWriteChecks.checkAdd`, which the patch-set resolvers call too; this write then persists.
    checks.checkAdd(pipelineId, req, user, GraphChecks.Run).flatMap {
      case Left(err) => Future.successful(Left(err))
      // Editor/owner access confirmed: use the internal insert (no owner-JOIN). `persistNewStep` re-reads and re-resolves
      // placement itself: that resolution is the authoritative one, under the pipeline lock.
      case Right(checked) => persistNewStep(pipelineId, req, checked.typedConfig, user, checked.pipeline.ownerId)
    }
  }

  /** Shared persist branch for `addStep` (HEL-410) — called only after the
    * caller's editor-or-owner access has been confirmed by both branches
    * above. `req.position` absent keeps the pre-existing append behavior
    * (`insertInternal`, untouched); present validates it as a list index
    * (`0 <= position <= count`, count read fresh immediately before the
    * insert) and, if in range, splices via `spliceInsertAtInternal` (HEL-904
    * cycle-7 fix — see that method's doc for why a plain sibling-scoped
    * `insertAtInternal` call is not equivalent). Out-of-range values return
    * 422 with nothing persisted — the same
    * ServiceError variant `reorderSteps` uses for its own staleness check. */
  private def persistNewStep(
      pipelineId:  PipelineId,
      req:         CreatePipelineStepRequest,
      typedConfig: Any,
      user:        AuthenticatedUser,
      // HEL-1100 (design.md Decision 1): the cycle check's `actingUserId` at every insert call
      // site below is the PIPELINE OWNER, not the caller -- the write-back this step could
      // participate in always runs as the owner (D5), so the graph it must not close a cycle in
      // is the owner's graph, not the (possibly-grantee) caller's.
      pipelineOwnerId: UserId
  ): Future[Either[ServiceError, (PipelineStepResponse, Seq[String])]] = {
    // HEL-1069: opt-in guard -- see `CreatePipelineStepRequest.rejectIfReparents`.
    val reject = req.rejectIfReparents.getOrElse(false)
    // HEL-412: absent `enabled` creates an enabled step (the pre-existing
    // implicit behavior, made explicit).
    val enabled = req.enabled.getOrElse(true)
    // HEL-1515: ONE placement resolution (`StepPlacement.resolveCreateAnchor`) -- the lane check's descendants
    // read the same anchor -- over a single read of the pipeline's roots and steps. Its rejections are, in
    // order, the ones each arm used to answer with: both ids named (400), unknown root (422), out-of-range
    // root position (422), unknown parent (422), several roots with no id (400), out-of-range position (422).
    //
    // HEL-1345: a `rootId` create is placed in THAT root's trunk, never by an unconditional head-splice;
    // HEL-913 task 7.3b: a parentless create names its root only when it has no parent anchor;
    // HEL-904 cycle-9: the bare default extends the trunk (trunk-last); a `position` splices directly after
    // `current(position - 1)` (cycle-7: it is a whole-pipeline slot, not a sibling-scoped one), re-parenting
    // whatever occupied it; HEL-908: `attachAsTail` attaches a new sibling and re-parents nothing, so it is
    // never rejected by `rejectIfReparents`.
    (for {
      roots                   <- pipelineRepo.listRootDataSourceIdsInternal(pipelineId)
      (current, rootIdOfStep) <- pipelineStepRepo.listWithRootIdsInternal(pipelineId)
    } yield StepPlacement.resolveCreateAnchor(req, current, rootIdOfStep, roots.map(_._1), pipelineStepRepo.trunkOf))
      .flatMap {
        case Left(err) => Future.successful(Left(err))
        case Right(CreateAnchor(anchor, explicitRootId, attachAsTail)) =>
          val persistF: Future[(PipelineStep, Seq[String])] =
            if (attachAsTail)
              anchor.fold(Future.failed[(PipelineStep, Seq[String])](new IllegalStateException("attachAsTail without an anchor")))(a =>
                pipelineStepRepo.attachTailInternal(pipelineId, req.`type`, typedConfig, a, enabled, actingUserId = pipelineOwnerId.value, actor = user).map(_ -> Seq.empty[String])
              )
            else
              pipelineStepRepo.spliceInsertReportingInternal(pipelineId, req.`type`, typedConfig, anchor, enabled, explicitRootId = explicitRootId, actingUserId = pipelineOwnerId.value, actor = user, rejectIfReparents = reject)
          persistF
            .flatMap { case (step, moved) =>
              audit("pipeline.step.create", "pipeline_step", Some(step.id.value), user)
              stepResponseWithRoot(pipelineId, step).map(resp => Right((resp, moved)))
            }
            .recover(PipelineWriteRefusal.refused[(PipelineStepResponse, Seq[String])](ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")).orElse { case ex => Left(PipelineService.classifyDbError(ex)) })
      }
  }
}
