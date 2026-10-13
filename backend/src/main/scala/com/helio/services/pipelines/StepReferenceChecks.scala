package com.helio.services.pipelines

import com.helio.api.protocols.pipelines.PipelineStepConfigCodec
import com.helio.domain.model.{AuthenticatedUser, DataSourceId, PipelineStep, UserId}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError

import scala.concurrent.{ExecutionContext, Future}

/** What [[StepReferenceChecks.referenceChecksF]] needs to validate a `lane` reference (HEL-1515): the pipeline's
 *  steps and, for the step being written, its prospective `ancestors` and `descendants` (its own parent-chain
 *  descendants, including steps a create re-parents under it), plus `selfId` when the step already exists. */
private[pipelines] final case class LaneScope(
    steps:      Vector[PipelineStep],
    ancestors:  Set[String],
    descendants: Set[String],
    selfId:     Option[String]
)

/** The ONE reference-check chain step create, update and duplicate share (HEL-1515, extracted from three inline
 *  copies): the caller's access to the pipeline FIRST (HEL-1523: create's pipeline lookup and editor check; update
 *  and duplicate pass their already-resolved pipeline), so nothing about the pipeline's steps is read for a caller
 *  who cannot edit it; then secondary-source ownership (CALLER identity), then the `lane` reference, then the
 *  upsert target (PIPELINE OWNER identity). The stage order lives here and nowhere else. */
private[pipelines] final class StepReferenceChecks(
    dataSourceRepo: DataSourceRepository,
    support:        PipelineServiceSupport
)(implicit ec: ExecutionContext) {

  /** Runs the chain; the first `Left` short-circuits. `accessF` is evaluated first and yields the value
    * `upsertOwner` reads the pipeline owner from. `laneScopeF` is evaluated only when the config carries a `lane`
    * reference, and only after access succeeded. */
  def referenceChecksF[A](
      typedConfig:   Any,
      user:          AuthenticatedUser,
      laneScopeF:    => Future[LaneScope],
      accessF:       => Future[Either[ServiceError, A]],
      upsertOwner:   A => UserId
  ): Future[Either[ServiceError, A]] =
    accessF.flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(a)  =>
        StepReferenceChecks.secondarySourceOwnershipF(dataSourceRepo, typedConfig, user).flatMap {
          case Left(id) => Future.successful(Left(ServiceError.NotFound(s"Data source not found: $id")))
          case Right(_) =>
            laneCheckF(typedConfig, laneScopeF).flatMap {
              case Left(err) => Future.successful(Left(err))
              case Right(_)  => support.upsertOwnershipCheckF(typedConfig, upsertOwner(a), user).map(_.map(_ => a))
            }
        }
    }

  /** HEL-911 (Engine contract items 6a/7): a `lane` secondaryInput must name an existing step of THIS pipeline
    * that is neither the step itself, one of its ancestors, nor (HEL-1515) one of its descendants. */
  private def laneCheckF(typedConfig: Any, laneScopeF: => Future[LaneScope]): Future[Either[ServiceError, Unit]] =
    PipelineStepConfigCodec.secondaryLaneStepId(typedConfig) match {
      case None    => Future.successful(Right(()))
      case Some(_) => laneScopeF.map(s => PipelineService.validateLaneReference(typedConfig, s.steps, s.ancestors, s.descendants, s.selfId))
    }
}

object StepReferenceChecks {

  /** The second, separately-owned DataSource a join/union/lookup config references must be caller-owned
    * (HEL-278/HEL-384/HEL-386). An EMPTY second-source id (the picker's own `defaultConfigFor` seed) is an
    * incomplete draft, not a security violation, so `secondaryDataSourceId` returns `None` for it and the check
    * is skipped (HEL-620, HEL-950). `Left(id)` is the referenced id the caller does not own (or that does not
    * exist); each caller words its own error. HEL-1523: the one implementation create, update, duplicate,
    * pipeline create and patch-set pre-authorization all call. */
  private[services] def secondarySourceOwnershipF(
      dataSourceRepo: DataSourceRepository,
      typedConfig:    Any,
      user:           AuthenticatedUser
  )(implicit ec: ExecutionContext): Future[Either[String, Unit]] =
    PipelineStepConfigCodec.secondaryDataSourceId(typedConfig) match {
      case Some(id) =>
        dataSourceRepo.findByIdOwned(DataSourceId(id), user).map {
          case None    => Left(id)
          case Some(_) => Right(())
        }
      case None => Future.successful(Right(()))
    }
}
