package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import spray.json._

/** JSON formats for [[PagedResult]] for each list-endpoint response type.
 *
 *  Each format is hand-rolled because spray-json's `jsonFormat` macros cannot
 *  derive formats for generic case classes. The five concrete types are
 *  `PagedResult[DashboardResponse]`, `PagedResult[DataTypeResponse]`,
 *  `PagedResult[DataSourceResponse]`, `PagedResult[PanelResponse]`, and
 *  `PagedResult[MetricResponse]` (HEL-493). */
trait PaginationProtocol
    extends SprayJsonSupport
    with DefaultJsonProtocol
    with DashboardProtocol
    with DataTypeProtocol
    with DataSourceProtocol
    with PanelProtocol
    with MetricProtocol {

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

  implicit val pagedDataTypesFormat: RootJsonFormat[PagedResult[DataTypeResponse]] =
    pagedResultFormat[DataTypeResponse]

  implicit val pagedDataSourcesFormat: RootJsonFormat[PagedResult[DataSourceResponse]] =
    pagedResultFormat[DataSourceResponse]

  implicit val pagedPanelsFormat: RootJsonFormat[PagedResult[PanelResponse]] =
    pagedResultFormat[PanelResponse]

  implicit val pagedMetricsFormat: RootJsonFormat[PagedResult[MetricResponse]] =
    pagedResultFormat[MetricResponse]
}
