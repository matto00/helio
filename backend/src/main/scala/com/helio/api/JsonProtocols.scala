package com.helio.api

import akka.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.Dashboard
import com.helio.domain.Panel
import spray.json.DefaultJsonProtocol
import spray.json.RootJsonFormat

final case class DashboardResponse(id: String, name: String)
final case class PanelResponse(id: String, dashboardId: String, title: String)
final case class DashboardsResponse(items: Vector[DashboardResponse])
final case class PanelsResponse(items: Vector[PanelResponse])
final case class HealthResponse(status: String)

object DashboardResponse {
  def fromDomain(dashboard: Dashboard): DashboardResponse =
    DashboardResponse(id = dashboard.id.value, name = dashboard.name)
}

object PanelResponse {
  def fromDomain(panel: Panel): PanelResponse =
    PanelResponse(id = panel.id.value, dashboardId = panel.dashboardId.value, title = panel.title)
}

trait JsonProtocols extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val dashboardResponseFormat: RootJsonFormat[DashboardResponse] = jsonFormat2(
    DashboardResponse.apply
  )
  implicit val panelResponseFormat: RootJsonFormat[PanelResponse] = jsonFormat3(PanelResponse.apply)
  implicit val dashboardsResponseFormat: RootJsonFormat[DashboardsResponse] = jsonFormat1(
    DashboardsResponse.apply
  )
  implicit val panelsResponseFormat: RootJsonFormat[PanelsResponse] = jsonFormat1(
    PanelsResponse.apply
  )
  implicit val healthResponseFormat: RootJsonFormat[HealthResponse] = jsonFormat1(
    HealthResponse.apply
  )
}
