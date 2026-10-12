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
    refChecks: StepReferenceChecks,
    requireEditorAccess: (PipelineId, AuthenticatedUser) => Future[Either[ServiceError, Unit]]
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(classOf[PipelineService])

  import support.{audit, stepResponseWithRoot}

  /** HEL-1069: [[PipelineService.addStep]] plus the ids of existing steps the insert re-parented (empty for a tail
    * attach or a childless anchor). Only the create route consumes the ids; every other caller
    * (patch-set apply/rollback) goes through [[PipelineService.addStep]], which discards them. */
  def addStepReporting(pipelineId: PipelineId, req: CreatePipelineStepRequest, user: AuthenticatedUser): Future[Either[ServiceError, (PipelineStepResponse, Seq[String])]] = {
    // HEL-860: strict write-path check runs before the tolerant decode below,
    // so a mistyped `cast`/`rename` config is rejected instead of silently
    // persisted as a no-op. `None` (unregistered kind, or a kind that hasn't
    // opted in) falls through to the decode as before.
    val rawConfigError: Option[String] =
      PipelineStep.rawConfigProblem(req.`type`, req.config.compactPrint)
    if (!PipelineStepKind.All.contains(req.`type`))
      Future.successful(Left(ServiceError.BadRequest(
        s"Invalid step type '${req.`type`}'. Allowed values: ${PipelineStepKind.All.toSeq.sorted.mkString(", ")}"
      )))
    else if (rawConfigError.isDefined)
      Future.successful(Left(ServiceError.UnprocessableEntity(rawConfigError.get)))
    else
      PipelineStepConfigCodec.decode(req.`type`, req.config.compactPrint) match {
        case Failure(ex) =>
          // HEL-311: keep the curated "Invalid '<type>' config" prefix, drop
          // the raw decode-exception tail; log the detail server-side.
          log.warn(s"addStep: config decode failed for step type '${req.`type`}'", ex)
          Future.successful(Left(ServiceError.BadRequest(
            s"Invalid '${req.`type`}' config"
          )))
        case Success(typedConfig) =>
          // HEL-1515: ownership -> lane -> pipeline access -> upsert target all run in ONE shared chain
          // (`StepReferenceChecks.referenceChecksF`), the same one update and duplicate use. This call site
          // supplies only its own inputs: the lane scope, and the pipeline lookup + editor check the upsert
          // identity depends on.
          //
          // HEL-911 (design.md Engine contract items 6a/7, write-time arm): a `lane`-kind
          // secondaryInput must name an existing step of THIS pipeline that is not this
          // new step's own prospective ancestor. Computed against the current step list --
          // `req.parentStepId` takes precedence (mirrors `persistNewStep`'s own anchor
          // resolution) else falls back to trunk-last, the same default `persistNewStep`
          // uses for a bare append. `selfId = None`: the new step has no id yet.
          def laneScopeF: Future[LaneScope] =
            for {
              roots                   <- pipelineRepo.listRootDataSourceIdsInternal(pipelineId)
              (current, rootIdOfStep) <- pipelineStepRepo.listWithRootIdsInternal(pipelineId)
            } yield {
              val rootIds = roots.map(_._1)
              // HEL-1345 (design D3): a `rootId` create (no `parentStepId`) resolves its prospective
              // parent through the SAME anchor resolver `persistNewStep` places with, scoped to
              // THAT root. An unknown root, or an out-of-range `position`, uses no ancestors
              // (`persistNewStep` still returns the 422); `validateLaneReference` runs regardless.
              // Otherwise (HEL-911 evaluation-1.md CR2): `req.parentStepId`, else the trunk-last step
              // `persistNewStep`'s bare-append placement uses. (A bare `position` splice anchors on
              // `current(position - 1)` instead -- a pre-existing mismatch, left as it was.)
              val prospectiveParent: Option[PipelineStepId] = (req.parentStepId, req.rootId) match {
                case (None, Some(rootIdRaw)) =>
                  rootIds.find(_.value == rootIdRaw).flatMap { rootId =>
                    PipelineService.resolveRootTrunkAnchor(current, rootIdOfStep, rootId, req.position).toOption.flatten
                  }
                case _ =>
                  req.parentStepId.map(PipelineStepId(_)).orElse(pipelineStepRepo.trunkOf(current).lastOption.map(_.id))
              }
              // HEL-1515 (owner ruling, reject-at-write): the steps this insert re-parents under the new step (and
              // their parent-chain descendants) cannot be lane targets either. The anchor is the SAME resolution `persistNewStep` inserts with; a
              // placement it rejects re-parents nothing, so today's rejection stays the answer.
              val descendants = StepPlacement
                .resolveCreateAnchor(req, current, rootIdOfStep, rootIds, pipelineStepRepo.trunkOf)
                .fold(_ => Set.empty[String], anchor => PipelineService.descendantStepIds(StepPlacement.reparentedIds(anchor, current, rootIdOfStep), current))
              LaneScope(current, PipelineService.ancestorChainOf(prospectiveParent, current), descendants, selfId = None)
            }
          def pipelineAccessF: Future[Either[ServiceError, Pipeline]] =
            pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
              case None =>
                Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
              case Some(pipeline) if pipeline.ownerId.value != user.id.value =>
                // Grantee path -- findByIdShared returned Some, so caller has viewer or editor access.
                // Distinguish editor from viewer via requireEditorAccess before allowing mutation.
                requireEditorAccess(pipelineId, user).map(_.map(_ => pipeline))
              case Some(pipeline) => Future.successful(Right(pipeline))
            }
          refChecks.referenceChecksF[Pipeline](typedConfig, user, laneScopeF, pipelineAccessF, _.ownerId).flatMap {
            case Left(err)       => Future.successful(Left(err))
            // Editor/owner access confirmed: use the internal insert (no owner-JOIN).
            case Right(pipeline) => persistNewStep(pipelineId, req, typedConfig, user, pipeline.ownerId)
          }
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
                pipelineStepRepo.attachTailInternal(pipelineId, req.`type`, typedConfig, a, enabled, actingUserId = pipelineOwnerId.value).map(_ -> Seq.empty[String])
              )
            else
              pipelineStepRepo.spliceInsertReportingInternal(pipelineId, req.`type`, typedConfig, anchor, enabled, explicitRootId = explicitRootId, actingUserId = pipelineOwnerId.value, rejectIfReparents = reject)
          persistF
            .flatMap { case (step, moved) =>
              audit("pipeline.step.create", "pipeline_step", Some(step.id.value), user)
              stepResponseWithRoot(pipelineId, step).map(resp => Right((resp, moved)))
            }
            .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
      }
  }
}
