package com.helio.api.protocols.metrics

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.model._
import spray.json._

// ── Metric API types (HEL-446 domain/response types; HEL-493 adds the
//    create/update request types + `/api/metrics` REST layer) ───────────────

/** Wire DTO for `MetricDefinition` — string-ified IDs/timestamps, mirroring
 *  `AlertRuleResponse`/`AlertRuleResponse.fromDomain` (design.md Decision 3a):
 *  every ID/Instant-bearing domain entity in this codebase is exposed via a
 *  `*Response` DTO rather than a direct `RootJsonFormat` on the domain case
 *  class, since no `JsonFormat[Instant]` instance exists to support direct
 *  macro-derivation. */
final case class MetricResponse(
    id: String,
    ownerId: String,
    dataTypeId: String,
    name: String,
    description: Option[String],
    measureField: String,
    aggregation: String,
    allowedDimensions: Vector[String],
    format: MetricFormat,
    deprecated: Boolean,
    createdAt: String,
    updatedAt: String
)

object MetricResponse {
  def fromDomain(m: MetricDefinition): MetricResponse =
    MetricResponse(
      id                = m.id.value,
      ownerId           = m.ownerId.value,
      dataTypeId        = m.dataTypeId.value,
      name              = m.name,
      description       = m.description,
      measureField      = m.measureField,
      aggregation       = m.aggregation,
      allowedDimensions = m.allowedDimensions,
      format            = m.format,
      deprecated        = m.deprecated,
      createdAt         = m.createdAt.toString,
      updatedAt         = m.updatedAt.toString
    )
}

/** Create request — `{ dataTypeId, name, description?, measureField,
 *  aggregation, allowedDimensions, format? }`. `dataTypeId` must resolve to
 *  a caller-owned, pipeline-output DataType (`MetricService` validates);
 *  `format`, when absent, defaults to an all-absent `MetricFormat`
 *  (`MetricService.create`). */
final case class CreateMetricRequest(
    dataTypeId: String,
    name: String,
    description: Option[String],
    measureField: String,
    aggregation: String,
    allowedDimensions: Vector[String],
    format: Option[MetricFormat]
)

/** Update request — absent-vs-null convention mirroring
 *  `MetricPanelConfig.Patch` (design.md Decision 3): `name`/`measureField`/
 *  `aggregation`/`allowedDimensions`/`deprecated` are plain `Option[X]`
 *  (absent = unchanged, present = replace — none of these are meaningfully
 *  nullable); `description`/`format` are `Option[Option[X]]` (absent =
 *  unchanged, `null` = clear, object = replace whole — no deep merge of
 *  `format`'s own sub-fields). `dataTypeId` is intentionally not patchable
 *  here — it isn't in the ticket's field list. */
final case class UpdateMetricRequest(
    name: Option[String],
    description: Option[Option[String]],
    measureField: Option[String],
    aggregation: Option[String],
    allowedDimensions: Option[Vector[String]],
    format: Option[Option[MetricFormat]],
    deprecated: Option[Boolean]
)

object UpdateMetricRequest {
  val Empty: UpdateMetricRequest = UpdateMetricRequest(None, None, None, None, None, None, None)
}

/** One panel entry in a [[MetricUsageResponse]] — wire DTO for
 *  `MetricUsagePanel` (HEL-560), string-ified IDs mirroring
 *  `MetricResponse`'s own convention. */
final case class MetricUsagePanelResponse(
    panelId: String,
    panelTitle: String,
    dashboardId: String,
    dashboardName: String
)

/** Response body of `GET /api/metrics/:id/usage` (HEL-560 design.md D1) —
 *  wire DTO for `MetricUsage`. */
final case class MetricUsageResponse(
    metricId: String,
    count: Int,
    panels: Vector[MetricUsagePanelResponse]
)

object MetricUsageResponse {
  def fromDomain(u: MetricUsage): MetricUsageResponse =
    MetricUsageResponse(
      metricId = u.metricId.value,
      count    = u.count,
      panels   = u.panels.map(p =>
        MetricUsagePanelResponse(
          panelId       = p.panelId.value,
          panelTitle    = p.panelTitle,
          dashboardId   = p.dashboardId.value,
          dashboardName = p.dashboardName
        )
      )
    )
}

