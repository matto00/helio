package com.helio.services.workspace

import spray.json._

/** HEL-1639 D1: strips secret-bearing values from a step config before it is shown to a model. No registered step kind
 *  carries one today (a source's secrets live on its Connector, never in a step), so this is a guard against a future
 *  kind adding such a key: matched by EXACT key name (case-insensitive), never by substring, so an innocent key such
 *  as `maxTokens` is never touched. */
private[services] object SecretRedaction {

  val Redacted: JsString = JsString("[redacted]")

  private val SecretKeys: Set[String] =
    Set("password", "passwd", "secret", "clientsecret", "apikey", "api_key", "authorization", "accesstoken", "refreshtoken", "token", "bearer", "privatekey")

  def redact(value: JsValue): JsValue = value match {
    case JsObject(fields) =>
      JsObject(fields.map {
        case (k, _) if SecretKeys.contains(k.toLowerCase) => k -> Redacted
        case (k, v)                                       => k -> redact(v)
      })
    case JsArray(items) => JsArray(items.map(redact))
    case other          => other
  }
}
