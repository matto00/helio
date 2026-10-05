package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.model._
import spray.json._


final case class ResourceMetaResponse(createdBy: Option[String], createdAt: String, lastUpdated: String)
final case class ErrorResponse(message: String)
/** HEL-1147: 422 body for a pipeline execution refused because a step's own configuration is
 *  missing/invalid. `message` is the unchanged generic error text (step id + lane path included);
 *  `reason` is the step's own problem description without that prefix. Titled
 *  `StepConfigErrorResponse` in `schemas/shared/`. */
final case class StepConfigErrorResponse(message: String, code: String, stepId: String, stepKind: String, reason: String)
final case class HealthResponse(status: String)

object ResourceMetaResponse {
  /** `includeCreatedBy` (HEL-1216): `createdBy` is the creating user's id, an owner-id equivalent, so
   *  the public panel-list route omits it (the key is absent, not null) for a non-owner caller.
   *  Defaults `true` so every other call site is byte-identical. */
  def fromDomain(meta: ResourceMeta, includeCreatedBy: Boolean = true): ResourceMetaResponse =
    ResourceMetaResponse(
      createdBy   = if (includeCreatedBy) Some(meta.createdBy) else None,
      createdAt   = meta.createdAt.toString,
      lastUpdated = meta.lastUpdated.toString
    )
}

trait ResourceProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val resourceMetaResponseFormat: RootJsonFormat[ResourceMetaResponse] = jsonFormat3(
    ResourceMetaResponse.apply
  )
  implicit val errorResponseFormat: RootJsonFormat[ErrorResponse]   = jsonFormat1(ErrorResponse.apply)
  implicit val stepConfigErrorResponseFormat: RootJsonFormat[StepConfigErrorResponse] =
    jsonFormat5(StepConfigErrorResponse.apply)
  implicit val healthResponseFormat: RootJsonFormat[HealthResponse] = jsonFormat1(HealthResponse.apply)
}
