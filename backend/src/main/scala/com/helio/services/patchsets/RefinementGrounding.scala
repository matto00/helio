package com.helio.services.patchsets

import com.helio.services.ServiceError
import com.helio.services.panels.PanelCapabilityService
import com.helio.services.pipelines.PipelineService
import com.helio.services.workspace.WorkspaceContextService
import com.helio.api.protocols.panels.PanelCapabilitiesResponse
import com.helio.api.protocols.pipelines.{PipelineStepResponse, PipelineSummaryResponse}
import com.helio.api.protocols.patchsets.RefinementTarget
import com.helio.api.protocols.workspace.WorkspaceContextOutput
import com.helio.domain.model.{AuthenticatedUser, Dashboard, DashboardId, OutputId, Page, Panel, PipelineId}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository

import scala.concurrent.{ExecutionContext, Future}

/** One target's grounded live state (design.md D1): the target's OWN current resources (a
 *  dashboard's panels, or a pipeline's steps) plus workspace-wide pipeline-output DataTypes + their
 *  panel-capability menus (AC5) — the raw ingredients `RefinementPrompt` renders into prompt text.
 *  Exactly one of `dashboard`/`pipeline` is populated, matching the request's `target.kind`. */
final case class RefinementGroundedContext(
    dashboard: Option[(Dashboard, Vector[Panel])],
    pipeline: Option[(PipelineSummaryResponse, Vector[PipelineStepResponse])],
    dataTypes: Vector[WorkspaceContextOutput],
    capabilities: Map[String, PanelCapabilitiesResponse],
    warnings: Vector[String]
)

/** Fetches a refinement target's real current live state (design.md D1) — the SAME sharing-aware,
 *  ACL-checked collaborators `PatchSetApplyResolvers.resolveDashboardUpdate` and `AutoLayoutService`
 *  already use for this identical need (`DashboardRepository.findById(id, callerOpt)` +
 *  `PanelRepository.findAllByDashboardId(id, Some(user), Page(0, Page.MaxLimit))`; `PipelineService.
 *  findSummaryById` + `.listSteps` for a pipeline target — both already viewer-sufficient,
 *  sharing-aware reads) — plus the workspace-wide grounding `DashboardAuthoringService.
 *  assembleGroundedContext` already assembles (AC5), so a refinement that binds a NOT-yet-used
 *  pipeline-output DataType has something to bind to.
 *
 *  Doubles as `RefinementService`'s target-resolution + ACL check (task 2.5): a `Left` here means
 *  the target doesn't exist or isn't accessible, resolved BEFORE any Claude call. Never calls Claude;
 *  holds no prompt-text-building logic of its own (`RefinementPrompt`'s job). */
final class RefinementGrounding(
    dashboardRepo: DashboardRepository,
    panelRepo: PanelRepository,
    pipelineService: PipelineService,
    workspaceContextService: WorkspaceContextService,
    panelCapabilityService: PanelCapabilityService
)(implicit ec: ExecutionContext) {

  def assemble(target: RefinementTarget, user: AuthenticatedUser): Future[Either[ServiceError, RefinementGroundedContext]] =
    target.kind match {
      case "dashboard" => assembleDashboard(DashboardId(target.id), user)
      case "pipeline"  => assemblePipeline(PipelineId(target.id), user)
      case other       => Future.successful(Left(ServiceError.BadRequest(s"target.kind must be 'dashboard' or 'pipeline', got '$other'")))
    }

  private def assembleDashboard(id: DashboardId, user: AuthenticatedUser): Future[Either[ServiceError, RefinementGroundedContext]] =
    dashboardRepo.findById(id, Some(user)).flatMap {
      case None => Future.successful(Left(ServiceError.NotFound("Dashboard not found")))
      case Some(dashboard) =>
        panelRepo.findAllByDashboardId(id, Some(user), Page(0, Page.MaxLimit)).flatMap { paged =>
          withWorkspaceContext(user).map { case (dataTypes, capabilities, warnings) =>
            Right(RefinementGroundedContext(Some((dashboard, paged.items)), None, dataTypes, capabilities, warnings))
          }
        }
    }

  private def assemblePipeline(id: PipelineId, user: AuthenticatedUser): Future[Either[ServiceError, RefinementGroundedContext]] =
    pipelineService.findSummaryById(id, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(summary) =>
        pipelineService.listSteps(id, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(steps) =>
            withWorkspaceContext(user).map { case (dataTypes, capabilities, warnings) =>
              Right(RefinementGroundedContext(None, Some((summary, steps)), dataTypes, capabilities, warnings))
            }
        }
    }

  /** Same shape as `DashboardAuthoringService.assembleGroundedContext`'s own workspace-context
   *  fan-out (AC5) — pipeline-output DataTypes only, one degrade-not-fail capability fetch per type.
   *  Unlike that method, a workspace with NO pipeline-output DataTypes is not itself a failure here
   *  (`EmptyWorkspace` is an authoring-only short-circuit — a refinement like "rename this dashboard"
   *  or "delete the last panel" needs no DataType at all to succeed). */
  private def withWorkspaceContext(
      user: AuthenticatedUser
  ): Future[(Vector[WorkspaceContextOutput], Map[String, PanelCapabilitiesResponse], Vector[String])] =
    workspaceContextService.assemble(user).flatMap { workspace =>
      val outputTypes = workspace.dataTypes.filter(_.pipelineOutput)
      Future.traverse(outputTypes)(dt => fetchCapability(dt.id, user)).map { results =>
        (outputTypes, results.collect { case Right(pair) => pair }.toMap, results.collect { case Left(warning) => warning })
      }
    }

  /** One per-DataType capability fetch. A failure degrades to a warning for THAT type only — mirrors
   *  `DashboardAuthoringService.fetchCapability`'s identical degrade-not-fail precedent; never fails
   *  the whole grounding assembly. */
  private def fetchCapability(dataTypeId: String, user: AuthenticatedUser): Future[Either[String, (String, PanelCapabilitiesResponse)]] =
    panelCapabilityService
      .getCapabilities(OutputId(dataTypeId), user)
      .map {
        case Right(capabilities) => Right(dataTypeId -> capabilities)
        case Left(err)           => Left(degradeMessage(dataTypeId, err.message))
      }
      .recover { case ex => Left(degradeMessage(dataTypeId, Option(ex.getMessage).getOrElse(ex.getClass.getName))) }

  private def degradeMessage(dataTypeId: String, reason: String): String =
    s"Could not load panel capabilities for data type $dataTypeId: $reason"
}
