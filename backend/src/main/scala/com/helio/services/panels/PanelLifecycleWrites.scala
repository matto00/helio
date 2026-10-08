package com.helio.services.panels

import com.helio.services.ServiceError
import com.helio.api.protocols.panels.CreatePanelRequest
import com.helio.domain.model._
import com.helio.domain.panels._
import com.helio.infrastructure.persistence.panels.PanelRepository
import spray.json._

import scala.concurrent.{ExecutionContext, Future}

/** The post-ACL write tails of `PanelService.create` / `delete` / `duplicate`, split out of
 *  `PanelService`. Every `requireAccess` / `Forbidden` / 404 preamble stays in `PanelService`;
 *  `auditFn` is `PanelService`'s own (a no-op when no `AuditService` is wired). */
private[panels] final class PanelLifecycleWrites(
    panelRepo:     PanelRepository,
    bindingChecks: PanelBindingChecks,
    createBuilder: PanelCreateBuilder,
    auditFn:       (String, Option[String], AuthenticatedUser, JsValue) => Unit
)(implicit ec: ExecutionContext) {

  import bindingChecks._
  import createBuilder._

  /** Same default-metadata convention as `PanelService.audit`. */
  private def audit(action: String, resourceId: Option[String], user: AuthenticatedUser, metadata: JsValue = JsObject.empty): Unit =
    auditFn(action, resourceId, user, metadata)

  def createPlaced(
      dashboardId: DashboardId,
      request: CreatePanelRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, (Panel, PlacedLayouts)]] =
    buildForCreate(dashboardId, request, user).flatMap {
      case Left(err)    => Future.successful(Left(err))
      case Right(panel) =>
        defaultSizesFor(panel).flatMap(sizes => panelRepo.insertPlaced(panel, sizes)).map {
          case None         => Left(ServiceError.NotFound("Dashboard not found"))
          case Some(placed) =>
            audit("panel.create", Some(panel.id.value), user)
            Right((panel, placed))
        }
    }

  def deleteRow(panelId: PanelId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]] =
    panelRepo.delete(panelId).map {
      case true  =>
        audit("panel.delete", Some(panelId.value), user)
        Right(())
      case false => Left(ServiceError.NotFound("Panel not found"))
    }

  def duplicatePlaced(panel: Panel, panelId: PanelId, user: AuthenticatedUser): Future[Either[ServiceError, (Panel, PlacedLayouts)]] =
    defaultSizesFor(panel).flatMap(kindDefault => panelRepo.duplicate(panelId, user.id, kindDefault)).map {
      case Some((p, placed)) =>
        // HEL-477 design.md Decision 7: one panel.duplicate row.
        audit("panel.duplicate", Some(p.id.value), user, JsObject("sourcePanelId" -> JsString(panelId.value)))
        Right((p, placed))
      case None => Left(ServiceError.NotFound("Panel not found"))
    }
}
