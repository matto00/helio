package com.helio.ai

import spray.json._

/** spray-json formatters for the wire types in `ClaudeWireModels.scala`. Written by hand (rather
 *  than the usual `jsonFormatN` macro) because the Anthropic API's JSON field names are
 *  snake_case (`max_tokens`, `input_tokens`, ...) while the Scala case classes stay idiomatic
 *  camelCase — same "hand-write a `RootJsonFormat`" pattern already used elsewhere in this
 *  codebase for field-name-mismatched shapes (e.g. `PaginationProtocol.pagedResultFormat`). */
trait ClaudeProtocol extends DefaultJsonProtocol {

  implicit val claudeApiMessageFormat: RootJsonFormat[ClaudeApiMessage] = jsonFormat2(ClaudeApiMessage.apply)

  implicit val claudeApiRequestFormat: RootJsonFormat[ClaudeApiRequest] = new RootJsonFormat[ClaudeApiRequest] {
    def write(r: ClaudeApiRequest): JsValue = JsObject(
      "model"       -> JsString(r.model),
      "max_tokens"  -> JsNumber(r.maxTokens),
      "messages"    -> r.messages.toJson,
      "temperature" -> JsNumber(r.temperature),
      "stream"      -> JsBoolean(r.stream)
    )

    // Outbound-only — this ticket never needs to decode a request it built itself.
    def read(json: JsValue): ClaudeApiRequest =
      throw new UnsupportedOperationException("ClaudeApiRequest is an outbound-only wire type")
  }

  implicit val claudeApiUsageFormat: RootJsonFormat[ClaudeApiUsage] = new RootJsonFormat[ClaudeApiUsage] {
    def write(u: ClaudeApiUsage): JsValue = JsObject(
      "input_tokens"  -> JsNumber(u.inputTokens),
      "output_tokens" -> JsNumber(u.outputTokens)
    )

    def read(json: JsValue): ClaudeApiUsage = {
      val obj = json.asJsObject
      ClaudeApiUsage(
        inputTokens = obj.fields.get("input_tokens").map(_.convertTo[Int]).getOrElse(0),
        outputTokens = obj.fields.get("output_tokens").map(_.convertTo[Int]).getOrElse(0)
      )
    }
  }

  implicit val claudeApiContentBlockFormat: RootJsonFormat[ClaudeApiContentBlock] =
    new RootJsonFormat[ClaudeApiContentBlock] {
      def write(b: ClaudeApiContentBlock): JsValue = JsObject(
        Map("type" -> JsString(b.blockType)) ++ b.text.map(t => "text" -> JsString(t)).toMap
      )

      def read(json: JsValue): ClaudeApiContentBlock = {
        val obj = json.asJsObject
        ClaudeApiContentBlock(
          blockType = obj.fields.get("type").map(_.convertTo[String]).getOrElse(""),
          text = obj.fields.get("text").map(_.convertTo[String])
        )
      }
    }

  implicit val claudeApiResponseFormat: RootJsonFormat[ClaudeApiResponse] = new RootJsonFormat[ClaudeApiResponse] {
    def write(r: ClaudeApiResponse): JsValue = JsObject(
      "id"      -> JsString(r.id),
      "content" -> r.content.toJson,
      "stop_reason" -> r.stopReason.map(JsString(_)).getOrElse(JsNull),
      "usage"   -> r.usage.toJson
    )

    def read(json: JsValue): ClaudeApiResponse = {
      val obj = json.asJsObject
      ClaudeApiResponse(
        id = obj.fields.get("id").map(_.convertTo[String]).getOrElse(""),
        content = obj.fields.get("content").map(_.convertTo[Seq[ClaudeApiContentBlock]]).getOrElse(Seq.empty),
        stopReason = obj.fields.get("stop_reason").flatMap {
          case JsNull  => None
          case JsString(s) => Some(s)
          case other   => Some(other.toString)
        },
        usage = obj.fields.get("usage").map(_.convertTo[ClaudeApiUsage]).getOrElse(ClaudeApiUsage(0, 0))
      )
    }
  }
}

object ClaudeProtocol extends ClaudeProtocol
