package com.helio.api.protocols.dashboards

import com.helio.services.dashboards.DashboardPanelStatus
import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import spray.json._

final case class DashboardPanelStatusItem(
    panelId: String,
    lastRunAt: Option[String],
    runStatus: Option[String],
    dataUpdatedAt: Option[String],
    invalid: Boolean
)
final case class DashboardPanelStatusResponse(items: Vector[DashboardPanelStatusItem], sources: Vector[String])

/** HEL-1786: wire shape of `GET /api/dashboards/:id/panel-status`, contract `schemas/dashboards/dashboard-panel-status-response.schema.json`.
 *  Built field by field from the domain type, so an identifier added to the domain later cannot reach the wire by accident. */
object DashboardPanelStatusResponse {
  def fromDomain(status: DashboardPanelStatus): DashboardPanelStatusResponse =
    DashboardPanelStatusResponse(
      status.items.map(i => DashboardPanelStatusItem(i.panelId, i.lastRunAt.map(_.toString), i.runStatus, i.dataUpdatedAt.map(_.toString), i.invalid)),
      status.sources
    )
}

trait DashboardPanelStatusProtocol extends SprayJsonSupport with DefaultJsonProtocol {

  /** Write-only: an absent time or status is an explicit JSON `null`, which the default `jsonFormatN` would omit. */
  private def nullable(v: Option[String]): JsValue = v.fold[JsValue](JsNull)(JsString(_))

  implicit val dashboardPanelStatusItemFormat: RootJsonFormat[DashboardPanelStatusItem] =
    new RootJsonFormat[DashboardPanelStatusItem] {
      def write(i: DashboardPanelStatusItem): JsValue =
        JsObject(
          "panelId"       -> JsString(i.panelId),
          "lastRunAt"     -> nullable(i.lastRunAt),
          "runStatus"     -> nullable(i.runStatus),
          "dataUpdatedAt" -> nullable(i.dataUpdatedAt),
          "invalid"       -> JsBoolean(i.invalid)
        )
      def read(json: JsValue): DashboardPanelStatusItem = deserializationError("panel status is write-only")
    }

  implicit val dashboardPanelStatusResponseFormat: RootJsonFormat[DashboardPanelStatusResponse] =
    new RootJsonFormat[DashboardPanelStatusResponse] {
      def write(r: DashboardPanelStatusResponse): JsValue =
        JsObject("items" -> JsArray(r.items.map(_.toJson)), "sources" -> JsArray(r.sources.map(JsString(_))))
      def read(json: JsValue): DashboardPanelStatusResponse = deserializationError("panel status is write-only")
    }
}
