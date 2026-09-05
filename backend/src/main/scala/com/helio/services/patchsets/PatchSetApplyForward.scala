package com.helio.services.patchsets

import com.helio.services.dashboards.DashboardService
import com.helio.services.ServiceError
import com.helio.api.protocols.dashboards.DashboardResponse
import com.helio.api.protocols.sources.DataSourceResponse
import com.helio.api.protocols.patchsets.EditOutcome
import com.helio.api.protocols.panels.PanelResponse
import com.helio.domain.model.AuthenticatedUser
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

      case ResolvedAction.PanelUpdate(id, request, _) =>
        services.panelService.update(id, request, user).map(_.map { panel =>
          edit.toOutcome("applied", resultingState = Some(panelResponseFormat.write(PanelResponse.fromDomain(panel))))
        })
      case ResolvedAction.PanelDelete(id, _) =>
        services.panelService.delete(id, user).map(_.map(_ => edit.toOutcome("applied")))
      case ResolvedAction.PanelCreate(request) =>
        services.panelService.create(request, user).map(_.map { case (panel, _) =>
          edit.toOutcome("applied", newId = Some(panel.id.value), resultingState = Some(panelResponseFormat.write(PanelResponse.fromDomain(panel))))
        })

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

      case ResolvedAction.DataSourceUpdate(id, request, _) =>
        services.dataSourceService.update(id, request, user).map(_.map { ds =>
          edit.toOutcome("applied", resultingState = Some(dataSourceResponseFormat.write(DataSourceResponse.fromDomain(ds))))
        })
      case ResolvedAction.DataSourceDelete(id, _) =>
        // HEL-987: `.delete` now returns `Either[DataSourceDeleteError, Unit]` (the 409-conflict
        // wrapper) -- `.err` is the plain `ServiceError` this method's own return type carries;
        // a blocked (sole-root) delete surfaces here as the same `Conflict` `ServiceError` it
        // always would have, patch-set apply has no notion of the extra structured fields.
        services.dataSourceService.delete(id, user).map(_.left.map(_.err)).map(_.map(_ => edit.toOutcome("applied")))
      case ResolvedAction.DataSourceCreate(request) =>
        services.dataSourceService.createStatic(request, user).map(_.map { ds =>
          edit.toOutcome("applied", newId = Some(ds.id.value), resultingState = Some(dataSourceResponseFormat.write(DataSourceResponse.fromDomain(ds))))
        })

      // HEL-904 task 3.3: the `dataType` ResolvedAction cases (update/delete)
      // are REMOVED outright -- `PatchSetProtocol.recognizedKinds` no longer
      // accepts "dataType" as a valid target.kind, so `PatchSetApplyResolvers`
      // can never produce one of these actions for forward-apply to handle.

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

      // ── pipelineStep (HEL-914 task 5.2: create added) ─────────────────
      case ResolvedAction.PipelineStepUpdate(id, request, _) =>
        services.pipelineService.updateStep(id, request, user).map(_.map { step =>
          edit.toOutcome("applied", resultingState = Some(pipelineStepResponseFormat.write(step)))
        })
      case ResolvedAction.PipelineStepDelete(id, _) =>
        services.pipelineService.deleteStep(id, user).map(_.map(_ => edit.toOutcome("applied")))
      case ResolvedAction.PipelineStepCreate(pipelineId, request) =>
        services.pipelineService.addStep(pipelineId, request, user).map(_.map { step =>
          edit.toOutcome("applied", newId = Some(step.id), resultingState = Some(pipelineStepResponseFormat.write(step)))
        })

      // ── output (HEL-907 task 1.2 — no create, see PatchSetProtocol's doc) ─
      case ResolvedAction.OutputUpdate(id, request, _, _) =>
        services.outputService.update(id, request, user).map(_.map { case (output, config) =>
          edit.toOutcome("applied", resultingState = Some(outputResponseFormat.write(outputResponseFrom(output, config))))
        })
      case ResolvedAction.OutputDelete(id, _) =>
        services.outputService.delete(id, user).map(_.map(_ => edit.toOutcome("applied")))
    }
}
