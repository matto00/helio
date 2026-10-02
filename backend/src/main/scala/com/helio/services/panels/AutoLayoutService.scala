package com.helio.services.panels

import com.helio.services.auth.AccessChecker
import com.helio.services.ServiceError
import com.helio.services.audit.AuditService
import com.helio.api.protocols.dashboards.AutoLayoutRequest
import com.helio.domain.model.{AuthenticatedUser, Dashboard, DashboardId, DashboardLayoutItem, PanelId, Page, ResourceAccess}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.services.panels.PanelPacker.PackInput
import spray.json.JsObject

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** The breakpoints to pack and the column count `request.items[].w` is expressed in. */
private final case class Targets(breakpoints: Vector[String], sourceCols: Int)

/** `POST /api/dashboards/:id/auto-layout` (HEL-367, breakpoint-aware since HEL-1071) — packs
 *  caller-supplied `{panelId, w, h}` sizes into non-overlapping `{x,y,w,h}` positions and persists them.
 *
 *  Composes [[PanelPacker]] (pure geometry) with the same ACL + persistence pattern
 *  [[DashboardContentsService]] uses: `dashboardRepo.findById` for the sharing-aware existence/ACL
 *  check, then `dashboardRepo.update` for the write.
 *
 *  Without `breakpoint`, EVERY breakpoint is packed independently at its own column count
 *  (`LayoutBreakpointScaling.breakpointCols`): request `w` is in `cols` units (default 12) and is
 *  scaled to each breakpoint, so xs can never receive a 4-wide item. With `breakpoint`, only that
 *  breakpoint is packed (`w` in its own units, `cols` if supplied must equal its count) and the others
 *  are left untouched. Panels on the dashboard but absent from the request keep their stored position
 *  in each packed breakpoint and the packed items are placed BELOW them, so a packed item never
 *  overlaps a kept one. The result goes through [[LayoutPolicy]] (400, nothing saved, if a packed
 *  breakpoint is invalid, e.g. the kept panels already overlap). A request `panelId` that isn't one of
 *  the dashboard's panels rejects the WHOLE request with 400 and persists nothing. */
