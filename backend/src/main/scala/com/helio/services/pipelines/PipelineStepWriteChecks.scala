package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{CreatePipelineStepRequest, PipelineStepConfigCodec, UpdatePipelineStepRequest}
import com.helio.domain.model.{AuthenticatedUser, Pipeline, PipelineId, PipelineStep, PipelineStepId, PipelineStepKind}
import com.helio.infrastructure.persistence.pipelines.{PipelineRepository, PipelineStepRepository, ReparentRejected}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError
import org.slf4j.LoggerFactory
import spray.json._

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** Whether a step write's graph-dependent checks (the `lane` reference check, placement resolution and the
  * `rejectIfReparents` refusal) run. The service write always passes [[GraphChecks.Run]]; the patch-set resolver passes
  * [[GraphChecks.Skip]] for a step edit on a pipeline an EARLIER edit of the same set already touched, because its
  * resolve pass judges every edit against the STORED graph while apply forwards them one after another (HEL-1722 D7). */
private[services] sealed trait GraphChecks
private[services] object GraphChecks {
  case object Run  extends GraphChecks
  case object Skip extends GraphChecks
}

/** What [[PipelineStepWriteChecks.checkAdd]] resolved: the decoded config, the pipeline (its owner is the upsert and
  * cycle-guard identity) and, when the graph checks ran, the placement anchor. */
private[services] final case class CheckedAdd(typedConfig: Any, pipeline: Pipeline, anchor: Option[CreateAnchor])

/** What [[PipelineStepWriteChecks.checkUpdate]] resolved: the stored step, its pipeline, and the decoded config when the
  * request carried one. */
private[services] final case class CheckedUpdate(existing: PipelineStep, pipeline: Pipeline, typedConfig: Option[Any])

/** The read-only, pre-write checks of `PipelineService.addStep` and `updateStep`, in the service's own order, as functions the
  * service calls before its first write and the patch-set resolvers call at resolve time (so preview and apply judge a step
  * edit exactly as the service will). Nothing here writes. The write-back cycle guard and a step's `position` stay inside the
  * repository write (they need the pipeline lock and the owner's edge read; HEL-1722 design D6). */
