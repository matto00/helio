package com.helio.api.protocols.dashboards

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.model.DashboardChange
import spray.json._

import java.time.Instant

final case class DashboardChangeOutput(outputId: String, dataUpdatedAt: Option[String])
final case class DashboardChangeItem(
    dashboardId: String,
    contentUpdatedAt: String,
    dataUpdatedAt: Option[String],
    outputs: Vector[DashboardChangeOutput]
)
final case class DashboardChangesResponse(serverNow: String, items: Vector[DashboardChangeItem])

object DashboardChangesResponse {
  def fromDomain(serverNow: Instant, changes: Vector[DashboardChange]): DashboardChangesResponse =
    DashboardChangesResponse(
      serverNow.toString,
      changes.map { c =>
        DashboardChangeItem(
          c.dashboardId,
          c.contentUpdatedAt.toString,
          c.dataUpdatedAt.map(_.toString),
          c.outputs.map(o => DashboardChangeOutput(o.outputId, o.dataUpdatedAt.map(_.toString)))
        )
      }
    )
}

trait DashboardChangesProtocol extends SprayJsonSupport with DefaultJsonProtocol {

  /** Write-only: a missing time is an explicit JSON `null`, which the default `jsonFormatN` would omit. */
  private def nullable(v: Option[String]): JsValue = v.fold[JsValue](JsNull)(JsString(_))

  implicit val dashboardChangeOutputFormat: RootJsonFormat[DashboardChangeOutput] =
    new RootJsonFormat[DashboardChangeOutput] {
      def write(o: DashboardChangeOutput): JsValue =
        JsObject("outputId" -> JsString(o.outputId), "dataUpdatedAt" -> nullable(o.dataUpdatedAt))
      def read(json: JsValue): DashboardChangeOutput = deserializationError("dashboard changes are write-only")
    }

  implicit val dashboardChangeItemFormat: RootJsonFormat[DashboardChangeItem] =
    new RootJsonFormat[DashboardChangeItem] {
      def write(i: DashboardChangeItem): JsValue =
        JsObject(
          "dashboardId"      -> JsString(i.dashboardId),
          "contentUpdatedAt" -> JsString(i.contentUpdatedAt),
          "dataUpdatedAt"    -> nullable(i.dataUpdatedAt),
          "outputs"          -> JsArray(i.outputs.map(_.toJson))
        )
      def read(json: JsValue): DashboardChangeItem = deserializationError("dashboard changes are write-only")
    }

  implicit val dashboardChangesResponseFormat: RootJsonFormat[DashboardChangesResponse] =
    new RootJsonFormat[DashboardChangesResponse] {
      def write(r: DashboardChangesResponse): JsValue =
        JsObject("serverNow" -> JsString(r.serverNow), "items" -> JsArray(r.items.map(_.toJson)))
      def read(json: JsValue): DashboardChangesResponse = deserializationError("dashboard changes are write-only")
    }
}