final class AutoLayoutService(
    dashboardRepo: DashboardRepository,
    panelRepo: PanelRepository,
    accessChecker: AccessChecker,
    // HEL-477: nullable-optional wiring mirrors the rest of this file's DI.
    auditService: AuditService = null
)(implicit ec: ExecutionContext) {

  private val DefaultCols = 12

  private def audit(action: String, resourceId: Option[String], user: AuthenticatedUser): Unit =
    if (auditService != null)
      auditService.record(Some(user.id), user.tokenId, user.source, action, "dashboard", resourceId, JsObject.empty)

  def autoLayout(
      dashboardId: DashboardId,
      request: AutoLayoutRequest,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Dashboard]] =
    resolveTargets(request) match {
      case Left(msg) => Future.successful(Left(ServiceError.BadRequest(msg)))
      case Right(targets) =>
        authorizeEditor(dashboardId, user).flatMap {
          case Left(err)       => Future.successful(Left(err))
          case Right(existing) => applyAutoLayout(dashboardId, existing, request, targets, user)
        }
    }

  private def resolveTargets(request: AutoLayoutRequest): Either[String, Targets] =
    request.breakpoint match {
      case Some(bp) if !LayoutPolicy.Breakpoints.contains(bp) =>
        Left(s"breakpoint must be one of ${LayoutPolicy.Breakpoints.mkString(", ")}")
      case Some(bp) =>
        val bpCols = LayoutBreakpointScaling.breakpointCols(bp)
        if (request.cols.exists(_ != bpCols)) Left(s"cols must equal $bpCols for breakpoint '$bp'")
        else Right(Targets(Vector(bp), bpCols))
      case None =>
        val cols = request.cols.getOrElse(DefaultCols)
        if (cols < 1) Left("cols must be a positive integer")
        else if (cols > DefaultCols) Left(s"cols must be at most $DefaultCols")
        else Right(Targets(LayoutPolicy.Breakpoints, cols))
    }

  private def applyAutoLayout(
      dashboardId: DashboardId,
      existing: Dashboard,
      request: AutoLayoutRequest,
      targets: Targets,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Dashboard]] =
    // MaxLimit-capped (Page.MaxLimit = 500): the pagination ceiling every dashboard-scoped panel
    // listing uses; panels beyond it would be treated as "unknown" if referenced (pre-existing limit).
    panelRepo.findAllByDashboardId(dashboardId, Some(user), Page(offset = 0, limit = Page.MaxLimit)).map { paged =>
      val kindByPanelId = paged.items.map(p => p.id -> p.kind).toMap
      val requestedIds  = request.items.map(item => PanelId(item.panelId))

      requestedIds.find(id => !kindByPanelId.contains(id)) match {
        case Some(unknown) =>
          Left(ServiceError.BadRequest(s"Panel '${unknown.value}' does not belong to this dashboard"))
        case None =>
          val requestedSet = requestedIds.toSet
          def packedItems(bp: String): Vector[DashboardLayoutItem] = {
            val targetCols = LayoutBreakpointScaling.breakpointCols(bp)
            val inputs = request.items.map { item =>
              val w = math.max(1, math.round(item.w.toDouble * targetCols / targets.sourceCols).toInt)
              PackInput(PanelId(item.panelId), kindByPanelId(PanelId(item.panelId)), w, item.h)
            }
            val kept   = LayoutPolicy.stored(existing.layout, bp).filterNot(i => requestedSet.contains(i.panelId))
            val offset = (kept.map(i => i.y + i.h) :+ 0).max
            kept ++ PanelPacker.pack(inputs, targetCols).map(i => i.copy(y = i.y + offset))
          }
          def patchFor(bp: String): Option[Vector[DashboardLayoutItem]] =
            if (targets.breakpoints.contains(bp)) Some(packedItems(bp)) else None
          val patch = LayoutPolicy.Patch(patchFor("lg"), patchFor("md"), patchFor("sm"), patchFor("xs"))
          LayoutPolicy(existing.layout, patch) match {
            case Left(msg) => Left(ServiceError.BadRequest(msg))
            case Right(layout) =>
              Right(existing.copy(layout = layout, meta = existing.meta.copy(lastUpdated = Instant.now())))
          }
      }
    }.flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(updated) =>
        dashboardRepo.update(updated).map {
          case Some(d) =>
            // HEL-477 design.md Decision 9: reuses dashboard.update — layout is a dashboard-owned field.
            audit("dashboard.update", Some(dashboardId.value), user)
            Right(d)
          case None => Left(ServiceError.NotFound("Dashboard not found"))
        }
    }

  /** Owner or editor grantee may auto-layout — mirrors
   *  `DashboardContentsService.authorizeEditor` exactly: sharing-aware
   *  `dashboardRepo.findById` first (no existence leak on `None`), role
   *  check only for a known non-owner grantee (Viewer -> 403, Editor ->
   *  proceed). Returns the existing dashboard on success so the caller
   *  doesn't need a second lookup for `layout.lg` (design.md D6's kept-item
   *  source). */
  private def authorizeEditor(dashboardId: DashboardId, user: AuthenticatedUser): Future[Either[ServiceError, Dashboard]] =
    dashboardRepo.findById(dashboardId, Some(user)).flatMap {
      case None =>
        Future.successful(Left(ServiceError.NotFound("Dashboard not found")))
      case Some(existing) if existing.ownerId == user.id =>
        Future.successful(Right(existing))
      case Some(existing) =>
        accessChecker.requireAccess("dashboard", dashboardId.value, Some(user), "Dashboard not found").map {
          case Left(err)                    => Left(err)
          case Right(ResourceAccess.Viewer) => Left(ServiceError.Forbidden())
          case Right(_)                     => Right(existing)
        }
    }
}
