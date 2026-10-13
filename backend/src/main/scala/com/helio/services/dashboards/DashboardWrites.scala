package com.helio.services.dashboards

import com.helio.services.ServiceError
import com.helio.domain.model._
import com.helio.infrastructure.persistence.dashboards.{DashboardRepository, DashboardWriteResult, LayoutCas}
import com.helio.services.panels.{LayoutCasRetry, LayoutPolicy, LayoutWritePolicy}
import com.helio.services.panels.LayoutCasRetry.Attempt

import DashboardWrites.Fields

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

  /** Applies `fields` to the dashboard `existing` was read from. Only the supplied fields are stored (HEL-1457), so a
   *  layout save never rewrites a concurrent rename or appearance change; a supplied layout is a compare-and-set
   *  against the layout version it was resolved from, see [[LayoutCasRetry]]. */
  def applyUpdate(
      dashboardId: DashboardId,
      existing: Dashboard,
      fields: Fields,
      layoutPolicy: LayoutWritePolicy
  ): Future[Either[ServiceError, Dashboard]] =
    LayoutCasRetry.run(existing, fields.expectedLayoutVersion) { read =>
      // HEL-1456 D5: every layout this write can store, the supplied breakpoints AND the stored ones it
      // writes back, is first restricted to the dashboard's live panels, so no update of any kind stores an
      // item for a panel that is not on the dashboard.
      dashboardRepo.panelIdsInternal(dashboardId).flatMap { panelIds =>
        // HEL-1071: resolve (and, under `Validate`, validate) the layout BEFORE any write, including the
        // rename, so a rejected layout saves nothing.
        val (liveLayout, layoutResolved) = LayoutPolicy.resolveOnLive(read.layout, fields.layoutPatch, panelIds, layoutPolicy)
        layoutResolved match {
          case Left(msg) => Future.successful(Attempt.Finished(Left(ServiceError.BadRequest(msg))))
          case Right(layoutOpt) =>
            // An appearance update that supplies no layout still drops stored ghost items (HEL-1456 D5), as a
            // compare-and-set like any layout write; a rename-only update never touches the layout.
            val written = layoutOpt.orElse(Option.when(fields.appearance.isDefined && liveLayout != read.layout)(liveLayout))
            val cas     = written.map(LayoutCas(read.layoutVersion, _))
            dashboardRepo.writeFields(dashboardId, read.ownerId, cas, fields.name, fields.appearance, Instant.now()).map {
              case DashboardWriteResult.Written(d)      => Attempt.Finished(Right(d))
              case DashboardWriteResult.NotFound        => Attempt.Finished(Left(ServiceError.NotFound("Dashboard not found")))
              case DashboardWriteResult.LayoutMoved(d)  => Attempt.Moved(d)
            }
        }
      }
    }
}

private[dashboards] object DashboardWrites {

  /** The validated fields of one dashboard update; `expectedLayoutVersion` is only ever set with `layoutPatch`. */
  final case class Fields(
      name: Option[String],
      appearance: Option[DashboardAppearance],
      layoutPatch: Option[LayoutPolicy.Patch],
      expectedLayoutVersion: Option[Long]
  )
}
