package com.helio.services

import com.helio.api.JsonProtocols
import com.helio.api.protocols.{FieldOverridePayload, RestApiConfigPayload, SqlSourceConfigPayload}
import com.helio.domain.{RestApiConfig, SqlSourceConfig}
import spray.json._

/** Parses stored `data_sources.config` JSON into the domain config types used
 *  by `SourceService`. Mixes in the full `JsonProtocols` aggregator to pull
 *  the existing spray formats into scope — none of the `SprayJsonSupport`
 *  Pekko-HTTP machinery is referenced from here, so the service layer stays
 *  free of `org.apache.pekko.http` imports. */
private[services] object SourceConfigParsing extends JsonProtocols {

  /** Parse a stored SQL source config. Throws on malformed input — callers
   *  wrap with `Try` and map failures to `ServiceError.BadRequest`. */
  def sqlConfigFromJson(json: JsValue): SqlSourceConfig =
    SqlSourceConfigPayload.toDomain(json.convertTo[SqlSourceConfigPayload])

  /** Parse a stored REST source config. Returns `Left` on validation failure
   *  (mirrors the existing `RestApiConfigPayload.toDomain` `Either`). Throws
   *  only on outright JSON-shape mismatch. */
  def restConfigFromJson(json: JsValue): Either[String, RestApiConfig] =
    RestApiConfigPayload.toDomain(json.convertTo[RestApiConfigPayload])

  /** Re-export the format for `Vector[FieldOverridePayload]` — used by
   *  `DataSourceService.parseFieldOverrides` for the CSV-upload multipart. */
  implicit val fieldOverrideVectorFormat: RootJsonFormat[Vector[FieldOverridePayload]] =
    vectorFormat(fieldOverridePayloadFormat)
}
