package com.helio.services.patchsets

import com.helio.services.dashboards.DashboardServiceValidation
import com.helio.services.panels.{LayoutPolicy, LayoutWritePolicy}
import com.helio.services.ServiceError
import com.helio.api.http.RequestValidation
import com.helio.api.protocols.dashboards.{CreateDashboardRequest, DashboardResponse, UpdateDashboardRequest}
import com.helio.domain.model._
import PatchSetApplyServiceJson._
import spray.json._

import java.time.Instant

/** Pure after-state projections for dashboard edits, split out of `PatchSetPreviewProjection`
 *  (HEL-1498; behaviour-preserving). See that object for the shared contract. */
private[patchsets] object PatchSetPreviewDashboardProjection {

  /** `base` is the dashboard as earlier edits of the set leave it ([[PatchSetPreviewOverlay.dashboard]]); `storedPanelIds`
   *  are the ids stored at resolve time, adjusted to the overlay's live set. Returns the `after` JSON and the projected
   *  dashboard (stored in the overlay). */
  private[patchsets] def dashboardUpdateAfter(
      request: UpdateDashboardRequest,
      base: Dashboard,
      storedPanelIds: Set[PanelId],
      overlay: PatchSetPreviewOverlay
  ): Either[ServiceError, (JsValue, Dashboard)] =
    DashboardServiceValidation.validateDashboardUpdateRequest(request) match {
      case Left(err) => Left(ServiceError.BadRequest(err))
      case Right((nameOpt, appearanceOpt, layoutPatchOpt)) =>
        // HEL-1457: apply refuses a stale `expectedLayoutVersion` (409) against the layout it resolves the write
        // against, which after earlier edits of the set is the OVERLAY's version, not the resolve-time one.
        if (request.expectedLayoutVersion.exists(_ != base.layoutVersion)) Left(ServiceError.LayoutConflict(base))
        else {
          // HEL-1456 D5 / HEL-1485: the same live-panel layout resolution `DashboardWrites.applyUpdate` runs
          // (shared `LayoutPolicy.resolveOnLive`), so a preview drops ghost items exactly as apply does and 400s only
          // where apply would. A rename-only update returns the stored row, layout unfiltered, like apply's
          // `updateName` branch.
          val panelIds   = overlay.livePanelIds(base.id.value, storedPanelIds)
          val renameOnly = nameOpt.isDefined && appearanceOpt.isEmpty && layoutPatchOpt.isEmpty
          val (liveLayout, layoutResolved) = LayoutPolicy.resolveOnLive(base.layout, layoutPatchOpt, panelIds, LayoutWritePolicy.Validate)
          layoutResolved.left.map(ServiceError.BadRequest(_)).map { patched =>
            // design.md D3's three-field mirror of DashboardService.applyUpdate -- name/appearance/layout only,
            // `meta` deliberately left at `base`'s value (D3's timestamp exclusion). V127 bumps the layout version
            // when, and only when, the stored layout changes.
            val layout  = if (renameOnly) base.layout else patched.getOrElse(liveLayout)
            val updated = base.copy(
              name          = nameOpt.getOrElse(base.name),
              appearance    = appearanceOpt.getOrElse(base.appearance),
              layout        = layout,
              layoutVersion = base.layoutVersion + (if (layout != base.layout) 1 else 0)
            )
            (dashboardResponseFormat.write(DashboardResponse.fromDomain(updated)), updated)
          }
        }
    }

  private[patchsets] def dashboardCreateAfter(request: CreateDashboardRequest, user: AuthenticatedUser): JsValue = {
    val now = Instant.now()
    val dashboard = Dashboard(
      id         = DashboardId(PatchSetPreviewProjection.PendingId),
      name       = RequestValidation.normalizeDashboardName(request.name),
      meta       = ResourceMeta(createdBy = user.id.value, createdAt = now, lastUpdated = now),
      appearance = DashboardAppearance.Default,
      layout     = DashboardLayout.Default,
      ownerId    = user.id
    )
    dashboardResponseFormat.write(DashboardResponse.fromDomain(dashboard))
  }
}