trait MetricProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  // Needed directly (no ID/Instant fields) — used by MetricRepository's JSONB
  // `format` column MappedColumnType, mirroring DataTypeProtocol's
  // `dataFieldFormat`/`computedFieldFormat`.
  implicit val metricFormatFormat: RootJsonFormat[MetricFormat] = jsonFormat4(MetricFormat.apply)

  implicit val metricResponseFormat: RootJsonFormat[MetricResponse] = jsonFormat12(MetricResponse.apply)

  implicit val createMetricRequestFormat: RootJsonFormat[CreateMetricRequest] = jsonFormat7(CreateMetricRequest.apply)

  /** Custom format — `read` implements the absent-vs-null decode described
   *  on `UpdateMetricRequest`'s scaladoc (macros can't express "key absent"
   *  vs "key present, null"); `write` is the symmetric inverse, mirroring
   *  `PanelProtocol.updatePanelRequestFormat`. */
  implicit val updateMetricRequestFormat: RootJsonFormat[UpdateMetricRequest] =
    new RootJsonFormat[UpdateMetricRequest] {
      def write(r: UpdateMetricRequest): JsValue = {
        val fields = scala.collection.mutable.Map.empty[String, JsValue]
        r.name.foreach(v => fields("name") = JsString(v))
        r.description.foreach(v => fields("description") = v.map(JsString(_)).getOrElse(JsNull))
        r.measureField.foreach(v => fields("measureField") = JsString(v))
        r.aggregation.foreach(v => fields("aggregation") = JsString(v))
        r.allowedDimensions.foreach(v => fields("allowedDimensions") = v.toJson)
        r.format.foreach(v => fields("format") = v.map(_.toJson).getOrElse(JsNull))
        r.deprecated.foreach(v => fields("deprecated") = JsBoolean(v))
        JsObject(fields.toMap)
      }

      def read(json: JsValue): UpdateMetricRequest = json match {
        case JsObject(fields) =>
          val name = fields.get("name") match {
            case None              => None
            case Some(JsString(s)) => Some(s)
            case Some(x)           => deserializationError(s"name must be a string, got $x")
          }
          val description = fields.get("description") match {
            case None              => None
            case Some(JsNull)      => Some(None)
            case Some(JsString(s)) => Some(Some(s))
            case Some(x)           => deserializationError(s"description must be a string or null, got $x")
          }
          val measureField = fields.get("measureField") match {
            case None              => None
            case Some(JsString(s)) => Some(s)
            case Some(x)           => deserializationError(s"measureField must be a string, got $x")
          }
          val aggregation = fields.get("aggregation") match {
            case None              => None
            case Some(JsString(s)) => Some(s)
            case Some(x)           => deserializationError(s"aggregation must be a string, got $x")
          }
          val allowedDimensions = fields.get("allowedDimensions") match {
            case None                => None
            case Some(a: JsArray)    => Some(a.convertTo[Vector[String]])
            case Some(x)             => deserializationError(s"allowedDimensions must be an array of strings, got $x")
          }
          val format = fields.get("format") match {
            case None               => None
            case Some(JsNull)       => Some(None)
            case Some(o: JsObject)  => Some(Some(o.convertTo[MetricFormat]))
            case Some(x)            => deserializationError(s"format must be an object or null, got $x")
          }
          val deprecated = fields.get("deprecated") match {
            case None                => None
            case Some(JsBoolean(b))  => Some(b)
            case Some(x)             => deserializationError(s"deprecated must be a boolean, got $x")
          }
          UpdateMetricRequest(name, description, measureField, aggregation, allowedDimensions, format, deprecated)
        case _ => UpdateMetricRequest.Empty
      }
    }

  implicit val metricUsagePanelResponseFormat: RootJsonFormat[MetricUsagePanelResponse] =
    jsonFormat4(MetricUsagePanelResponse.apply)

  implicit val metricUsageResponseFormat: RootJsonFormat[MetricUsageResponse] =
    jsonFormat3(MetricUsageResponse.apply)
}
