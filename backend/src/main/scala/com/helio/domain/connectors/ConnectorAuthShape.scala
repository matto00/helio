package com.helio.domain.connectors

import spray.json._

/** HEL-822 design.md Decision 3 (revised, skeptic round 1 CR1/CR2): the non-secret shape
 *  stored in `connectors.config` (JSONB) when `kind = "rest_api"`. Deliberately NOT a reuse
 *  of `RestApiAuthPayload` (which carries the credential value itself — writing that here
 *  would defeat HEL-536/HEL-821's encrypted-at-rest guarantee). The credential *value* lives
 *  only in `connector_credentials`, reached via the Connector's `credentialId`.
 *
 *  `implicit` is server-owned (Decision 1a revised, CR5) — never read from client-supplied
 *  config on either `POST /api/connectors` or `PATCH`; both strip/ignore any `implicit` key
 *  present in the request body and set the field themselves.
 *
 *  {{{
 *  { "authType": "none" | "bearer" | "api_key",
 *    "apiKeyName": "<header/query param name>",  // present only when authType = "api_key"
 *    "apiKeyPlacement": "header" | "query",        // present only when authType = "api_key"
 *    "defaultHeaders": { "...": "..." },           // optional, Decision 4
 *    "implicit": true | false                      // server-owned
 *  }
 *  }}}
 */
final case class ConnectorAuthShape(
    authType: String,
    apiKeyName: Option[String] = None,
    apiKeyPlacement: Option[String] = None,
    defaultHeaders: Map[String, String] = Map.empty,
    `implicit`: Boolean = false
)

object ConnectorAuthShape extends DefaultJsonProtocol {

  /** Cycle-2 skeptic root-cause fix: a bare `jsonFormat5` macro treats every declared field as
   *  REQUIRED on read — it does NOT fall back to a case class's Scala default value for a
   *  missing non-`Option` key (`defaultHeaders`/`implicit` both have Scala defaults, but
   *  spray-json ignores them). Every pre-HEL-822 (HEL-821-era) `connectors.config` row was
   *  written before the `implicit` field existed, so a bare macro format would make EVERY
   *  such row fail to parse — caught by `parse`'s outer `try`, but silently coerced into
   *  `authType = "none"` with EMPTY `defaultHeaders`, discarding a real Connector's stored
   *  auth shape and default headers without any signal. Hand-rolled to default each
   *  optional-with-a-Scala-default field explicitly on read, so a missing key is genuinely
   *  optional, not a masked parse failure. */
  implicit val format: RootJsonFormat[ConnectorAuthShape] = new RootJsonFormat[ConnectorAuthShape] {
    override def write(c: ConnectorAuthShape): JsValue = JsObject(
      Map(
        "authType"       -> JsString(c.authType),
        "defaultHeaders" -> c.defaultHeaders.toJson,
        "implicit"       -> JsBoolean(c.`implicit`)
      ) ++ c.apiKeyName.map("apiKeyName" -> JsString(_))
        ++ c.apiKeyPlacement.map("apiKeyPlacement" -> JsString(_))
    )

    override def read(json: JsValue): ConnectorAuthShape = {
      val obj = json.asJsObject
      ConnectorAuthShape(
        authType        = obj.fields.get("authType").collect { case JsString(s) => s }.getOrElse("none"),
        apiKeyName      = obj.fields.get("apiKeyName").collect { case JsString(s) => s },
        apiKeyPlacement = obj.fields.get("apiKeyPlacement").collect { case JsString(s) => s },
        defaultHeaders  = obj.fields.get("defaultHeaders").map(_.convertTo[Map[String, String]]).getOrElse(Map.empty),
        `implicit`      = obj.fields.get("implicit").collect { case JsBoolean(b) => b }.getOrElse(false)
      )
    }
  }

  /** Parses a Connector's stored `config` JSON into a `ConnectorAuthShape`, defaulting to
   *  `authType = "none"` ONLY for genuinely non-object/non-JSON input (e.g. `"{}"`'s sibling
   *  malformed cases) — a well-formed JSON object with some fields absent is handled field-by-
   *  field by `format.read` above, never routed through this fallback. */
  def parse(raw: String): ConnectorAuthShape =
    try {
      JsonParser(raw).convertTo[ConnectorAuthShape]
    } catch {
      case _: RuntimeException => ConnectorAuthShape(authType = "none")
    }

  def encode(shape: ConnectorAuthShape): String = shape.toJson.compactPrint
}
