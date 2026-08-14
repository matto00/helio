package com.helio.services

import com.helio.api.protocols.{DashboardResponse, DataSourceResponse, DataTypeResponse, EditOutcome, PanelResponse, PipelineStepResponse}
import com.helio.domain.AuthenticatedUser
import PatchSetApplyServiceJson._

import scala.concurrent.{ExecutionContext, Future}

/** Forward-apply (design.md D1, tasks.md 4.1/4.2): applies one resolved edit
 *  via the matching EXISTING per-resource service method only — no direct
 *  repository writes. Every kind's `delete` method is in scope here even
 *  where design.md D1 marks its ROLLBACK `unrecoverable` (that limit applies
 *  to undoing the delete, not to whether the delete itself can be applied).
 *
 *  `resultingState` is populated from the domain object the service call
 *  itself already returns — no second read for `create`; `update`'s
 *  resulting state is the SAME response `PATCH .../:id` would give back. */
private[services] object PatchSetApplyForward {

  def applyOne(
      edit: ResolvedEdit,
      user: AuthenticatedUser,
      services: PatchSetApplyServices
  )(implicit ec: ExecutionContext): Future[Either[ServiceError, EditOutcome]] =
    edit.action match {

      // ── panel ──────────────────────────────────────────────────────────
      case ResolvedAction.PanelUpdate(id, request, _) =>
        services.panelService.update(id, request, user).map(_.map { panel =>
          edit.toOutcome("applied", resultingState = Some(panelResponseFormat.write(PanelResponse.fromDomain(panel))))
        })
      case ResolvedAction.PanelDelete(id, _) =>
        services.panelService.delete(id, user).map(_.map(_ => edit.toOutcome("applied")))
      case ResolvedAction.PanelCreate(request) =>
        services.panelService.create(request, user).map(_.map { panel =>
          edit.toOutcome("applied", newId = Some(panel.id.value), resultingState = Some(panelResponseFormat.write(PanelResponse.fromDomain(panel))))
        })

      // ── dashboard ──────────────────────────────────────────────────────
      case ResolvedAction.DashboardUpdate(id, request, _) =>
        services.dashboardService.update(id, request, user).map(_.map { dashboard =>
          edit.toOutcome("applied", resultingState = Some(dashboardResponseFormat.write(DashboardResponse.fromDomain(dashboard))))
        })
      case ResolvedAction.DashboardDelete(id, _) =>
        services.dashboardService.delete(id, user).map(_.map(_ => edit.toOutcome("applied")))
      case ResolvedAction.DashboardCreate(request) =>
        services.dashboardService
          .create(DashboardService.CreateDashboardInput(name = request.name, ifExists = None), user)
          .map { case (dashboard, _) =>
            Right(edit.toOutcome(
              "applied",
              newId          = Some(dashboard.id.value),
              resultingState = Some(dashboardResponseFormat.write(DashboardResponse.fromDomain(dashboard)))
            ))
          }

      // ── dataSource ─────────────────────────────────────────────────────
      case ResolvedAction.DataSourceUpdate(id, request, _) =>
        services.dataSourceService.update(id, request, user).map(_.map { ds =>
          edit.toOutcome("applied", resultingState = Some(dataSourceResponseFormat.write(DataSourceResponse.fromDomain(ds))))
        })
      case ResolvedAction.DataSourceDelete(id, _) =>
        services.dataSourceService.delete(id, user).map(_.map(_ => edit.toOutcome("applied")))
      case ResolvedAction.DataSourceCreate(request) =>
        services.dataSourceService.createStatic(request, user).map(_.map { ds =>
          edit.toOutcome("applied", newId = Some(ds.id.value), resultingState = Some(dataSourceResponseFormat.write(DataSourceResponse.fromDomain(ds))))
        })

      // ── dataType (no create — design.md D1) ───────────────────────────
      case ResolvedAction.DataTypeUpdate(id, request, _) =>
        services.dataTypeService.update(id, request, user).map(_.map { dt =>
          edit.toOutcome("applied", resultingState = Some(dataTypeResponseFormat.write(DataTypeResponse.fromDomain(dt))))
        })
      case ResolvedAction.DataTypeDelete(id, _) =>
        services.dataTypeService.delete(id, user).map(_.map(_ => edit.toOutcome("applied")))

      // ── pipeline ───────────────────────────────────────────────────────
      case ResolvedAction.PipelineUpdate(id, request, _) =>
        services.pipelineService.updateName(id, request, user).map(_.map { summary =>
          edit.toOutcome("applied", resultingState = Some(pipelineSummaryResponseFormat.write(summary)))
        })
      case ResolvedAction.PipelineDelete(id, _) =>
        services.pipelineService.delete(id, user).map(_.map(_ => edit.toOutcome("applied")))
      case ResolvedAction.PipelineCreate(request) =>
        services.pipelineService.create(request, user).map(_.map { summary =>
          edit.toOutcome("applied", newId = Some(summary.id), resultingState = Some(pipelineSummaryResponseFormat.write(summary)))
        })

      // ── pipelineStep (no create — design.md D1) ───────────────────────
      case ResolvedAction.PipelineStepUpdate(id, request, _) =>
        services.pipelineService.updateStep(id, request, user).map(_.map { step =>
          edit.toOutcome("applied", resultingState = Some(pipelineStepResponseFormat.write(step)))
        })
      case ResolvedAction.PipelineStepDelete(id, _) =>
        services.pipelineService.deleteStep(id, user).map(_.map(_ => edit.toOutcome("applied")))
    }
}
