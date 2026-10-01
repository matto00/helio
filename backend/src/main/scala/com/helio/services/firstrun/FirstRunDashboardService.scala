package com.helio.services.firstrun

import com.helio.api.protocols.firstrun.FirstRunDashboardResponse
import com.helio.api.protocols.panels.UpdatePanelRequest
import com.helio.api.protocols.pipelines.PipelineProposal
import com.helio.api.protocols.proposals.DashboardProposal
import com.helio.domain.model.{AuthenticatedUser, CsvSource, Dashboard, DataSourceId, Panel, PanelId}
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.services.ServiceError
import com.helio.services.panels.PanelService
import com.helio.services.pipelines.PipelineProposalService
import com.helio.services.sources.DataSourceService

import spray.json.{JsObject, JsString}

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
    applyDashboard: FirstRunDashboardService.ApplyDashboard,
    setChartType: FirstRunDashboardService.SetChartType
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
            case Right(proposal) => applyPlan(source, source.name, proposal, user)
          }
    }

  /** Builds a dashboard from a persona template (HEL-1210): creates the user's own sample CSV source
   *  from the bundled classpath resource, then runs the SAME [[applyPlan]] path as [[build]] with the
   *  template's pipeline in place of the rule planner's. Any failure after the source exists deletes
   *  it again (the pipeline phase rolls itself back; the dashboard phase's rollback is in `applyPlan`),
   *  so a failed click leaves nothing behind. */
  def buildTemplate(slug: String, user: AuthenticatedUser): Future[Either[ServiceError, FirstRunDashboardResponse]] =
    PersonaTemplates.bySlug(slug) match {
      case None           => Future.successful(Left(ServiceError.BadRequest(s"Unknown template '$slug'")))
      case Some(template) => instantiate(template, user)
    }

  private[firstrun] def instantiate(
      template: PersonaTemplates.PersonaTemplate,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, FirstRunDashboardResponse]] =
    readResource(template.resource) match {
      case Left(msg) => Future.successful(Left(ServiceError.InternalError(msg)))
      case Right(bytes) =>
        dataSourceService.createCsv(template.sourceName, bytes, Vector.empty, user).flatMap {
          case Left(err)                 => Future.successful(Left(err))
          case Right(created: CsvSource) => applyTemplate(template, created, user)
          case Right(other) =>
            dataSourceService.delete(other.id, user).map(_ => Left(ServiceError.InternalError("Template source was not a CSV")))
        }
    }

  private def applyTemplate(
      template: PersonaTemplates.PersonaTemplate,
      created: CsvSource,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, FirstRunDashboardResponse]] = {
    val applied = template.pipelineProposal(created.id.value) match {
      case Left(msg)       => Future.successful(Left(ServiceError.InternalError(msg)))
      case Right(proposal) => applyPlan(created, template.dashboardName, proposal, user, explicitChartTypes = true)
    }
    applied
      .flatMap {
        case Left(err) => dataSourceService.delete(created.id, user).map(_ => Left(err))
        case right     => Future.successful(right)
      }
      .recoverWith { case ex => dataSourceService.delete(created.id, user).flatMap(_ => Future.failed(ex)) }
  }

  /** A chart panel renders the type on its own appearance, not the output's config, and a proposal
   *  panel's `chartType` is not consumed by the dashboard apply, so each explicit type is set with
   *  one follow-up patch. Best-effort like the layout step: a failure leaves a default line chart on
   *  an otherwise complete dashboard rather than discarding it. */
  private def applyChartTypes(
      dashboardProposal: DashboardProposal,
      panels: Vector[Panel],
      user: AuthenticatedUser
  ): Future[Unit] =
    Future.sequence(dashboardProposal.panels.zip(panels).collect { case (planned, panel) if planned.chartType.isDefined =>
      setChartType(panel.id, planned.chartType.get, user)
    }).map(_ => ())

  private def readResource(path: String): Either[String, Array[Byte]] =
    Option(getClass.getClassLoader.getResourceAsStream(path)) match {
      case None         => Left(s"Template data '$path' is missing from the classpath")
      case Some(stream) => try Right(stream.readAllBytes()) finally stream.close()
    }

  private def applyPlan(
      source: CsvSource,
      dashboardName: String,
      proposal: PipelineProposal,
      user: AuthenticatedUser,
      explicitChartTypes: Boolean = false
  ): Future[Either[ServiceError, FirstRunDashboardResponse]] =
    pipelineProposalService.apply(proposal, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(applied) =>
        FirstRunPlanner.dashboardProposal(dashboardName, proposal, applied.outputs, explicitChartTypes) match {
          case Left(msg) => pipelineProposalService.rollback(applied, user).map(_ => Left(ServiceError.InternalError(msg)))
          case Right(dashboardProposal) =>
            applyDashboard(dashboardProposal, user).flatMap {
              case Left(err) => pipelineProposalService.rollback(applied, user).map(_ => Left(err))
              case Right((dashboard, panels)) =>
                applyChartTypes(dashboardProposal, panels, user).map(_ => Right(FirstRunDashboardResponse(
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

  /** Patches one panel's chart appearance to the given `chartType`. */
  type SetChartType = (PanelId, String, AuthenticatedUser) => Future[Either[ServiceError, Panel]]

  def chartTypeVia(panelService: PanelService): SetChartType =
    (panelId, chartType, user) =>
      panelService.update(
        panelId,
        UpdatePanelRequest(None, Some(JsObject("chart" -> JsObject("chartType" -> JsString(chartType)))), None, None),
        user
      )

  /** `DashboardProposalService.apply`, injected as a function so the rollback path can be exercised
   *  with a failing stand-in (the real service is final). */
  type ApplyDashboard = (DashboardProposal, AuthenticatedUser) => Future[Either[ServiceError, (Dashboard, Vector[Panel])]]
}
