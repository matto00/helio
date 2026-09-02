package com.helio.services.panels

import com.helio.services.auth.AccessChecker
import com.helio.services.ServiceError
import com.helio.services.audit.AuditService
import com.helio.api.protocols.dashboards.AutoLayoutRequest
import com.helio.domain.model.{AuditSource, AuthenticatedUser, Dashboard, DashboardId, DashboardLayout, PanelId, Page, ResourceAccess}
import com.helio.infrastructure.persistence.dashboards.DashboardRepository
import com.helio.infrastructure.persistence.panels.PanelRepository
import com.helio.services.panels.PanelPacker
import com.helio.services.panels.PanelPacker.PackInput
import spray.json.JsObject

import java.time.Instant
import scala.concurrent.{ExecutionContext, Future}

/** `POST /api/dashboards/:id/auto-layout` (HEL-367) — packs caller-supplied
 *  `{panelId, w, h}` sizes into non-overlapping `{x,y,w,h}` positions on a
 *  `cols`-wide grid (default 12) and persists them.
 *
 *  Composes [[PanelPacker]] (pure geometry, design.md Goals) with the same
 *  ACL + persistence pattern [[DashboardContentsService]] uses:
 *  `dashboardRepo.findById` for the sharing-aware existence/ACL check, then
 *  `dashboardRepo.update` for the write (the same path `DashboardService`'s
 *  PATCH uses for `layoutOpt` — see design.md D1/task 2.1).
 *
 *  design.md D6: panels on the dashboard but absent from the request keep
 *  their current `layout.lg` position verbatim; the newly packed items are
 *  appended alongside them with NO collision avoidance against the kept
 *  positions (the packer has no visibility into where kept items sit — a
 *  documented simplification, not a bug; see design.md Risks and the
 *  ticket's own acceptance criterion). A request `panelId` that isn't one of
 *  the dashboard's panels rejects the WHOLE request with 400 and persists
 *  nothing (design.md D6, mirrors `DashboardContentsService.validatePanels`'s
 *  fail-on-first-bad-item convention).
 *
 *  HEL-909 cycle-3 fix: `lg` is packed at the request's `cols` width, but
 *  `md`/`sm`/`xs` have their OWN, narrower column counts
 *  (`LayoutBreakpointScaling.breakpointCols`) — writing the `lg` array
 *  verbatim into those breakpoints (the original behavior here) produced
 *  the same unscaled-copy defect `PanelService.placeDefaultLayout` was
 *  fixed for in cycle 2. `md`/`sm`/`xs` are now each independently derived
 *  via `LayoutBreakpointScaling.scaleItemsToBreakpoint` from the packed
 *  `lg` items. */
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
    authorizeEditor(dashboardId, user).flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(existing) =>
        request.cols.getOrElse(DefaultCols) match {
          case cols if cols < 1 =>
            Future.successful(Left(ServiceError.BadRequest("cols must be a positive integer")))
          case cols => applyAutoLayout(dashboardId, existing, request, cols, user)
        }
    }

  private def applyAutoLayout(
      dashboardId: DashboardId,
      existing: Dashboard,
      request: AutoLayoutRequest,
      cols: Int,
      user: AuthenticatedUser
  ): Future[Either[ServiceError, Dashboard]] =
    // MaxLimit-capped (Page.MaxLimit = 500): the same pagination ceiling
    // every other dashboard-scoped panel listing in this codebase uses
    // (e.g. PublicDashboardRoutes). A dashboard with more than 500 panels
    // would see panels beyond that cap treated as "unknown" if referenced —
    // an existing, not new, limitation.
    panelRepo.findAllByDashboardId(dashboardId, Some(user), Page(offset = 0, limit = Page.MaxLimit)).map { paged =>
      val kindByPanelId = paged.items.map(p => p.id -> p.kind).toMap
      val requestedIds  = request.items.map(item => PanelId(item.panelId))

      requestedIds.find(id => !kindByPanelId.contains(id)) match {
        case Some(unknown) =>
          Left(ServiceError.BadRequest(s"Panel '${unknown.value}' does not belong to this dashboard"))
        case None =>
          val packInputs = request.items.map { item =>
            val panelId = PanelId(item.panelId)
            PackInput(panelId, kindByPanelId(panelId), item.w, item.h)
          }
          val packed = PanelPacker.pack(packInputs, cols)

          val requestedSet = requestedIds.toSet
          val kept         = existing.layout.lg.filterNot(item => requestedSet.contains(item.panelId))
          val items        = kept ++ packed

          val now     = Instant.now()
          val md      = LayoutBreakpointScaling.scaleItemsToBreakpoint(items, cols, LayoutBreakpointScaling.breakpointCols("md"))
          val sm      = LayoutBreakpointScaling.scaleItemsToBreakpoint(items, cols, LayoutBreakpointScaling.breakpointCols("sm"))
          val xs      = LayoutBreakpointScaling.scaleItemsToBreakpoint(items, cols, LayoutBreakpointScaling.breakpointCols("xs"))
          val updated = existing.copy(
            layout = DashboardLayout(lg = items, md = md, sm = sm, xs = xs),
            meta   = existing.meta.copy(lastUpdated = now)
          )
          Right(updated)
      }
    }.flatMap {
      case Left(err) => Future.successful(Left(err))
      case Right(updated) =>
        dashboardRepo.update(updated).map {
          case Some(d) =>
            // HEL-477 design.md Decision 9: reuses dashboard.update — layout
            // is a dashboard-owned field, not a distinct resource.
            audit("dashboard.update", Some(dashboardId.value), user)
            Right(d)
          case None    => Left(ServiceError.NotFound("Dashboard not found"))
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