private[services] final class PipelineStepWriteChecks private[pipelines] (
    pipelineRepo:        PipelineRepository,
    pipelineStepRepo:    PipelineStepRepository,
    refChecks:           StepReferenceChecks,
    requireEditorAccess: (PipelineId, AuthenticatedUser) => Future[Either[ServiceError, Unit]]
)(implicit ec: ExecutionContext) {

  private val log = LoggerFactory.getLogger(classOf[PipelineService])

  /** Step create: type, raw config, decode, access, secondary ownership, lane, upsert target, placement, `rejectIfReparents`. */
  def checkAdd(pipelineId: PipelineId, req: CreatePipelineStepRequest, user: AuthenticatedUser, graph: GraphChecks): Future[Either[ServiceError, CheckedAdd]] =
    if (!PipelineStepKind.All.contains(req.`type`))
      Future.successful(Left(ServiceError.BadRequest(
        s"Invalid step type '${req.`type`}'. Allowed values: ${PipelineStepKind.All.toSeq.sorted.mkString(", ")}"
      )))
    else
      // HEL-860: the strict write-path check runs before the tolerant decode, so a mistyped config is rejected, not persisted as a no-op.
      PipelineStep.rawConfigProblem(req.`type`, req.config.compactPrint) match {
        case Some(problem) => Future.successful(Left(ServiceError.UnprocessableEntity(problem)))
        case None =>
          PipelineStepConfigCodec.decode(req.`type`, req.config.compactPrint) match {
            case Failure(ex) =>
              // HEL-311: curated prefix only; the detail is logged server-side.
              log.warn(s"addStep: config decode failed for step type '${req.`type`}'", ex)
              Future.successful(Left(ServiceError.BadRequest(s"Invalid '${req.`type`}' config")))
            case Success(typedConfig) => checkAddReferences(pipelineId, req, user, graph, typedConfig)
          }
      }

  private def checkAddReferences(pipelineId: PipelineId, req: CreatePipelineStepRequest, user: AuthenticatedUser, graph: GraphChecks, typedConfig: Any): Future[Either[ServiceError, CheckedAdd]] = {
    // HEL-1515/HEL-1523: access -> ownership -> lane -> upsert target in ONE shared chain (`StepReferenceChecks.referenceChecksF`).
    // HEL-911: a `lane` secondaryInput must name an existing step of THIS pipeline that is not the new step's prospective ancestor,
    // descendant (a step the insert re-parents under it) or lane dependent; computed from the SAME anchor the insert places at.
    def laneScopeF: Future[LaneScope] =
      for {
        roots                   <- pipelineRepo.listRootDataSourceIdsInternal(pipelineId)
        (current, rootIdOfStep) <- pipelineStepRepo.listWithRootIdsInternal(pipelineId)
      } yield {
        val rootIds   = roots.map(_._1)
        val placement = StepPlacement.resolveCreateAnchor(req, current, rootIdOfStep, rootIds, pipelineStepRepo.trunkOf)
        // HEL-1523: when placement fails the lane check falls back to the pre-existing parent guess so error precedence does not move.
        val prospectiveParent = placement match {
          case Right(anchor) => anchor.anchor
          case Left(_) =>
            (req.parentStepId, req.rootId) match {
              case (None, Some(rootIdRaw)) =>
                rootIds.find(_.value == rootIdRaw).flatMap { rootId =>
                  PipelineService.resolveRootTrunkAnchor(current, rootIdOfStep, rootId, req.position).toOption.flatten
                }
              case _ => req.parentStepId.map(PipelineStepId(_)).orElse(pipelineStepRepo.trunkOf(current).lastOption.map(_.id))
            }
        }
        // HEL-1515/HEL-1521: the steps this insert re-parents (and their descendants / lane dependents) cannot be lane targets either.
        val reparented = placement.fold(_ => Set.empty[String], anchor => StepPlacement.reparentedIds(anchor, current, rootIdOfStep))
        LaneScope.of(current, prospectiveParent, reparented, selfId = None)
      }
    def pipelineAccessF: Future[Either[ServiceError, Pipeline]] =
      pipelineRepo.findByIdShared(pipelineId, Some(user)).flatMap {
        case None => Future.successful(Left(ServiceError.NotFound(s"Pipeline not found: ${pipelineId.value}")))
        case Some(pipeline) if pipeline.ownerId.value != user.id.value =>
          // Grantee path: findByIdShared returned Some, so the caller has viewer or editor access; only an editor may write.
          requireEditorAccess(pipelineId, user).map(_.map(_ => pipeline))
        case Some(pipeline) => Future.successful(Right(pipeline))
      }
    refChecks.referenceChecksF[Pipeline](typedConfig, user, laneScopeF, pipelineAccessF, _.ownerId, checkLane = graph == GraphChecks.Run).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(pipeline) =>
        if (graph == GraphChecks.Skip) Future.successful(Right(CheckedAdd(typedConfig, pipeline, None)))
        else placementCheck(pipelineId, req).map(_.map(anchor => CheckedAdd(typedConfig, pipeline, Some(anchor))))
    }
  }

  /** HEL-1515: the placement rejection (both ids named, unknown root/parent, several roots, position out of range) and HEL-1069's
    * opt-in `rejectIfReparents` refusal, from ONE read. The repository repeats the re-parent check under the pipeline lock, which
    * stays authoritative; this copy answers before any write and names the same steps (sorted, so the message is stable). */
  private def placementCheck(pipelineId: PipelineId, req: CreatePipelineStepRequest): Future[Either[ServiceError, CreateAnchor]] =
    (for {
      roots                   <- pipelineRepo.listRootDataSourceIdsInternal(pipelineId)
      (current, rootIdOfStep) <- pipelineStepRepo.listWithRootIdsInternal(pipelineId)
    } yield StepPlacement.resolveCreateAnchor(req, current, rootIdOfStep, roots.map(_._1), pipelineStepRepo.trunkOf).flatMap { anchor =>
      val moved = StepPlacement.reparentedIds(anchor, current, rootIdOfStep)
      if (req.rejectIfReparents.getOrElse(false) && !anchor.attachAsTail && moved.nonEmpty)
        Left(ServiceError.UnprocessableEntity(ReparentRejected(moved.toSeq.sorted).getMessage))
      else Right(anchor)
    })

  /** Step update: step existence and pipeline visibility (the same 404), editor access, type change, and, when `config` is present,
    * raw config, decode, ownership, lane and upsert target. */
  def checkUpdate(stepId: PipelineStepId, req: UpdatePipelineStepRequest, user: AuthenticatedUser, graph: GraphChecks): Future[Either[ServiceError, CheckedUpdate]] =
    pipelineStepRepo.findByIdInternal(stepId).flatMap {
      case None => Future.successful(Left(notFound(stepId)))
      case Some(existing) =>
        // The caller must at least see the pipeline; otherwise the step does not exist from their perspective (HEL-1002).
        pipelineRepo.findByIdShared(PipelineId(existing.pipelineId.value), Some(user)).flatMap {
          case None => Future.successful(Left(notFound(stepId)))
          case Some(pipeline) =>
            val editorCheckF: Future[Either[ServiceError, Unit]] =
              if (pipeline.ownerId.value == user.id.value) Future.successful(Right(()))
              else requireEditorAccess(pipeline.id, user)
            editorCheckF.flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_) =>
                req.`type` match {
                  case Some(t) if t != existing.kind =>
                    Future.successful(Left(ServiceError.BadRequest(
                      s"Cannot change step type from '${existing.kind}' to '$t'. Delete the step and create a new one instead."
                    )))
                  case _ =>
                    req.config match {
                      case None => Future.successful(Right(CheckedUpdate(existing, pipeline, None)))
                      case Some(cfgJson) => checkUpdateConfig(existing, pipeline, cfgJson, user, graph)
                    }
                }
            }
        }
    }

  private def notFound(stepId: PipelineStepId): ServiceError = ServiceError.NotFound(s"Pipeline step not found: ${stepId.value}")

  private def checkUpdateConfig(existing: PipelineStep, pipeline: Pipeline, cfgJson: JsObject, user: AuthenticatedUser, graph: GraphChecks): Future[Either[ServiceError, CheckedUpdate]] =
    PipelineStep.rawConfigProblem(existing.kind, cfgJson.compactPrint) match {
      case Some(problem) => Future.successful(Left(ServiceError.UnprocessableEntity(problem)))
      case None =>
        PipelineStepConfigCodec.decode(existing.kind, cfgJson.compactPrint) match {
          case Failure(ex) =>
            log.warn(s"updateStep: config decode failed for step type '${existing.kind}'", ex)
            Future.successful(Left(ServiceError.BadRequest(s"Invalid '${existing.kind}' config")))
          case Success(typedConfig) =>
            // HEL-1515: the lane check runs against the EXISTING step's parent chain and its own id (a step cannot reference itself);
            // HEL-1521: and steps that depend on it through lane links.
            def laneScopeF: Future[LaneScope] =
              pipelineStepRepo.listByPipelineInternal(PipelineId(existing.pipelineId.value)).map { current =>
                LaneScope.of(current, existing.parentStepId, Set(existing.id.value), selfId = Some(existing.id.value))
              }
            refChecks.referenceChecksF[Pipeline](typedConfig, user, laneScopeF, Future.successful(Right(pipeline)), _.ownerId, checkLane = graph == GraphChecks.Run)
              .map(_.map(_ => CheckedUpdate(existing, pipeline, Some(typedConfig))))
        }
    }
}

