package com.helio.services.firstrun

import com.helio.api.protocols.firstrun.FirstRunDashboardResponse
import com.helio.api.protocols.pipelines.PipelineProposal
import com.helio.api.protocols.proposals.DashboardProposal
import com.helio.domain.model.{AuthenticatedUser, CsvSource, Dashboard, DataSourceId, Panel}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError
import com.helio.services.pipelines.PipelineProposalService
import com.helio.services.sources.DataSourceService

import scala.concurrent.{ExecutionContext, Future}

/** Deterministic zero-to-dashboard build for the first-run drop zone (HEL-1209): reads an
 *  already-created CSV source, classifies its columns by rule ([[ColumnClassifier]]), plans a
 *  pipeline + outputs ([[FirstRunPlanner]]), applies the pipeline (which runs it), then builds a
 *  dashboard over the real output ids.
 *
 *  Constructor deliberately has no Claude client or AI-step collaborator: the builder is
 *  structurally incapable of an LLM call, for every tier, and is NOT tier-gated.
 *
 *  Atomicity without extending `CombinedProposalService`'s single-output `$pipelineOutput`
 *  sentinel: the pipeline is applied first (its own failure rolls itself back, including the run),
 *  and if the dashboard phase then fails the pipeline is rolled back here exactly as
 *  `CombinedProposalService` does. The source is the caller's pre-existing one and is never
 *  deleted by this rollback (`PipelineProposalApplyResponse.sources` is empty for an existing root). */
final class FirstRunDashboardService(
    dataSourceRepo: DataSourceRepository,
    dataSourceService: DataSourceService,
    pipelineProposalService: PipelineProposalService,
    applyDashboard: FirstRunDashboardService.ApplyDashboard
)(implicit ec: ExecutionContext) {

  def build(sourceId: DataSourceId, user: AuthenticatedUser): Future[Either[ServiceError, FirstRunDashboardResponse]] =
    dataSourceRepo.findByIdOwned(sourceId, user).flatMap {
      case None                    => Future.successful(Left(ServiceError.NotFound("Data source not found")))
      case Some(source: CsvSource) => sampleAndBuild(source, user)
      case Some(_)                 => Future.successful(Left(ServiceError.BadRequest("first-run build requires a CSV source")))
    }

  private def sampleAndBuild(source: CsvSource, user: AuthenticatedUser): Future[Either[ServiceError, FirstRunDashboardResponse]] =
    dataSourceService.preview(source.id, ColumnClassifier.SampleRows, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(sample) =>
        val columns = ColumnClassifier.classify(sample.headers, sample.rows)
        if (columns.isEmpty) Future.successful(Left(ServiceError.BadRequest("The CSV has no usable header row")))
        else if (sample.rows.isEmpty) Future.successful(Left(ServiceError.BadRequest("The CSV has no data rows")))
        else
          FirstRunPlanner.pipelineProposal(source.id.value, source.name, columns) match {
            case Left(msg)       => Future.successful(Left(ServiceError.InternalError(msg)))
            case Right(proposal) => applyBoth(source, proposal, user)
          }
    }

  private def applyBoth(
      source: CsvSource,
      proposal: PipelineProposal,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, FirstRunDashboardResponse]] =
    pipelineProposalService.apply(proposal, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(applied) =>
        FirstRunPlanner.dashboardProposal(source.name, proposal, applied.outputs) match {
          case Left(msg) => pipelineProposalService.rollback(applied, user).map(_ => Left(ServiceError.InternalError(msg)))
          case Right(dashboardProposal) =>
            applyDashboard(dashboardProposal, user).flatMap {
              case Left(err) => pipelineProposalService.rollback(applied, user).map(_ => Left(err))
              case Right((dashboard, panels)) =>
                Future.successful(Right(FirstRunDashboardResponse(
                  dashboardId   = dashboard.id.value,
                  dashboardName = dashboardProposal.dashboardName,
                  panelCount    = panels.size,
                  pipelineId    = applied.pipeline.id,
                  pipelineName  = proposal.pipelineName,
                  sourceId      = source.id.value,
                  sourceName    = source.name
                )))
            }
        }
    }
}

object FirstRunDashboardService {

  /** `DashboardProposalService.apply`, injected as a function so the rollback path can be exercised
   *  with a failing stand-in (the real service is final). */
  type ApplyDashboard = (DashboardProposal, AuthenticatedUser) => Future[Either[ServiceError, (Dashboard, Vector[Panel])]]
}
