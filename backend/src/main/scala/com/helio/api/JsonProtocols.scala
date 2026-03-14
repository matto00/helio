package com.helio.api

import akka.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.Dashboard
import com.helio.domain.DashboardAppearance
import com.helio.domain.Panel
import com.helio.domain.PanelAppearance
import com.helio.domain.ResourceMeta
import spray.json.DefaultJsonProtocol
import spray.json.RootJsonFormat

final case class ResourceMetaResponse(createdBy: String, createdAt: String, lastUpdated: String)
final case class DashboardAppearancePayload(background: Option[String], gridBackground: Option[String])
final case class PanelAppearancePayload(background: Option[String], color: Option[String], transparency: Option[Double])
final case class DashboardAppearanceResponse(background: String, gridBackground: String)
final case class PanelAppearanceResponse(background: String, color: String, transparency: Double)
final case class DashboardResponse(
    id: String,
    name: String,
    meta: ResourceMetaResponse,
    appearance: DashboardAppearanceResponse
)
final case class PanelResponse(
    id: String,
    dashboardId: String,
    title: String,
    meta: ResourceMetaResponse,
    appearance: PanelAppearanceResponse
)
final case class DashboardsResponse(items: Vector[DashboardResponse])
final case class PanelsResponse(items: Vector[PanelResponse])
final case class HealthResponse(status: String)
final case class ErrorResponse(message: String)
final case class CreateDashboardRequest(name: Option[String])
final case class CreatePanelRequest(dashboardId: Option[String], title: Option[String])
final case class UpdateDashboardRequest(appearance: Option[DashboardAppearancePayload])
final case class UpdatePanelRequest(appearance: Option[PanelAppearancePayload])

object ResourceMetaResponse {
  def fromDomain(meta: ResourceMeta): ResourceMetaResponse =
    ResourceMetaResponse(
      createdBy = meta.createdBy,
      createdAt = meta.createdAt.toString,
      lastUpdated = meta.lastUpdated.toString
    )
}

object DashboardResponse {
  def fromDomain(dashboard: Dashboard): DashboardResponse =
    DashboardResponse(
      id = dashboard.id.value,
      name = dashboard.name,
      meta = ResourceMetaResponse.fromDomain(dashboard.meta),
      appearance = DashboardAppearanceResponse.fromDomain(dashboard.appearance)
    )
}

object PanelResponse {
  def fromDomain(panel: Panel): PanelResponse =
    PanelResponse(
      id = panel.id.value,
      dashboardId = panel.dashboardId.value,
      title = panel.title,
      meta = ResourceMetaResponse.fromDomain(panel.meta),
      appearance = PanelAppearanceResponse.fromDomain(panel.appearance)
    )
}

object DashboardAppearanceResponse {
  def fromDomain(appearance: DashboardAppearance): DashboardAppearanceResponse =
    DashboardAppearanceResponse(
      background = appearance.background,
      gridBackground = appearance.gridBackground
    )
}

object PanelAppearanceResponse {
  def fromDomain(appearance: PanelAppearance): PanelAppearanceResponse =
    PanelAppearanceResponse(
      background = appearance.background,
      color = appearance.color,
      transparency = appearance.transparency
    )
}

trait JsonProtocols extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val resourceMetaResponseFormat: RootJsonFormat[ResourceMetaResponse] = jsonFormat3(
    ResourceMetaResponse.apply
  )
  implicit val dashboardAppearancePayloadFormat: RootJsonFormat[DashboardAppearancePayload] = jsonFormat2(
    DashboardAppearancePayload.apply
  )
  implicit val panelAppearancePayloadFormat: RootJsonFormat[PanelAppearancePayload] = jsonFormat3(
    PanelAppearancePayload.apply
  )
  implicit val dashboardAppearanceResponseFormat: RootJsonFormat[DashboardAppearanceResponse] = jsonFormat2(
    DashboardAppearanceResponse.apply
  )
  implicit val panelAppearanceResponseFormat: RootJsonFormat[PanelAppearanceResponse] = jsonFormat3(
    PanelAppearanceResponse.apply
  )
  implicit val dashboardResponseFormat: RootJsonFormat[DashboardResponse] = jsonFormat4(
    DashboardResponse.apply
  )
  implicit val panelResponseFormat: RootJsonFormat[PanelResponse] = jsonFormat5(PanelResponse.apply)
  implicit val dashboardsResponseFormat: RootJsonFormat[DashboardsResponse] = jsonFormat1(
    DashboardsResponse.apply
  )
  implicit val panelsResponseFormat: RootJsonFormat[PanelsResponse] = jsonFormat1(
    PanelsResponse.apply
  )
  implicit val healthResponseFormat: RootJsonFormat[HealthResponse] = jsonFormat1(
    HealthResponse.apply
  )
  implicit val errorResponseFormat: RootJsonFormat[ErrorResponse] = jsonFormat1(ErrorResponse.apply)
  implicit val createDashboardRequestFormat: RootJsonFormat[CreateDashboardRequest] = jsonFormat1(
    CreateDashboardRequest.apply
  )
  implicit val createPanelRequestFormat: RootJsonFormat[CreatePanelRequest] = jsonFormat2(
    CreatePanelRequest.apply
  )
  implicit val updateDashboardRequestFormat: RootJsonFormat[UpdateDashboardRequest] = jsonFormat1(
    UpdateDashboardRequest.apply
  )
  implicit val updatePanelRequestFormat: RootJsonFormat[UpdatePanelRequest] = jsonFormat1(
    UpdatePanelRequest.apply
  )
}