private[services] object PipelineStepWriteChecks {

  /** Builds the checks from the repositories alone, wiring the same editor rule `PipelineService` uses (a grant row with the
    * `editor` role), so a construction site (`PatchSetApplyContext.build`) cannot omit or mis-wire a collaborator. */
  def fromRepos(pipelineRepo: PipelineRepository, pipelineStepRepo: PipelineStepRepository, dataSourceRepo: DataSourceRepository)(implicit ec: ExecutionContext): PipelineStepWriteChecks = {
    // The checks never audit, so the null audit service is never touched.
    val support = new PipelineServiceSupport(pipelineStepRepo, dataSourceRepo, null)
    new PipelineStepWriteChecks(pipelineRepo, pipelineStepRepo, new StepReferenceChecks(dataSourceRepo, support), editorAccess(pipelineRepo))
  }

  /** `PipelineService.requireEditorAccess`: the caller is a grantee, so only an `editor` grant may write. */
  private[services] def editorAccess(pipelineRepo: PipelineRepository)(implicit ec: ExecutionContext): (PipelineId, AuthenticatedUser) => Future[Either[ServiceError, Unit]] =
    (pipelineId, user) => pipelineRepo.findGrantRole(pipelineId, user).map {
      case Some("editor") => Right(())
      case _              => Left(ServiceError.Forbidden("Forbidden"))
    }
}
