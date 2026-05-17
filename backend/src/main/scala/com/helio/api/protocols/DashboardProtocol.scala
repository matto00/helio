package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import com.helio.domain.panels._
import spray.json._

// ── Dashboard request / response types ───────────────────────────────────────

final case class DashboardAppearancePayload(background: Option[String], gridBackground: Option[String])
final case class DashboardLayoutItemPayload(panelId: String, x: Int, y: Int, w: Int, h: Int)
final case class DashboardLayoutPayload(
    lg: Vector[DashboardLayoutItemPayload],
    md: Vector[DashboardLayoutItemPayload],
    sm: Vector[DashboardLayoutItemPayload],
    xs: Vector[DashboardLayoutItemPayload]
)
final case class DashboardAppearanceResponse(background: String, gridBackground: String)
final case class DashboardLayoutItemResponse(panelId: String, x: Int, y: Int, w: Int, h: Int)
final case class DashboardLayoutResponse(
    lg: Vector[DashboardLayoutItemResponse],
    md: Vector[DashboardLayoutItemResponse],
    sm: Vector[DashboardLayoutItemResponse],
    xs: Vector[DashboardLayoutItemResponse]
)
final case class DashboardResponse(
    id: String,
    name: String,
    meta: ResourceMetaResponse,
    appearance: DashboardAppearanceResponse,
    layout: DashboardLayoutResponse,
    ownerId: String
)
final case class DashboardsResponse(items: Vector[DashboardResponse])
final case class DuplicateDashboardResponse(dashboard: DashboardResponse, panels: Vector[PanelResponse])
final case class CreateDashboardRequest(name: Option[String])
final case class UpdateDashboardRequest(
    name: Option[String],
    appearance: Option[DashboardAppearancePayload],
    layout: Option[DashboardLayoutPayload]
)
final case class UpdateDashboardBatchRequest(fields: Vector[String], dashboard: UpdateDashboardRequest)

// ── Snapshot API types ───────────────────────────────────────────────────────

/** Snapshot panel entry (CS2c-3c discriminated wire shape).
 *
 *  Carries the panel's `type` discriminator and a typed `config` payload
 *  whose shape is determined by `type` (mirroring [[PanelResponse]]).
 *  Per-subtype flat fields at the entry root are gone — the importer
 *  reconstructs the typed config via [[PanelConfigCodec.decodeCreateConfig]].
 *
 *  CS2c-3c also closes the pre-existing Image / Divider data-loss bug —
 *  those subtypes' config fields now survive export → import round-trips. */
final case class DashboardSnapshotPanelEntry(
    snapshotId: String,
    title: String,
    `type`: String,
    appearance: PanelAppearancePayload,
    config: JsValue
)
final case class DashboardSnapshotDashboardEntry(
    name: String,
    appearance: DashboardAppearancePayload,
    layout: DashboardLayoutPayload
)
final case class DashboardSnapshotPayload(
    version: Int,
    dashboard: DashboardSnapshotDashboardEntry,
    panels: Vector[DashboardSnapshotPanelEntry]
)

object DashboardResponse {
  def fromDomain(dashboard: Dashboard): DashboardResponse =
    DashboardResponse(
      id         = dashboard.id.value,
      name       = dashboard.name,
      meta       = ResourceMetaResponse.fromDomain(dashboard.meta),
      appearance = DashboardAppearanceResponse.fromDomain(dashboard.appearance),
      layout     = DashboardLayoutResponse.fromDomain(dashboard.layout),
      ownerId    = dashboard.ownerId.value
    )
}

object DashboardAppearanceResponse {
  def fromDomain(appearance: DashboardAppearance): DashboardAppearanceResponse =
    DashboardAppearanceResponse(
      background     = appearance.background,
      gridBackground = appearance.gridBackground
    )
}

object DashboardLayoutItemPayload {
  def toDomain(item: DashboardLayoutItemPayload): DashboardLayoutItem =
    DashboardLayoutItem(
      panelId = PanelId(item.panelId),
      x       = item.x,
      y       = item.y,
      w       = item.w,
      h       = item.h
    )
}

object DashboardLayoutPayload {
  def toDomain(layout: DashboardLayoutPayload): DashboardLayout =
    DashboardLayout(
      lg = layout.lg.map(DashboardLayoutItemPayload.toDomain),
      md = layout.md.map(DashboardLayoutItemPayload.toDomain),
      sm = layout.sm.map(DashboardLayoutItemPayload.toDomain),
      xs = layout.xs.map(DashboardLayoutItemPayload.toDomain)
    )
}

object DashboardLayoutItemResponse {
  def fromDomain(item: DashboardLayoutItem): DashboardLayoutItemResponse =
    DashboardLayoutItemResponse(
      panelId = item.panelId.value,
      x       = item.x,
      y       = item.y,
      w       = item.w,
      h       = item.h
    )
}

object DashboardLayoutResponse {
  def fromDomain(layout: DashboardLayout): DashboardLayoutResponse =
    DashboardLayoutResponse(
      lg = layout.lg.map(DashboardLayoutItemResponse.fromDomain),
      md = layout.md.map(DashboardLayoutItemResponse.fromDomain),
      sm = layout.sm.map(DashboardLayoutItemResponse.fromDomain),
      xs = layout.xs.map(DashboardLayoutItemResponse.fromDomain)
    )
}

