package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import spray.json._

// ── AlertEvent API types ─────────────────────────────────────────────────────

final case class AlertEventResponse(
    id: String,
    alertRuleId: String,
    ownerId: String,
    targetDataTypeId: String,
    value: JsValue,
    pipelineRunId: Option[String],
    severity: String,
    state: String,
    firstFiredAt: String,
    lastEvaluatedAt: String,
    resolvedAt: Option[String],
    acknowledgedAt: Option[String],
    snoozedUntil: Option[String]
)
final case class AlertEventsResponse(items: Vector[AlertEventResponse])

/** Snooze request — `{ snoozedUntil }`, an ISO-8601 instant string. */
final case class SnoozeAlertEventRequest(snoozedUntil: String)

object AlertEventResponse {
  def fromDomain(event: AlertEvent): AlertEventResponse =
    AlertEventResponse(
      id                = event.id.value,
      alertRuleId       = event.alertRuleId.value,
      ownerId           = event.ownerId.value,
      targetDataTypeId  = event.targetDataTypeId.value,
      value             = event.value,
      pipelineRunId     = event.pipelineRunId,
      severity          = Severity.asString(event.severity),
      state             = AlertEventState.asString(event.state),
      firstFiredAt      = event.firstFiredAt.toString,
      lastEvaluatedAt   = event.lastEvaluatedAt.toString,
      resolvedAt        = event.resolvedAt.map(_.toString),
      acknowledgedAt    = event.acknowledgedAt.map(_.toString),
      snoozedUntil      = event.snoozedUntil.map(_.toString)
    )
}

trait AlertEventProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val alertEventResponseFormat: RootJsonFormat[AlertEventResponse]   = jsonFormat13(AlertEventResponse.apply)
  implicit val alertEventsResponseFormat: RootJsonFormat[AlertEventsResponse] = jsonFormat1(AlertEventsResponse.apply)
  implicit val snoozeAlertEventRequestFormat: RootJsonFormat[SnoozeAlertEventRequest] = jsonFormat1(SnoozeAlertEventRequest.apply)
}
