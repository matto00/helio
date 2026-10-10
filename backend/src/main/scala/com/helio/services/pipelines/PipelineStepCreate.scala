package com.helio.services.pipelines

import com.helio.services.ServiceError
import com.helio.api.protocols.pipelines.{CreatePipelineStepRequest, PipelineStepConfigCodec, PipelineStepResponse}
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, PipelineId, PipelineStep, PipelineStepId, PipelineStepKind, UserId}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository}
import org.slf4j.LoggerFactory
import spray.json._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** Step creation (`addStepReporting`) and its shared persist branch. Split out of `PipelineService` (HEL-1463). */
private[pipelines] final class PipelineStepCreate(
    pipelineRepo: PipelineRepository,
    pipelineStepRepo: PipelineStepRepository,
    dataSourceRepo: DataSourceRepository,
    support: PipelineServiceSupport,
    requireEditorAccess: (PipelineId, AuthenticatedUser) => Future[Either[ServiceError, Unit]]
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(classOf[PipelineService])

  import support.{audit, stepResponseWithRoot, upsertOwnershipCheckF}

  /** HEL-1069: [[addStep]] plus the ids of existing steps the insert re-parented (empty for a tail
    * attach or a childless anchor). Only the create route consumes the ids; every other caller
    * (patch-set apply/rollback) goes through [[addStep]], which discards them. */
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
          // Pre-flight ACL: the second, separately-owned DataSource a join/union/lookup
          // config references must be caller-owned (HEL-278/HEL-384/HEL-386). An EMPTY
          // second-source id (the picker's own defaultConfigFor seed value) is an
          // incomplete draft, not a security violation — nothing to leak against an
          // unset id, so `secondaryDataSourceId` returns `None` for it and the check is
          // skipped, same as for a config kind with no second source at all (HEL-620,
          // HEL-950: one shared extractor for all three ops, replacing three
          // hand-copied per-op blocks that had drifted out of sync).
          val aclCheckF: Future[Either[ServiceError, Unit]] =
            PipelineStepConfigCodec.secondaryDataSourceId(typedConfig) match {
              case Some(id) =>
                dataSourceRepo.findByIdOwned(DataSourceId(id), user).map {
                  case None    => Left(ServiceError.NotFound(s"Data source not found: $id"))
                  case Some(_) => Right(())
                }
              case None => Future.successful(Right(()))
            }
          // HEL-911 (design.md Engine contract items 6a/7, write-time arm): a `lane`-kind
          // secondaryInput must name an existing step of THIS pipeline that is not this
          // new step's own prospective ancestor. Computed against the current step list --
          // `req.parentStepId` takes precedence (mirrors `persistNewStep`'s own anchor
          // resolution) else falls back to trunk-last, the same default `persistNewStep`
          // uses for a bare append. `selfId = None`: the new step has no id yet.
          val laneCheckF: Future[Either[ServiceError, Unit]] =
            PipelineStepConfigCodec.secondaryLaneStepId(typedConfig) match {
              case None => Future.successful(Right(()))
              case Some(_) =>
                // HEL-1345 (design D3): a `rootId` create (no `parentStepId`) resolves its prospective
                // parent through the SAME anchor resolver `persistNewStep` places with, scoped to
                // THAT root. An unknown root, or an out-of-range `position`, uses no ancestors
                // (`persistNewStep` still returns the 422); `validateLaneReference` runs regardless.
                val rootScopedParent: Future[Option[(Vector[PipelineStep], Option[PipelineStepId])]] =
                  (req.parentStepId, req.rootId) match {
                    case (None, Some(rootIdRaw)) =>
                      for {
                        roots                   <- pipelineRepo.listRootDataSourceIdsInternal(pipelineId)
                        (current, rootIdOfStep) <- pipelineStepRepo.listWithRootIdsInternal(pipelineId)
                      } yield roots.find(_._1.value == rootIdRaw) match {
                        case Some((rootId, _)) =>
                          val anchor = PipelineService.resolveRootTrunkAnchor(current, rootIdOfStep, rootId, req.position).toOption.flatten
                          Some((current, anchor))
                        case None => Some((current, None))
                      }
                    case _ => Future.successful(None)
                  }
                rootScopedParent.flatMap {
                  case Some((current, anchorOpt)) =>
                    Future.successful(PipelineService.validateLaneReference(typedConfig, current, PipelineService.ancestorChainOf(anchorOpt, current), selfId = None))
                  case None => pipelineStepRepo.listByPipelineInternal(pipelineId).map { current =>
                    // HEL-911 evaluation-1.md CR2 (cycle 2): `trunkOf(current).lastOption` is
                    // the SAME deterministic "first position-0 child at each level" anchor
                    // `trunkOf`'s own scaladoc documents -- used here ONLY as the fallback when
                    // `req.parentStepId` is absent, exactly mirroring `persistNewStep`'s real
                    // placement logic below (`spliceInsertAtInternal`'s own no-explicit-parent
                    // branch), so the ancestor chain this cycle-check is computed against is
                    // always the SAME node the step will actually be anchored to -- never a
                    // silently different one.
                    val prospectiveParent: Option[PipelineStepId] =
                      req.parentStepId.map(PipelineStepId(_))
                        .orElse(pipelineStepRepo.trunkOf(current).lastOption.map(_.id))
                    val ancestors = PipelineService.ancestorChainOf(prospectiveParent, current)
                    PipelineService.validateLaneReference(typedConfig, current, ancestors, selfId = None)
                  }
                }
            }
          aclCheckF.flatMap {
            case Left(err) => Future.successful(Left(err))
            case Right(_)  =>
              laneCheckF.flatMap {
                case Left(err) => Future.successful(Left(err))
                case Right(_)  =>
                  pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
                    case None =>
                      Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
                    case Some(pipeline) if pipeline.ownerId.value != user.id.value =>
                      // Grantee path — findByIdShared returned Some, so caller has viewer or editor access.
                      // Distinguish editor from viewer via requireEditorAccess before allowing mutation.
                      requireEditorAccess(pipelineId, user).flatMap {
                        case Left(err) => Future.successful(Left(err))
                        case Right(_) =>
                          upsertOwnershipCheckF(typedConfig, pipeline.ownerId, user).flatMap {
                            case Left(err) => Future.successful(Left(err))
                            case Right(_) =>
                              // Safe: editor access confirmed. Use internal insert (no owner-JOIN).
                              persistNewStep(pipelineId, req, typedConfig, user, pipeline.ownerId)
                          }
                      }
                    case Some(pipeline) =>
                      // Owner path — use internal insert (same as before, owner already confirmed)
                      upsertOwnershipCheckF(typedConfig, pipeline.ownerId, user).flatMap {
                        case Left(err) => Future.successful(Left(err))
                        case Right(_)  => persistNewStep(pipelineId, req, typedConfig, user, pipeline.ownerId)
                      }
                  }
              }
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
    (req.parentStepId, req.rootId) match {
      case (Some(_), Some(_)) =>
        // HEL-913 task 7.3b: a step with a parent already has an implicit root -- naming
        // rootId too is contradictory, mirroring the identical rule the single-call
        // transactional create path enforces (resolveStepRootIndex's "both" case).
        Future.successful(Left(ServiceError.BadRequest(
          "Cannot name both parentStepId and rootId -- a step with a parent inherits its root implicitly"
        )))
      case (None, Some(rootIdRaw)) =>
        // HEL-913 task 7.3b: rootId is the alternative anchor to parentStepId -- validated
        // against this pipeline's OWN roots (mirroring parentStepId's "must belong to this
        // pipeline" check) before splicing.
        //
        // HEL-1345: the new step is placed in THAT root's trunk, never by an unconditional
        // head-splice. `position` is an index into the root's trunk (`resolveRootTrunkAnchor`):
        // absent appends after the trunk-last step, `0` becomes the new head (reparenting that
        // root's parentless steps), `0 < k <= trunk length` splices directly after `trunk(k - 1)`
        // (reparenting that anchor's children, tails included). Out of range is a 422 and
        // nothing is persisted. A `Some(anchor)` goes through the same splice call the
        // `parentStepId` arm uses (root derived from the parent, V98's XOR holds); `None` keeps
        // the root-level insert (empty root, or an explicit head insert).
        pipelineRepo.listRootDataSourceIdsInternal(pipelineId).flatMap { roots =>
          roots.find(_._1.value == rootIdRaw) match {
            case None =>
              Future.successful(Left(ServiceError.UnprocessableEntity(s"rootId '$rootIdRaw' is not a root of this pipeline")))
            case Some((rootId, _)) =>
              pipelineStepRepo.listWithRootIdsInternal(pipelineId).flatMap { case (current, rootIdOfStep) =>
                PipelineService.resolveRootTrunkAnchor(current, rootIdOfStep, rootId, req.position) match {
                  case Left(err) => Future.successful(Left(err))
                  case Right(anchorOpt) =>
                    // `explicitRootId` only matters (and is only legal) with no parent anchor.
                    val explicitRoot = if (anchorOpt.isEmpty) Some(rootId) else None
                    pipelineStepRepo.spliceInsertReportingInternal(pipelineId, req.`type`, typedConfig, anchorOpt, enabled, explicitRootId = explicitRoot, actingUserId = pipelineOwnerId.value, rejectIfReparents = reject)
                      .flatMap { case (step, moved) =>
                        audit("pipeline.step.create", "pipeline_step", Some(step.id.value), user)
                        stepResponseWithRoot(pipelineId, step).map(resp => Right((resp, moved)))
                      }
                      .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
                }
              }
          }
        }
      case (Some(parentStepIdRaw), None) =>
        // HEL-906 cycle 7 (task 3.2): an explicit parentStepId takes precedence over
        // `position` (documented on the request type) -- validate it belongs to THIS
        // pipeline before splicing, so a caller cannot anchor a new step onto an unrelated
        // pipeline's step id.
        pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { current =>
          if (!current.exists(_.id.value == parentStepIdRaw))
            Future.successful(Left(ServiceError.UnprocessableEntity(
              s"parentStepId '$parentStepIdRaw' is not a step of this pipeline"
            )))
          else {
            // HEL-908: `attachAsTail = true` uses the branch-attach primitive (new sibling,
            // no reparenting) instead of the default splice (insert-directly-after, reparenting
            // the anchor's existing children) -- see CreatePipelineStepRequest's doc comment.
            val persistF: Future[(PipelineStep, Seq[String])] =
              if (req.attachAsTail.getOrElse(false))
                // A tail attach never re-parents, so it is never rejected by `rejectIfReparents`.
                pipelineStepRepo.attachTailInternal(pipelineId, req.`type`, typedConfig, PipelineStepId(parentStepIdRaw), enabled, actingUserId = pipelineOwnerId.value).map(_ -> Seq.empty[String])
              else
                // A parentStepId anchor makes `explicitRootId` irrelevant to the repo (root is
                // derived from the parent) -- see `spliceInsertAtInternal`'s own
                // `(Some(_), _) => None` branch. `None` here is exactly correct, not a
                // reintroduced silent default (task 7.3e).
                pipelineStepRepo.spliceInsertReportingInternal(pipelineId, req.`type`, typedConfig, Some(PipelineStepId(parentStepIdRaw)), enabled, explicitRootId = None, actingUserId = pipelineOwnerId.value, rejectIfReparents = reject)
            persistF
              .flatMap { case (step, moved) =>
                audit("pipeline.step.create", "pipeline_step", Some(step.id.value), user)
                stepResponseWithRoot(pipelineId, step).map(resp => Right((resp, moved)))
              }
              .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
          }
        }
      case (None, None) =>
        // HEL-913 task 7.3b: a parentless step naming NEITHER parentStepId nor rootId is
        // unambiguous (and byte-identical to pre-multi-root behavior) only when this pipeline
        // has exactly one root -- with more than one, "extend the trunk" doesn't say which
        // root's trunk, and that ambiguity is a named 400 rather than a silent default to the
        // pipeline's first/lowest-positioned root (the same rule `resolveStepRootIndex`'s
        // "neither" case enforces on the single-call transactional create path).
        pipelineRepo.listRootDataSourceIdsInternal(pipelineId).flatMap { roots =>
          if (roots.size > 1)
            Future.successful(Left(ServiceError.BadRequest(
              s"This pipeline has ${roots.size} roots -- name one via rootId, or anchor via parentStepId"
            )))
          else req.position match {
      case None =>
        // HEL-904 cycle-9 fix (round-6 skeptic Finding 1): the no-`position`
        // default must extend the TRUNK, not create a root sibling.
        // `insertInternal`'s bare `parentStepId = None` default (still used
        // by test seeding and the standalone `insert` method) makes every
        // step after the first a root-level tail — `trunkOf` then returns
        // only the first step, so `PipelineRunService`'s node key
        // (`trunkOf(steps).lastOption`) and `PipelineProposalService`'s
        // Output binding (`createdSteps.lastOption`) diverge on the primary,
        // default step-creation path. Resolve the current trunk's last step
        // as the anchor and splice via `spliceInsertAtInternal` — the same
        // trunk-continuation primitive the explicit-`position`-at-end branch
        // below already uses. NOTE (round-8 correction): "no position" and
        // "position == count" are equivalent ONLY when the trunk-last step
        // has no existing tails. `executionOrder` emits a node's tails
        // immediately after that node and BEFORE its trunk continuation, so
        // on a tail-bearing pipeline `current(count - 1)` (used below) is a
        // tail, not trunk-last —
        // `position == count` then anchors on that tail, while the
        // no-`position` default here always anchors on trunk-last.
        pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { current =>
          val anchorParentId = pipelineStepRepo.trunkOf(current).lastOption.map(_.id)
          pipelineStepRepo.spliceInsertReportingInternal(pipelineId, req.`type`, typedConfig, anchorParentId, enabled, explicitRootId = None, actingUserId = pipelineOwnerId.value, rejectIfReparents = reject)
            .flatMap { case (step, moved) =>
              audit("pipeline.step.create", "pipeline_step", Some(step.id.value), user)
              stepResponseWithRoot(pipelineId, step).map(resp => Right((resp, moved)))
            }
            .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
        }
      case Some(index) =>
        // Safe: editor/owner access confirmed by the caller. Use internal list
        // (no owner-JOIN) so editor grantees are not blocked by the V35
        // pipeline_steps RLS owner-JOIN policy. Read close to the insert below.
        pipelineStepRepo.listByPipelineInternal(pipelineId).flatMap { current =>
          val count = current.size
          if (index < 0 || index > count) {
            Future.successful(Left(ServiceError.UnprocessableEntity(
              s"position must be between 0 and $count (the pipeline's current step count)"
            )))
          } else {
            // HEL-904 cycle-7 fix (round-4 skeptic Finding 1): `current` is
            // execution order (trunk/tail), not a flat root-sibling list --
            // `index` is a WHOLE-PIPELINE slot, not a sibling-scoped one.
            // Translate it into "splice in directly after the step at
            // index-1" (or at the pipeline root when index == 0) via
            // spliceInsertAtInternal, which re-parents whatever already
            // occupies that trunk slot rather than mis-renumbering a
            // sibling group that `insertAtInternal` would silently no-op
            // on for migrated (parent-chained) pipelines.
            val anchorParentId = if (index == 0) None else Some(current(index - 1).id)
            pipelineStepRepo.spliceInsertReportingInternal(pipelineId, req.`type`, typedConfig, anchorParentId, enabled, explicitRootId = None, actingUserId = pipelineOwnerId.value, rejectIfReparents = reject)
              .flatMap { case (step, moved) =>
                audit("pipeline.step.create", "pipeline_step", Some(step.id.value), user)
                stepResponseWithRoot(pipelineId, step).map(resp => Right((resp, moved)))
              }
              .recover { case ex => Left(PipelineService.classifyDbError(ex)) }
          }
        }
          }
        }
    }
  }
}
