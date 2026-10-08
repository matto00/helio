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
  ): Future[Either[ServiceError, Dashboard]] = {
    // HEL-1071: resolve (and, under `Validate`, validate) the layout BEFORE any write — including
    // the rename below — so a rejected layout saves nothing.
    val layoutResolved: Either[String, Option[DashboardLayout]] = layoutPatchOpt match {
      case None => Right(None)
      case Some(patch) =>
        layoutPolicy match {
          case LayoutWritePolicy.Validate           => LayoutPolicy(existing.layout, patch).map(Some(_))
          case LayoutWritePolicy.RestorePriorStored => Right(Some(LayoutPolicy.applyUnvalidated(existing.layout, patch)))
        }
    }
    layoutResolved match {
      case Left(msg)        => Future.successful(Left(ServiceError.BadRequest(msg)))
      case Right(layoutOpt) => writeUpdate(dashboardId, existing, nameOpt, appearanceOpt, layoutOpt)
    }
  }

  private def writeUpdate(
      dashboardId: DashboardId,
      existing: Dashboard,
      nameOpt: Option[String],
      appearanceOpt: Option[DashboardAppearance],
      layoutOpt: Option[DashboardLayout]
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
                layout     = layoutOpt.getOrElse(renamed.layout),
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
