package com.helio.api

import akka.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.Dashboard
import com.helio.domain.Panel
import com.helio.domain.ResourceMeta
import spray.json.DefaultJsonProtocol
import spray.json.RootJsonFormat

final case class ResourceMetaResponse(createdBy: String, createdAt: String, lastUpdated: String)
final case class DashboardResponse(id: String, name: String, meta: ResourceMetaResponse)
final case class PanelResponse(id: String, dashboardId: String, title: String, meta: ResourceMetaResponse)
final case class DashboardsResponse(items: Vector[DashboardResponse])
final case class PanelsResponse(items: Vector[PanelResponse])
final case class HealthResponse(status: String)
final case class ErrorResponse(message: String)
final case class CreateDashboardRequest(name: Option[String])
final case class CreatePanelRequest(dashboardId: Option[String], title: Option[String])

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
      meta = ResourceMetaResponse.fromDomain(dashboard.meta)
    )
}

object PanelResponse {
  def fromDomain(panel: Panel): PanelResponse =
    PanelResponse(
      id = panel.id.value,
      dashboardId = panel.dashboardId.value,
      title = panel.title,
      meta = ResourceMetaResponse.fromDomain(panel.meta)
    )
}

trait JsonProtocols extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val resourceMetaResponseFormat: RootJsonFormat[ResourceMetaResponse] = jsonFormat3(
    ResourceMetaResponse.apply
  )
  implicit val dashboardResponseFormat: RootJsonFormat[DashboardResponse] = jsonFormat3(
    DashboardResponse.apply
  )
  implicit val panelResponseFormat: RootJsonFormat[PanelResponse] = jsonFormat4(PanelResponse.apply)
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
}
