package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import spray.json._

// ── Shared resource / error / health response types ──────────────────────────

final case class ResourceMetaResponse(createdBy: String, createdAt: String, lastUpdated: String)
final case class ErrorResponse(message: String)
final case class HealthResponse(status: String)

object ResourceMetaResponse {
  def fromDomain(meta: ResourceMeta): ResourceMetaResponse =
    ResourceMetaResponse(
      createdBy   = meta.createdBy,
      createdAt   = meta.createdAt.toString,
      lastUpdated = meta.lastUpdated.toString
    )
}

trait ResourceProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val resourceMetaResponseFormat: RootJsonFormat[ResourceMetaResponse] = jsonFormat3(
    ResourceMetaResponse.apply
  )
  implicit val errorResponseFormat: RootJsonFormat[ErrorResponse]   = jsonFormat1(ErrorResponse.apply)
  implicit val healthResponseFormat: RootJsonFormat[HealthResponse] = jsonFormat1(HealthResponse.apply)
}
