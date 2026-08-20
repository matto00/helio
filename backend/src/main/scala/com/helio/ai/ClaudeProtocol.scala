package com.helio.ai

import spray.json._

/** spray-json formatters for the wire types in `ClaudeWireModels.scala`. Written by hand (rather
 *  than the usual `jsonFormatN` macro) because the Anthropic API's JSON field names are
 *  snake_case (`max_tokens`, `input_tokens`, ...) while the Scala case classes stay idiomatic
 *  camelCase — same "hand-write a `RootJsonFormat`" pattern already used elsewhere in this
 *  codebase for field-name-mismatched shapes (e.g. `PaginationProtocol.pagedResultFormat`). */
trait ClaudeProtocol extends DefaultJsonProtocol {

  /** Hand-written (not `jsonFormat3`, design.md D2): when `cacheControl` is `None`, `content` stays
   *  a plain `JsString` — byte-identical to this format's pre-cache-support `jsonFormat2` output, and
   *  every real `send`/`stream` request today constructs `ClaudeApiMessage` this way for every
   *  message but the marked one (`ClaudeClient.toApiRequest`, design.md D3). When `cacheControl` is
   *  `Some`, `content` is written as a one-element `text` content-block array carrying
   *  `cache_control` — the Messages API accepts string-or-block-array content interchangeably, so
   *  this changes no semantics Claude observes. `read` is kept for symmetry with the prior macro
   *  behavior (content read back as a plain string) though nothing in this codebase decodes a
   *  `ClaudeApiMessage` today. */
  implicit val claudeApiMessageFormat: RootJsonFormat[ClaudeApiMessage] = new RootJsonFormat[ClaudeApiMessage] {
    def write(m: ClaudeApiMessage): JsValue = {
      val contentJson: JsValue = m.cacheControl match {
        case None => JsString(m.content)
        case Some(cc) =>
          JsArray(
            JsObject(
              "type"          -> JsString("text"),
              "text"          -> JsString(m.content),
              "cache_control" -> JsObject("type" -> JsString(cc.cacheType))
            )
          )
      }
      JsObject("role" -> JsString(m.role), "content" -> contentJson)
    }

    def read(json: JsValue): ClaudeApiMessage = {
      val obj = json.asJsObject
      ClaudeApiMessage(
        role = obj.fields.get("role").map(_.convertTo[String]).getOrElse(""),
        content = obj.fields.get("content").map(_.convertTo[String]).getOrElse("")
      )
    }
  }

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
      "input_tokens"               -> JsNumber(u.inputTokens),
      "output_tokens"              -> JsNumber(u.outputTokens),
      "cache_creation_input_tokens" -> JsNumber(u.cacheCreationInputTokens),
      "cache_read_input_tokens"     -> JsNumber(u.cacheReadInputTokens)
    )

    // Cache counters (design.md D4) parse absent-tolerantly, same idiom as input_tokens/
    // output_tokens above: the API only populates them when a request set a cache_control
    // breakpoint, so an ordinary uncached response's usage object omits both fields entirely.
    def read(json: JsValue): ClaudeApiUsage = {
      val obj = json.asJsObject
      ClaudeApiUsage(
        inputTokens = obj.fields.get("input_tokens").map(_.convertTo[Int]).getOrElse(0),
        outputTokens = obj.fields.get("output_tokens").map(_.convertTo[Int]).getOrElse(0),
        cacheCreationInputTokens = obj.fields.get("cache_creation_input_tokens").map(_.convertTo[Int]).getOrElse(0),
        cacheReadInputTokens = obj.fields.get("cache_read_input_tokens").map(_.convertTo[Int]).getOrElse(0)
      )
    }
  }

  /** Handles all five block shapes the Anthropic Messages API uses (design.md D2): plain `text`
   *  (unchanged from before this ticket), `tool_use` (Claude requesting a CLIENT tool call: `id`/
   *  `name`/`input`), `tool_result` (a caller feeding a client tool's result back: `tool_use_id`/
   *  `content`/`is_error`), and — HEL-757 design.md D2 — `server_tool_use` (Anthropic invoking one
   *  of its OWN tools, e.g. `web_search`: identical `id`/`name`/`input` shape to `tool_use`, just a
   *  different `type` discriminator) and `web_search_tool_result` (`tool_use_id` + an opaque
   *  `content` payload, carried via `serverToolResult` rather than the string-only `text` field so
   *  the result's real JSON array/object shape round-trips losslessly). The wire key for the
   *  block's textual payload varies by shape, so the mapping switches on `blockType` rather than
   *  using one fixed key for every shape. */
  implicit val claudeApiContentBlockFormat: RootJsonFormat[ClaudeApiContentBlock] =
    new RootJsonFormat[ClaudeApiContentBlock] {
      def write(b: ClaudeApiContentBlock): JsValue = {
        val typeField: Map[String, JsValue] = Map("type" -> JsString(b.blockType))
        val shapeFields: Map[String, JsValue] = b.blockType match {
          case "tool_use" | "server_tool_use" =>
            b.id.map(v => "id" -> JsString(v)).toMap ++
              b.name.map(v => "name" -> JsString(v)).toMap ++
              b.input.map(v => "input" -> v).toMap
          case "tool_result" =>
            b.toolUseId.map(v => "tool_use_id" -> JsString(v)).toMap ++
              b.text.map(v => "content" -> JsString(v)).toMap ++
              b.isError.map(v => "is_error" -> JsBoolean(v)).toMap
          case "web_search_tool_result" =>
            b.toolUseId.map(v => "tool_use_id" -> JsString(v)).toMap ++
              b.serverToolResult.map(v => "content" -> v).toMap
          case _ =>
            b.text.map(v => "text" -> JsString(v)).toMap
        }
        // cache_control (design.md D2) is orthogonal to blockType -- any block shape can carry a
        // breakpoint, so it's appended unconditionally on top of the shape-specific fields above.
        val cacheField: Map[String, JsValue] =
          b.cacheControl.map(cc => "cache_control" -> JsObject("type" -> JsString(cc.cacheType))).toMap
        JsObject(typeField ++ shapeFields ++ cacheField)
      }

      def read(json: JsValue): ClaudeApiContentBlock = {
        val obj       = json.asJsObject
        val blockType = obj.fields.get("type").map(_.convertTo[String]).getOrElse("")
        blockType match {
          case "tool_use" | "server_tool_use" =>
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
          case "web_search_tool_result" =>
            ClaudeApiContentBlock(
              blockType = blockType,
              text = None,
              toolUseId = obj.fields.get("tool_use_id").map(_.convertTo[String]),
              serverToolResult = obj.fields.get("content")
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
    def write(t: ClaudeApiTool): JsValue = {
      val cacheField: Map[String, JsValue] =
        t.cacheControl.map(cc => "cache_control" -> JsObject("type" -> JsString(cc.cacheType))).toMap
      JsObject(
        Map(
          "name"         -> JsString(t.name),
          "description"  -> JsString(t.description),
          "input_schema" -> t.inputSchema
        ) ++ cacheField
      )
    }

    // Outbound-only — mirrors claudeApiRequestFormat.read (design.md D4's "outbound-only" pattern).
    def read(json: JsValue): ClaudeApiTool =
      throw new UnsupportedOperationException("ClaudeApiTool is an outbound-only wire type")
  }

  /** Writes each [[ClaudeApiToolSpec]] case's own wire shape (HEL-757 design.md D2): a `Custom`
   *  (i.e. [[ClaudeApiTool]]) entry delegates to [[claudeApiToolFormat]] above, byte-identical to
   *  before this ticket; a `WebSearch(maxUses)` entry writes Anthropic's documented server-tool
   *  shape (`type`/`name`/`max_uses`, no `cache_control` — design.md D2a). Needed as its own
   *  implicit because `ClaudeApiToolRequest.tools: Seq[ClaudeApiToolSpec]` requires a
   *  `JsonWriter[ClaudeApiToolSpec]` to serialize, which `claudeApiToolFormat`
   *  (`RootJsonFormat[ClaudeApiTool]`) alone cannot supply for a `WebSearch` element. */
  implicit val claudeApiToolSpecFormat: RootJsonFormat[ClaudeApiToolSpec] = new RootJsonFormat[ClaudeApiToolSpec] {
    def write(t: ClaudeApiToolSpec): JsValue = t match {
      case tool: ClaudeApiTool => tool.toJson
      case ClaudeApiToolSpec.WebSearch(maxUses) =>
        JsObject(
          "type"     -> JsString("web_search_20250305"),
          "name"     -> JsString("web_search"),
          "max_uses" -> JsNumber(maxUses)
        )
    }

    // Outbound-only — mirrors claudeApiToolFormat.read (design.md D4's "outbound-only" pattern).
    def read(json: JsValue): ClaudeApiToolSpec =
      throw new UnsupportedOperationException("ClaudeApiToolSpec is an outbound-only wire type")
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
