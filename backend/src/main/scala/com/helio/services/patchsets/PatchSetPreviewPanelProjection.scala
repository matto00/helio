package com.helio.services.patchsets

import com.helio.services.panels.PanelServiceHelpers
import com.helio.services.ServiceError
import com.helio.api.http.RequestValidation
import com.helio.api.protocols.panels.{CreatePanelRequest, PanelResponse, UpdatePanelRequest}
import com.helio.domain.model._
import com.helio.domain.panels._
import PatchSetApplyServiceJson._
import spray.json._

import java.time.Instant

/** Pure after-state projections for panel edits, split out of `PatchSetPreviewProjection`
 *  (HEL-1498; behaviour-preserving). See that object for the shared contract. */
private[patchsets] object PatchSetPreviewPanelProjection {

  /** The projected `after` JSON and the projected panel (stored in the overlay for later edits). */
  private[patchsets] def panelUpdateAfter(request: UpdatePanelRequest, prior: Panel): Either[ServiceError, (JsValue, Panel)] =
    PanelServiceHelpers.resolvePatch(request, prior) match {
      case Left(err) => Left(ServiceError.BadRequest(err))
      case Right(spec) =>
        // HEL-904: the `validateScatterAggregationConflict` gate here was
        // removed along with `ChartPanel` — Outputs carry no panel-side
        // `aggregation` field to conflict with a chart type.
        val titled = withTitleAndAppearance(prior, spec.trimmedTitle, spec.appearance)
        val configured: Either[String, Panel] = spec.configPatch match {
          case None      => Right(titled)
          case Some(cfg) => PanelConfigCodec.applyConfigPatch(titled, cfg)
        }
        configured match {
          case Left(err)    => Left(ServiceError.BadRequest(err))
          case Right(panel) => Right((panelResponseFormat.write(PanelResponse.fromDomain(panel)), panel))
        }
    }

  /** design.md D3's create-side builder reuse -- every field here already
   *  round-tripped through `resolveAll`'s own `resolvePanelCreate` (decode
   *  failures already fail the whole `preview` call before this projection
   *  runs), so the `getOrElse` fallbacks below are unreachable in practice,
   *  not a silent second decode. */
  private[patchsets] def panelCreateBuild(request: CreatePanelRequest, user: AuthenticatedUser): Panel = {
    val createConfig = PanelServiceHelpers.resolveCreateConfig(request).getOrElse(
      throw new IllegalStateException("panel create config failed to decode after resolveAll already accepted it")
    )
    val appearance = PanelServiceHelpers.resolveCreateAppearance(request.appearance).getOrElse(PanelAppearance.Default)
    val now = Instant.now()
    PanelServiceHelpers.buildNewPanel(
      id           = PanelId(PatchSetPreviewProjection.PendingId),
      dashboardId  = DashboardId(request.dashboardId.map(_.trim).getOrElse("")),
      title        = RequestValidation.normalizePanelTitle(request.title),
      meta         = ResourceMeta(createdBy = user.id.value, createdAt = now, lastUpdated = now),
      appearance   = appearance,
      ownerId      = user.id,
      createConfig = createConfig
    )
  }

  private[patchsets] def panelCreateAfter(panel: Panel): JsValue =
    panelResponseFormat.write(PanelResponse.fromDomain(panel))

  /** Generic title/appearance `.copy` across the Panel ADT's 9 registered
   *  kinds (mirrors `PanelServiceHelpers.buildNewPanel`'s own 9-arm
   *  dispatch) -- `PanelPatchApplier`'s real title/appearance write steps
   *  (`panelRepo.updateTitle`/`updateAppearance`), replicated in memory. */
  private[patchsets] def withTitleAndAppearance(panel: Panel, title: Option[String], appearance: Option[PanelAppearance]): Panel = {
    def t(existing: String): String = title.getOrElse(existing)
    def a(existing: PanelAppearance): PanelAppearance = appearance.getOrElse(existing)
    panel match {
      case p: TextPanel       => p.copy(title = t(p.title), appearance = a(p.appearance))
      case p: MarkdownPanel   => p.copy(title = t(p.title), appearance = a(p.appearance))
      case p: ImagePanel      => p.copy(title = t(p.title), appearance = a(p.appearance))
      case p: DividerPanel    => p.copy(title = t(p.title), appearance = a(p.appearance))
      case p: OutputPanel     => p.copy(title = t(p.title), appearance = a(p.appearance))
    }
  }
}
