package com.helio.services

import com.helio.api.protocols.{
  DashboardLayoutItemPayload,
  DashboardLayoutPayload,
  DashboardProposal,
  ProposalPanel,
  UpdateDashboardRequest
}
import com.helio.api.protocols.CreatePanelRequest
import com.helio.domain.{AuthenticatedUser, Dashboard, DashboardId, DataTypeId, Panel, PanelType}
import com.helio.infrastructure.DataTypeRepository
import spray.json.{JsObject, JsString, JsValue}

import scala.concurrent.{ExecutionContext, Future}

/** Applies a reviewed dashboard proposal (HEL-225).
 *
 *  Turns a `DashboardProposal` (name + panels, no ids) into a real dashboard by
 *  composing the EXISTING services — `DashboardService.create`,
 *  `PanelService.create`, `DashboardService.update` for layout. It holds no
 *  persistence logic of its own and never touches the DB directly, so every
 *  write runs under the caller's RLS context and the V41 pipeline-only binding
 *  rule is enforced by `PanelService` exactly as for any other panel create.
 *
 *  Atomicity: all panel bindings are validated up front, so a bad proposal
 *  creates nothing. If a later panel create still fails unexpectedly, the
 *  partially-created dashboard is deleted (cascade) before returning the error.
 */
final class DashboardProposalService(
    dashboardService: DashboardService,
    panelService: PanelService,
    dataTypeRepo: DataTypeRepository
)(implicit ec: ExecutionContext) {

  import DashboardProposalService._

  def apply(
      proposal: DashboardProposal,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, (Dashboard, Vector[Panel])]] =
    validateStructure(proposal) match {
      case Left(err) => Future.successful(Left(ServiceError.BadRequest(err)))
      case Right(_) =>
        preValidateBindings(proposal.panels, user).flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_)  => createAll(proposal, user)
        }
    }

  /** Structural validation — no side effects; fails on the first bad panel so a
   *  malformed proposal creates nothing. */
  private def validateStructure(proposal: DashboardProposal): Either[String, Unit] =
    if (proposal.dashboardName.trim.isEmpty) Left("dashboardName is required")
    else
      proposal.panels.zipWithIndex.foldLeft[Either[String, Unit]](Right(())) {
        case (Left(e), _) => Left(e)
        case (Right(_), (panel, idx)) =>
          val where = s"panel ${idx + 1} ('${panel.title}')"
          PanelType.fromString(panel.`type`) match {
            case Left(msg) => Left(s"$where: $msg")
            case Right(_) if panel.title.trim.isEmpty => Left(s"$where: title is required")
            case Right(_) if DataPanelKinds.contains(panel.`type`) && panel.dataTypeId.isEmpty =>
              Left(s"$where: a ${panel.`type`} panel requires a dataTypeId")
            case Right(_) => Right(())
          }
      }

  /** Verify every data panel's `dataTypeId` resolves to a pipeline-output
   *  DataType owned by the caller — the same rule `PanelService` enforces, run
   *  first so nothing is created when a binding is invalid. */
  private def preValidateBindings(
      panels: Vector[ProposalPanel],
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Unit]] =
    panels.foldLeft[Future[Either[ServiceError, Unit]]](Future.successful(Right(()))) {
      (accF, panel) =>
        accF.flatMap {
          case Left(err) => Future.successful(Left(err))
          case Right(_)  => panel.dataTypeId match {
            case None => Future.successful(Right(()))
            case Some(id) =>
              dataTypeRepo.findByIdOwned(DataTypeId(id), user).map {
                case None =>
                  Left(ServiceError.BadRequest(s"panel '${panel.title}': dataType $id not found"))
                case Some(dt) if dt.sourceId.isDefined =>
                  Left(ServiceError.BadRequest(
                    s"panel '${panel.title}': panels can only bind to pipeline-output data types"
                  ))
                case Some(_) => Right(())
              }
          }
        }
    }

  private def createAll(
      proposal: DashboardProposal,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, (Dashboard, Vector[Panel])]] =
    dashboardService.create(DashboardService.CreateDashboardInput(Some(proposal.dashboardName)), user).flatMap {
      dashboard =>
        createPanels(dashboard.id, proposal.panels, user, Vector.empty).flatMap {
          case Left(err) =>
            // Roll back: delete the partially-created dashboard (cascades panels).
            dashboardService.delete(dashboard.id, user).map(_ => Left(err))
          case Right(panels) =>
            applyLayout(dashboard, proposal.panels, panels, user).map(Right(_))
        }
    }

  /** Create panels in proposal order, short-circuiting on the first failure. */
  private def createPanels(
      dashboardId: DashboardId,
      remaining: Vector[ProposalPanel],
      user: AuthenticatedUser,
      acc: Vector[Panel]
  ): Future[Either[ServiceError, Vector[Panel]]] =
    remaining.headOption match {
      case None => Future.successful(Right(acc))
      case Some(panel) =>
        panelService.create(buildCreateRequest(dashboardId, panel), user).flatMap {
          case Left(err)    => Future.successful(Left(err))
          case Right(panel0) => createPanels(dashboardId, remaining.tail, user, acc :+ panel0)
        }
    }

  private def buildCreateRequest(dashboardId: DashboardId, panel: ProposalPanel): CreatePanelRequest = {
    val configOpt: Option[JsValue] = panel.dataTypeId.map { id =>
      val baseFields = Map(
        "dataTypeId"   -> JsString(id),
        "fieldMapping" -> panel.fieldMapping.getOrElse(JsObject.empty)
      )
      JsObject(panel.aggregation.fold(baseFields)(agg => baseFields + ("aggregation" -> agg)))
    }
    CreatePanelRequest(
      dashboardId = Some(dashboardId.value),
      title       = Some(panel.title),
      `type`      = Some(panel.`type`),
      config      = configOpt
    )
  }

  /** Persist per-panel layout (all four breakpoints) for panels that specify
   *  one. Panels without a layout are omitted and the frontend auto-places
   *  them. Returns the updated dashboard (or the original if no layout given). */
  private def applyLayout(
      dashboard: Dashboard,
      proposalPanels: Vector[ProposalPanel],
      createdPanels: Vector[Panel],
      user: AuthenticatedUser
  ): Future[(Dashboard, Vector[Panel])] = {
    val items = proposalPanels.zip(createdPanels).flatMap { case (proposal, created) =>
      proposal.layout.map(l => DashboardLayoutItemPayload(created.id.value, l.x, l.y, l.w, l.h))
    }
    if (items.isEmpty) Future.successful((dashboard, createdPanels))
    else {
      val layout = DashboardLayoutPayload(lg = items, md = items, sm = items, xs = items)
      dashboardService
        .update(dashboard.id, UpdateDashboardRequest(None, None, Some(layout)), user)
        .map {
          case Right(updated) => (updated, createdPanels)
          case Left(_)        => (dashboard, createdPanels) // layout is best-effort; panels already exist
        }
    }
  }
}

object DashboardProposalService {
  private val DataPanelKinds: Set[String] = Set("metric", "chart", "table")
}
