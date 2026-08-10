package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import spray.json._

// ── Metric API types (HEL-446 — data-layer only; no routes yet) ─────────────

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

trait MetricProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  // Needed directly (no ID/Instant fields) — used by MetricRepository's JSONB
  // `format` column MappedColumnType, mirroring DataTypeProtocol's
  // `dataFieldFormat`/`computedFieldFormat`.
  implicit val metricFormatFormat: RootJsonFormat[MetricFormat] = jsonFormat4(MetricFormat.apply)

  implicit val metricResponseFormat: RootJsonFormat[MetricResponse] = jsonFormat12(MetricResponse.apply)
}
