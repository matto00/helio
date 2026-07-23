package com.helio.api.protocols

import org.apache.pekko.http.scaladsl.marshallers.sprayjson.SprayJsonSupport
import com.helio.domain._
import spray.json._

// ── AlertRule API types ──────────────────────────────────────────────────────

final case class AlertRuleResponse(
    id: String,
    ownerId: String,
    targetDataTypeId: String,
    metric: String,
    condition: JsValue,
    name: String,
    enabled: Boolean,
    severity: String,
    createdAt: String,
    updatedAt: String
)
final case class AlertRulesResponse(items: Vector[AlertRuleResponse])

/** Create request — `{ targetDataTypeId, metric, condition, severity,
 *  enabled?, name }`. `enabled` is the one field the ticket calls out as
 *  optional on the wire (spray-json omits `None`); `AlertRuleService`
 *  normalizes an absent value to `true`. */
final case class CreateAlertRuleRequest(
    targetDataTypeId: String,
    metric: String,
    condition: JsValue,
    severity: String,
    enabled: Option[Boolean],
    name: String
)

/** Update request — any subset of `{ metric, condition, severity, enabled,
 *  name }`; absent fields leave the existing value unchanged. */
final case class UpdateAlertRuleRequest(
    metric: Option[String],
    condition: Option[JsValue],
    severity: Option[String],
    enabled: Option[Boolean],
    name: Option[String]
)

object AlertRuleResponse {
  def fromDomain(rule: AlertRule): AlertRuleResponse =
    AlertRuleResponse(
      id               = rule.id.value,
      ownerId          = rule.ownerId.value,
      targetDataTypeId = rule.targetDataTypeId.value,
      metric           = rule.metric,
      condition        = rule.condition,
      name             = rule.name,
      enabled          = rule.enabled,
      severity         = Severity.asString(rule.severity),
      createdAt        = rule.createdAt.toString,
      updatedAt        = rule.updatedAt.toString
    )
}

trait AlertRuleProtocol extends SprayJsonSupport with DefaultJsonProtocol {
  implicit val alertRuleResponseFormat: RootJsonFormat[AlertRuleResponse]   = jsonFormat10(AlertRuleResponse.apply)
  implicit val alertRulesResponseFormat: RootJsonFormat[AlertRulesResponse] = jsonFormat1(AlertRulesResponse.apply)
  implicit val createAlertRuleRequestFormat: RootJsonFormat[CreateAlertRuleRequest] = jsonFormat6(CreateAlertRuleRequest.apply)
  implicit val updateAlertRuleRequestFormat: RootJsonFormat[UpdateAlertRuleRequest] = jsonFormat5(UpdateAlertRuleRequest.apply)
}
