package com.helio.services.dashboards

import com.helio.services.ServiceError
import com.helio.api.protocols.dashboards.DashboardLayoutPatchPayload
import com.helio.domain.model._
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.services.dashboards.DashboardServiceValidation._
import com.helio.services.panels.LayoutPolicy
import spray.json._

import scala.concurrent.{ExecutionContext, Future}

/** The post-ownership tail of `DashboardService.repairLayout` (HEL-1233), split out of
 *  `DashboardService` (HEL-1234): payload validation, the pure [[DashboardLayoutRepair]] plan, the
 *  compare-and-set layout write, the audit and the re-read. The 404 / owner-only 403 preamble stays
 *  in `DashboardService`; `audit` is `DashboardService`'s own (a no-op when no `AuditService` is
 *  wired). */
private[dashboards] final class DashboardLayoutRepairWrite(
    dashboardRepo: DashboardRepository,
    audit:         (String, Option[String], AuthenticatedUser, JsValue) => Unit
)(implicit ec: ExecutionContext) {

  def repairOwned(
      dashboardId: DashboardId,
      existing: Dashboard,
      patchPayload: DashboardLayoutPatchPayload,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Dashboard]] =
    validateDashboardLayoutPayload(Some(patchPayload)) match {
      case Left(msg)            => Future.successful(Left(ServiceError.BadRequest(msg)))
      case Right(None)          => Future.successful(Right(existing))
      case Right(Some(patch)) =>
        dashboardRepo.panelIdsInternal(dashboardId).flatMap { panelIds =>
          DashboardLayoutRepair.plan(existing.layout, patch, panelIds) match {
            case Left(msg)                      => Future.successful(Left(ServiceError.BadRequest(msg)))
            case Right(toWrite) if toWrite.isEmpty => Future.successful(Right(existing))
            case Right(toWrite) =>
              val next = LayoutPolicy.applyUnvalidated(existing.layout, toWrite)
              dashboardRepo.updateLayoutIfUnchanged(dashboardId, user.id, existing.layout, next).flatMap {
                case false =>
                  Future.successful(Left(ServiceError.Conflict("Dashboard layout changed; repair not applied")))
                case true =>
                  audit(
                    "dashboard.layout.repair",
                    Some(dashboardId.value),
                    user,
                    JsObject("breakpoints" -> JsArray(LayoutPolicy.Breakpoints.filter(toWrite.get(_).isDefined).map(JsString(_))))
                  )
                  dashboardRepo.findByIdInternal(dashboardId).map {
                    case Some(updated) => Right(updated)
                    case None          => Left(ServiceError.NotFound("Dashboard not found"))
                  }
              }
          }
        }
    }
}
