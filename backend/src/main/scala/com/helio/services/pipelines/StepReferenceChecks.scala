package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, PipelineStep, UserId}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError

import scala.concurrent.{ExecutionContext, Future}

/** What [[StepReferenceChecks.referenceChecksF]] needs to validate a `lane` reference (HEL-1515): the pipeline's
 *  steps and, for the step being written, its prospective `ancestors` and `descendants` (the steps that would
 *  already depend on it), plus `selfId` when the step already exists. */
private[pipelines] final case class LaneScope(
    steps:      Vector[PipelineStep],
    ancestors:  Set[String],
    descendants: Set[String],
    selfId:     Option[String]
)

/** The ONE reference-check chain step create, update and duplicate share (HEL-1515, extracted from three inline
 *  copies): secondary-source ownership (CALLER identity), then the `lane` reference, then whatever the caller must
 *  settle before the upsert check (create: the pipeline lookup and editor check), then the upsert target
 *  (PIPELINE OWNER identity). The stage order lives here and nowhere else. */
private[pipelines] final class StepReferenceChecks(
    dataSourceRepo: DataSourceRepository,
    support:        PipelineServiceSupport
)(implicit ec: ExecutionContext) {

  /** Runs the chain; the first `Left` short-circuits. `laneScopeF` is evaluated only when the config carries a
    * `lane` reference. `beforeUpsertF` yields the value `upsertOwner` reads the pipeline owner from. */
  def referenceChecksF[A](
      typedConfig:   Any,
      user:          AuthenticatedUser,
      laneScopeF:    => Future[LaneScope],
      beforeUpsertF: => Future[Either[ServiceError, A]],
      upsertOwner:   A => UserId
  ): Future[Either[ServiceError, A]] =
    ownershipCheckF(typedConfig, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(_)  =>
        laneCheckF(typedConfig, laneScopeF).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_)  =>
            beforeUpsertF.flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(a)  => support.upsertOwnershipCheckF(typedConfig, upsertOwner(a), user).map(_.map(_ => a))
            }
        }
    }

  /** The second, separately-owned DataSource a join/union/lookup config references must be caller-owned
    * (HEL-278/HEL-384/HEL-386). An EMPTY second-source id (the picker's own `defaultConfigFor` seed) is an
    * incomplete draft, not a security violation, so `secondaryDataSourceId` returns `None` for it and the check
    * is skipped (HEL-620, HEL-950). */
  private def ownershipCheckF(typedConfig: Any, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    PipelineStepConfigCodec.secondaryDataSourceId(typedConfig) match {
      case Some(id) =>
        dataSourceRepo.findByIdOwned(DataSourceId(id), user).map {
          case None    => Left(ServiceError.NotFound(s"Data source not found: $id"))
          case Some(_) => Right(())
        }
      case None => Future.successful(Right(()))
    }

  /** HEL-911 (Engine contract items 6a/7): a `lane` secondaryInput must name an existing step of THIS pipeline
    * that is neither the step itself, one of its ancestors, nor (HEL-1515) one of its descendants. */
  private def laneCheckF(typedConfig: Any, laneScopeF: => Future[LaneScope]): Future[Either[ServiceError, Unit]] =
    PipelineStepConfigCodec.secondaryLaneStepId(typedConfig) match {
      case None    => Future.successful(Right(()))
      case Some(_) => laneScopeF.map(s => PipelineService.validateLaneReference(typedConfig, s.steps, s.ancestors, s.descendants, s.selfId))
    }
}
