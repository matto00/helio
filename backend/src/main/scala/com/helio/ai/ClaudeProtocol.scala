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

  /** Handles all three block shapes the Anthropic Messages API uses (design.md D2): plain `text`
   *  (unchanged from before this ticket), `tool_use` (Claude requesting a tool call: `id`/`name`/
   *  `input`), and `tool_result` (a caller feeding a result back: `tool_use_id`/`content`/
   *  `is_error`) — the wire key for the block's textual payload is `text` for a `text` block but
   *  `content` for a `tool_result` block, so the mapping switches on `blockType` rather than using
   *  one fixed key for every shape. */
  implicit val claudeApiContentBlockFormat: RootJsonFormat[ClaudeApiContentBlock] =
    new RootJsonFormat[ClaudeApiContentBlock] {
      def write(b: ClaudeApiContentBlock): JsValue = {
        val typeField: Map[String, JsValue] = Map("type" -> JsString(b.blockType))
        val shapeFields: Map[String, JsValue] = b.blockType match {
          case "tool_use" =>
            b.id.map(v => "id" -> JsString(v)).toMap ++
              b.name.map(v => "name" -> JsString(v)).toMap ++
              b.input.map(v => "input" -> v).toMap
          case "tool_result" =>
            b.toolUseId.map(v => "tool_use_id" -> JsString(v)).toMap ++
              b.text.map(v => "content" -> JsString(v)).toMap ++
              b.isError.map(v => "is_error" -> JsBoolean(v)).toMap
          case _ =>
            b.text.map(v => "text" -> JsString(v)).toMap
        }
        JsObject(typeField ++ shapeFields)
      }

      def read(json: JsValue): ClaudeApiContentBlock = {
        val obj       = json.asJsObject
        val blockType = obj.fields.get("type").map(_.convertTo[String]).getOrElse("")
        blockType match {
          case "tool_use" =>
            ClaudeApiContentBlock(
              blockType = blockType,
              text = None,
              id = obj.fields.get("id").map(_.convertTo[String]),
              name = obj.fields.get("name").map(_.convertTo[String]),
              input = obj.fields.get("input")
            )
          case "tool_result" =>
            ClaudeApiContentBlock(
              blockType = blockType,
              text = obj.fields.get("content").map(_.convertTo[String]),
              toolUseId = obj.fields.get("tool_use_id").map(_.convertTo[String]),
              isError = obj.fields.get("is_error").map(_.convertTo[Boolean])
            )
          case _ =>
            ClaudeApiContentBlock(
              blockType = blockType,
              text = obj.fields.get("text").map(_.convertTo[String])
            )
        }
      }
    }

  implicit val claudeApiToolFormat: RootJsonFormat[ClaudeApiTool] = new RootJsonFormat[ClaudeApiTool] {
    def write(t: ClaudeApiTool): JsValue = JsObject(
      "name"         -> JsString(t.name),
      "description"  -> JsString(t.description),
      "input_schema" -> t.inputSchema
    )

    // Outbound-only — mirrors claudeApiRequestFormat.read (design.md D4's "outbound-only" pattern).
    def read(json: JsValue): ClaudeApiTool =
      throw new UnsupportedOperationException("ClaudeApiTool is an outbound-only wire type")
  }

  implicit val claudeApiToolMessageFormat: RootJsonFormat[ClaudeApiToolMessage] =
    new RootJsonFormat[ClaudeApiToolMessage] {
      def write(m: ClaudeApiToolMessage): JsValue = JsObject(
        "role"    -> JsString(m.role),
        "content" -> m.content.toJson
      )

      // Outbound-only — this ticket never decodes a tool-use message it built itself.
      def read(json: JsValue): ClaudeApiToolMessage =
        throw new UnsupportedOperationException("ClaudeApiToolMessage is an outbound-only wire type")
    }

  implicit val claudeApiToolRequestFormat: RootJsonFormat[ClaudeApiToolRequest] =
    new RootJsonFormat[ClaudeApiToolRequest] {
      def write(r: ClaudeApiToolRequest): JsValue = JsObject(
        "model"       -> JsString(r.model),
        "max_tokens"  -> JsNumber(r.maxTokens),
        "messages"    -> r.messages.toJson,
        "temperature" -> JsNumber(r.temperature),
        "tools"       -> r.tools.toJson
      )

      // Outbound-only — this ticket never decodes a request it built itself (mirrors
      // claudeApiRequestFormat's identical rationale).
      def read(json: JsValue): ClaudeApiToolRequest =
        throw new UnsupportedOperationException("ClaudeApiToolRequest is an outbound-only wire type")
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
