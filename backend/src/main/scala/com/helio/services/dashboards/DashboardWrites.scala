package com.helio.services.dashboards

import com.helio.services.ServiceError
import com.helio.domain.model._
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.services.panels.{LayoutPolicy, LayoutWritePolicy}

import java.time.Instant
import java.util.UUID
import scala.concurrent.{ExecutionContext, Future}

/** The write bodies of `DashboardService.create` / `update`, split out of `DashboardService`
 *  (HEL-1234). Every ACL / `Forbidden` / 404 preamble and every audit call stays in
 *  `DashboardService`. */
private[dashboards] final class DashboardWrites(
    dashboardRepo: DashboardRepository
)(implicit ec: ExecutionContext) {

  def insertNew(name: String, tag: Option[String], user: AuthenticatedUser): Future[Dashboard] = {
    val now = Instant.now()
    val dashboard = Dashboard(
      id         = DashboardId(UUID.randomUUID().toString),
      name       = name,
      meta       = ResourceMeta(createdBy = user.id.value, createdAt = now, lastUpdated = now),
      appearance = DashboardAppearance.Default,
      layout     = DashboardLayout.Default,
      ownerId    = user.id,
      // HEL-907 evaluator-1 CR3: free-form grouping tag (HEL-366's existing
      // convention), set only at create time -- no update path, mirroring
      // DataSource/Pipeline's own tag.
      tag        = tag
    )
    dashboardRepo.insert(dashboard)
  }

  def applyUpdate(
      dashboardId: DashboardId,
      existing: Dashboard,
      nameOpt: Option[String],
      appearanceOpt: Option[DashboardAppearance],
      layoutPatchOpt: Option[LayoutPolicy.Patch],
      layoutPolicy: LayoutWritePolicy
  ): Future[Either[ServiceError, Dashboard]] =
    // HEL-1456 D5: every layout this write can store, the supplied breakpoints AND the stored ones it
    // writes back (the full layout column is rewritten), is first restricted to the dashboard's live
    // panels, so no update of any kind stores an item for a panel that is not on the dashboard.
    dashboardRepo.panelIdsInternal(dashboardId).flatMap { panelIds =>
      val live = existing.copy(layout = LayoutPolicy.onlyPanels(existing.layout, panelIds))
      // HEL-1071: resolve (and, under `Validate`, validate) the layout BEFORE any write — including
      // the rename below — so a rejected layout saves nothing.
      val layoutResolved: Either[String, Option[DashboardLayout]] = layoutPatchOpt.map(LayoutPolicy.onlyPanels(_, panelIds)) match {
        case None => Right(None)
        case Some(patch) =>
          layoutPolicy match {
            case LayoutWritePolicy.Validate           => LayoutPolicy(live.layout, patch).map(Some(_))
            case LayoutWritePolicy.RestorePriorStored => Right(Some(LayoutPolicy.applyUnvalidated(live.layout, patch)))
          }
      }
      layoutResolved match {
        case Left(msg)        => Future.successful(Left(ServiceError.BadRequest(msg)))
        case Right(layoutOpt) => writeUpdate(dashboardId, live, nameOpt, appearanceOpt, layoutOpt, panelIds)
      }
    }

  private def writeUpdate(
      dashboardId: DashboardId,
      existing: Dashboard,
      nameOpt: Option[String],
      appearanceOpt: Option[DashboardAppearance],
      layoutOpt: Option[DashboardLayout],
      panelIds: Set[PanelId]
  ): Future[Either[ServiceError, Dashboard]] = {
    val now = Instant.now()
    nameOpt match {
      case Some(name) =>
        dashboardRepo.updateName(dashboardId, name, now).flatMap {
          case None => Future.successful(Left(ServiceError.NotFound("Dashboard not found")))
          case Some(renamed) =>
            if (appearanceOpt.isEmpty && layoutOpt.isEmpty) {
              Future.successful(Right(renamed))
            } else {
              val updated = renamed.copy(
                appearance = appearanceOpt.getOrElse(renamed.appearance),
                layout     = layoutOpt.getOrElse(LayoutPolicy.onlyPanels(renamed.layout, panelIds)),
                meta       = renamed.meta.copy(lastUpdated = now)
              )
              dashboardRepo.update(updated).map {
                case Some(d) => Right(d)
                case None    => Left(ServiceError.NotFound("Dashboard not found"))
              }
            }
        }
      case None =>
        val updated = existing.copy(
          appearance = appearanceOpt.getOrElse(existing.appearance),
          layout     = layoutOpt.getOrElse(existing.layout),
          meta       = existing.meta.copy(lastUpdated = now)
        )
        dashboardRepo.update(updated).map {
          case Some(d) => Right(d)
          case None    => Left(ServiceError.NotFound("Dashboard not found"))
        }
    }
  }
}
