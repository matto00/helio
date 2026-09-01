package com.helio.api.protocols

import com.helio.api.protocols.audit.{AuditEventProtocol, AuditEventResponse}
import com.helio.api.protocols.dashboards.{DashboardProtocol, DashboardResponse}
import com.helio.api.protocols.panels.{PanelProtocol, PanelResponse}
import com.helio.api.protocols.sources.{DataSourceProtocol, DataSourceResponse}
import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.model._
import spray.json._

/** JSON formats for [[PagedResult]] for each list-endpoint response type.
 *
 *  Each format is hand-rolled because spray-json's `jsonFormat` macros cannot
 *  derive formats for generic case classes. HEL-904 task 4.1: the DataType/
 *  Metric formats are removed outright — neither entity's list endpoint
 *  exists anymore. The remaining four concrete types are
 *  `PagedResult[DashboardResponse]`, `PagedResult[DataSourceResponse]`,
 *  `PagedResult[PanelResponse]`, and `PagedResult[AuditEventResponse]`
 *  (HEL-488). */
trait PaginationProtocol
    extends SprayJsonSupport
    with DefaultJsonProtocol
    with DashboardProtocol
    with DataSourceProtocol
    with PanelProtocol
    with AuditEventProtocol {

  private def pagedResultFormat[A](implicit itemFormat: JsonFormat[A]): RootJsonFormat[PagedResult[A]] =
    new RootJsonFormat[PagedResult[A]] {
      override def write(p: PagedResult[A]): JsValue =
        JsObject(
          "items"  -> JsArray(p.items.map(itemFormat.write)),
          "total"  -> JsNumber(p.total),
          "offset" -> JsNumber(p.offset),
          "limit"  -> JsNumber(p.limit)
        )

      override def read(json: JsValue): PagedResult[A] = {
        val obj = json.asJsObject
        PagedResult(
          items  = obj.fields("items").convertTo[Vector[A]],
          total  = obj.fields("total").convertTo[Int],
          offset = obj.fields("offset").convertTo[Int],
          limit  = obj.fields("limit").convertTo[Int]
        )
      }
    }

  implicit val pagedDashboardsFormat: RootJsonFormat[PagedResult[DashboardResponse]] =
    pagedResultFormat[DashboardResponse]

  implicit val pagedDataSourcesFormat: RootJsonFormat[PagedResult[DataSourceResponse]] =
    pagedResultFormat[DataSourceResponse]

  implicit val pagedPanelsFormat: RootJsonFormat[PagedResult[PanelResponse]] =
    pagedResultFormat[PanelResponse]

  implicit val pagedAuditEventsFormat: RootJsonFormat[PagedResult[AuditEventResponse]] =
    pagedResultFormat[AuditEventResponse]
}
