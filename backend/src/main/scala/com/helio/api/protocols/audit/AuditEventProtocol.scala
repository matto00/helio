package com.helio.api.protocols.audit

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain.model._
import spray.json._

// Deliberately minimal — no route consumes this yet. The audit-query ticket
// extends this with list/paging response shapes.

final case class AuditEventResponse(
    id: String,
    actorUserId: Option[String],
    actorTokenId: Option[String],
    source: String,
    action: String,
    resourceType: String,
    resourceId: Option[String],
    metadata: JsValue,
    createdAt: String
)

object AuditEventResponse {
  def fromDomain(event: AuditEvent): AuditEventResponse =
    AuditEventResponse(
      id           = event.id.value,
      actorUserId  = event.actorUserId.map(_.value),
      actorTokenId = event.actorTokenId.map(_.value),
      source       = AuditSource.asString(event.source),
      action       = event.action,
      resourceType = event.resourceType,
      resourceId   = event.resourceId,
      metadata     = event.metadata,
      createdAt    = event.createdAt.toString
    )
}

trait AuditEventProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val auditEventResponseFormat: RootJsonFormat[AuditEventResponse] = jsonFormat9(AuditEventResponse.apply)
}
