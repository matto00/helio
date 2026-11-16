package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.{CreatePipelineTransactionalStepRequest, PipelineStepConfigCodec}
import com.helio.domain.UpsertSourceConfig
import com.helio.domain.steps.UpsertTargetCheck
import com.helio.domain.engine.{PipelineAnalyzeService, SchemaField}
import com.helio.domain.model.{AuthenticatedUser, DataSource, DataSourceId, UserId}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError

import scala.concurrent.{ExecutionContext, Future}
import scala.util.{Failure, Success}

/** HEL-1638: the read-only step ownership checks `createTransactional`'s caller runs before writing, factored over the one
 *  collaborator they need (a [[DataSourceRepository]]) so the propose-time dry run calls the SAME functions without
 *  constructing the write services around nulls. [[PipelineServiceSupport]] and [[PipelineCreateTransaction]] delegate here. */
private[pipelines] object PipelineStepOwnership {

  /** HEL-907: closes a real gap found while retargeting `PipelineProposalService` onto this
   *  single-call transactional path -- `addStep` (the pre-existing per-step write path) has
   *  always pre-flighted a join/union/lookup step's cross-referenced `DataSourceId` for caller
   *  ownership (HEL-278/HEL-384/HEL-386) BEFORE persisting, but `buildStepsAction` (added by
   *  HEL-906, this path's own transactional step-insert loop) never carried the same check --
   *  any caller of `POST /api/pipelines` with a non-empty `steps[]` (not just the proposal path)
   *  could otherwise reference another user's DataSource as a join/union/lookup right-source with
   *  no ownership check at all. Runs entirely OUTSIDE the write transaction (read-only), decoding
   *  each step's config the same way `buildStepsAction` will re-decode it a moment later --
   *  duplicated decode work, never duplicated behavior (both call sites route through the same
   *  `PipelineStepConfigCodec.decode`), so a config `buildStepsAction` would itself reject never
   *  reaches a cross-owner check with a bogus decoded value. An empty `Source("")`
   *  `LookupConfig.secondaryInput` (HEL-911) is a no-op here too, mirroring `addStep`'s own "an
   *  incomplete draft, not a security violation" carve-out. */
  private[pipelines] def validateCrossOwnerRefs(
      dataSourceRepo: DataSourceRepository,
      steps: Vector[CreatePipelineTransactionalStepRequest],
      user: AuthenticatedUser
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] = {
    // HEL-1469: the request-scoped lane checks (HEL-911 CR5) moved to `PipelineCreatePreflight.laneChecks`,
    // which runs for every step BEFORE this ownership pass; only the read-only ownership lookups remain here.
    steps.foldLeft(Future.successful[Either[ServiceError, Unit]](Right(()))) { (accF, step) =>
      accF.flatMap {
        case Left(err) => Future.successful(Left(err))
        case Right(()) =>
          PipelineStepConfigCodec.decode(step.`type`, step.config.compactPrint) match {
            case Failure(_) => Future.successful(Right(())) // buildStepsAction will reject this; not this check's job.
            case Success(typedConfig) =>
              // HEL-950: was three hand-copied per-op arms (join unconditional -- the same
              // unguarded-empty-id bug this change closes elsewhere -- union/lookup already
              // `.nonEmpty`-guarded); now driven by the one shared extractor so this call site
              // cannot drift from PipelineService.addStep/updateStep the way it already had.
              val crossOwnerF: Future[Either[ServiceError, Unit]] =
                StepReferenceChecks.secondarySourceOwnershipF(dataSourceRepo, typedConfig, user).map(_.left.map(id =>
                  ServiceError.NotFound(s"Data source not found: $id")
                ))
              crossOwnerF.flatMap {
                case Left(err) => Future.successful(Left(err))
                case Right(()) =>
                  // HEL-1100 (design.md Decision 1): `create()`'s caller IS the new pipeline's
                  // owner (there is no grantee at creation time), so `user.id` already IS
                  // `pipeline.ownerId` here -- unlike addStep/updateStep, no separate pipeline
                  // fetch is needed to know the owner.
                  upsertOwnershipCheck(dataSourceRepo, typedConfig, user.id, user)
              }
          }
      }
    }
  }

  /** HEL-1100 (design.md Decision 1): an `upsertsource` step's target must be OWNED BY THE
   *  PIPELINE OWNER, not the calling grantee -- resolved against
   *  `AuthenticatedUser(pipeline.ownerId, ...)` (D5: writes always run as the owner), never the
   *  caller's own identity. A grantee therefore cannot target the grantee's own dataset (rejected
   *  here, "data source not found"), but can target the owner's. `None` for every non-`upsertsource`
   *  config (mirrors `secondaryDataSourceId`'s own "no second source" no-op contract). */
  private[pipelines] def upsertOwnershipCheck(dataSourceRepo: DataSourceRepository, typedConfig: Any, pipelineOwnerId: UserId, caller: AuthenticatedUser)(implicit ec: ExecutionContext): Future[Either[ServiceError, Unit]] =
    typedConfig match {
      case cfg: UpsertSourceConfig =>
        val ownerUser = AuthenticatedUser(pipelineOwnerId, caller.source, caller.tokenId)
        UpsertTargetCheck.check(cfg.target, ownerUser, dataSourceRepo).map {
          case UpsertTargetCheck.NotFound(msg)    => Left(ServiceError.NotFound(msg))
          case UpsertTargetCheck.NotWritable(msg) => Left(ServiceError.UnprocessableEntity(msg))
          case UpsertTargetCheck.Writable         => Right(())
        }
      case _ => Future.successful(Right(()))
    }

  /** Secondary-source schemas for join/union/lookup steps, resolved through `resolve`. */
  private[pipelines] def resolveSecondarySourceSchemas(
      steps:   Iterable[(String, String)],
      resolve: DataSourceId => Future[Option[DataSource]]
  )(implicit ec: ExecutionContext): Future[Map[String, Vector[SchemaField]]] = {
    val ids = steps.flatMap { case (op, config) => PipelineAnalyzeService.secondarySourceIdOf(op, config) }.toVector.distinct
    Future.traverse(ids)(id => resolve(DataSourceId(id)).map(id -> _.map(_.inferredSchema).filter(_.nonEmpty)))
      .map(_.collect { case (id, Some(schema)) => id -> schema }.toMap)
  }
}