object DashboardSnapshotPanelEntry {
  /** Build a discriminated-wire snapshot entry from the typed `Panel` ADT.
   *
   *  CS2c-3c collapses the prior wide-flat shape to `type` + typed `config`,
   *  delegating the per-subtype payload to [[PanelConfigCodec.encodeConfig]].
   *  Image and Divider config fields now round-trip (closing the pre-existing
   *  data-loss bug — the prior flat shape omitted them from the snapshot). */
  def fromDomain(panel: Panel): DashboardSnapshotPanelEntry =
    DashboardSnapshotPanelEntry(
      snapshotId = panel.id.value,
      title      = panel.title,
      `type`     = panel.kind,
      appearance = PanelAppearancePayload(
        background   = Some(panel.appearance.background),
        color        = Some(panel.appearance.color),
        transparency = Some(panel.appearance.transparency),
        chart        = panel.appearance.chart
      ),
      config = PanelConfigCodec.encodeConfig(panel)
    )
}

object DashboardSnapshotPayload {

  /** CS2c-3c snapshot wire version. Bumped from `1` because the panel-entry
   *  wire shape collapsed to `type` + typed `config`. Importer rejects any
   *  other version with HTTP 400 per design.md D3. */
  val CurrentVersion: Int = 2
}

/** `DashboardProtocol extends PanelProtocol` is the single inter-trait
 *  dependency in this split: `DashboardSnapshotPanelEntry` carries a
 *  `PanelAppearancePayload`, so its format needs `panelAppearancePayloadFormat`
 *  in implicit scope. Likewise `DuplicateDashboardResponse` needs
 *  `panelResponseFormat`. Mixing in `PanelProtocol` here makes those
 *  available at trait-resolution time. */
trait DashboardProtocol extends SprayJsonSupport with DefaultJsonProtocol with PanelProtocol {
  // Domain helpers used by dashboard JSON blobs
  implicit val dashboardAppearanceFormat: RootJsonFormat[DashboardAppearance] = jsonFormat2(DashboardAppearance.apply)
  implicit val dashboardLayoutItemFormat: RootJsonFormat[DashboardLayoutItem] = jsonFormat5(DashboardLayoutItem.apply)
  implicit val dashboardLayoutFormat: RootJsonFormat[DashboardLayout]         = jsonFormat4(DashboardLayout.apply)

  // Dashboard request / response formats
  implicit val dashboardAppearancePayloadFormat: RootJsonFormat[DashboardAppearancePayload]   = jsonFormat2(DashboardAppearancePayload.apply)
  implicit val dashboardLayoutItemPayloadFormat: RootJsonFormat[DashboardLayoutItemPayload]   = jsonFormat5(DashboardLayoutItemPayload.apply)
  implicit val dashboardLayoutPayloadFormat: RootJsonFormat[DashboardLayoutPayload]           = jsonFormat4(DashboardLayoutPayload.apply)
  implicit val dashboardAppearanceResponseFormat: RootJsonFormat[DashboardAppearanceResponse] = jsonFormat2(DashboardAppearanceResponse.apply)
  implicit val dashboardLayoutItemResponseFormat: RootJsonFormat[DashboardLayoutItemResponse] = jsonFormat5(DashboardLayoutItemResponse.apply)
  implicit val dashboardLayoutResponseFormat: RootJsonFormat[DashboardLayoutResponse]         = jsonFormat4(DashboardLayoutResponse.apply)
  implicit val dashboardResponseFormat: RootJsonFormat[DashboardResponse]                     = jsonFormat6(DashboardResponse.apply)
  implicit val dashboardsResponseFormat: RootJsonFormat[DashboardsResponse]                   = jsonFormat1(DashboardsResponse.apply)
  implicit val duplicateDashboardResponseFormat: RootJsonFormat[DuplicateDashboardResponse]   = jsonFormat2(DuplicateDashboardResponse.apply)
  implicit val createDashboardRequestFormat: RootJsonFormat[CreateDashboardRequest]           = jsonFormat1(CreateDashboardRequest.apply)
  implicit val updateDashboardRequestFormat: RootJsonFormat[UpdateDashboardRequest]           = jsonFormat3(UpdateDashboardRequest.apply)
  implicit val updateDashboardBatchRequestFormat: RootJsonFormat[UpdateDashboardBatchRequest] = jsonFormat2(UpdateDashboardBatchRequest.apply)

  // Snapshot formats
  implicit val dashboardSnapshotPanelEntryFormat: RootJsonFormat[DashboardSnapshotPanelEntry]         = jsonFormat5(DashboardSnapshotPanelEntry.apply)
  implicit val dashboardSnapshotDashboardEntryFormat: RootJsonFormat[DashboardSnapshotDashboardEntry] = jsonFormat3(DashboardSnapshotDashboardEntry.apply)
  implicit val dashboardSnapshotPayloadFormat: RootJsonFormat[DashboardSnapshotPayload]               = jsonFormat3(DashboardSnapshotPayload.apply)
}
