package com.helio.ai

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.HttpEntity
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** Coverage for `HttpClaudeTransport`'s tool-use request shape (HEL-660 tasks.md 4.10) — a
 *  request-shape assertion only, no real network call: `buildHttpRequest(ClaudeApiToolRequest)` is
 *  `private[ai]` precisely so this spec can inspect the built `HttpRequest`'s JSON entity directly,
 *  without ever invoking `sendTool` (which would perform a real HTTP round trip). Mirrors
 *  `ClaudeClientSpec`'s "hand-written fake, zero real network calls" philosophy at the transport
 *  layer instead of the client layer. */
class HttpClaudeTransportSpec extends AnyWordSpec with Matchers with ScalatestRouteTest {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private val transport = new HttpClaudeTransport("sk-ant-test-key-should-never-be-logged")

  private def bodyJson(request: ClaudeApiToolRequest): JsObject =
    transport.buildHttpRequest(request).entity match {
      case HttpEntity.Strict(_, data) => data.utf8String.parseJson.asJsObject
      case other                      => fail(s"expected a strict JSON entity, got $other")
    }

  private def bodyJson(request: ClaudeApiRequest): JsObject =
    transport.buildHttpRequest(request).entity match {
      case HttpEntity.Strict(_, data) => data.utf8String.parseJson.asJsObject
      case other                      => fail(s"expected a strict JSON entity, got $other")
    }

  // Seq[ClaudeApiToolSpec] (HEL-757 design.md D2) -- widened from Seq[ClaudeApiTool] so a caller can
  // also pass a ClaudeApiToolSpec.WebSearch entry; every existing Seq[ClaudeApiTool]-typed call site
  // above keeps compiling unchanged (Seq is covariant).
  private def toolRequest(messages: Seq[ClaudeApiToolMessage], tools: Seq[ClaudeApiToolSpec] = Seq.empty): ClaudeApiToolRequest =
    ClaudeApiToolRequest(model = "claude-opus-4-8", maxTokens = 512, messages = messages, temperature = 1.0, tools = tools)

  "HttpClaudeTransport.buildHttpRequest(ClaudeApiToolRequest)" should {

    "carry model/max_tokens/temperature through, with no stream field" in {
      val json = bodyJson(toolRequest(Seq.empty))

      json.fields("model") shouldBe JsString("claude-opus-4-8")
      json.fields("max_tokens") shouldBe JsNumber(512)
      json.fields("temperature") shouldBe JsNumber(1.0)
      json.fields.contains("stream") shouldBe false
    }

    "serialize the tools list with name/description/input_schema" in {
      val tool = ClaudeApiTool(name = "find", description = "Find a resource", inputSchema = JsObject("type" -> JsString("object")))
      val json = bodyJson(toolRequest(Seq.empty, tools = Seq(tool)))

      json.fields("tools") shouldBe JsArray(
        JsObject(
          "name"         -> JsString("find"),
          "description"  -> JsString("Find a resource"),
          "input_schema" -> JsObject("type" -> JsString("object"))
        )
      )
    }

    // HEL-757 design.md D2/tasks.md 1.2 -- Anthropic's server-side web_search tool wire shape,
    // verified against Anthropic's official Python SDK (PyPI package `anthropic`, v0.86.0;
    // github.com/anthropics/anthropic-sdk-python) type definitions: WebSearchTool20250305Param
    // during Execution: {"type": "web_search_20250305", "name": "web_search", "max_uses": N},
    // alongside (not replacing) any ordinary custom tools already in the request.
    "serialize a WebSearch entry alongside a custom tool with type/name/max_uses" in {
      val customTool = ClaudeApiTool(name = "find", description = "Find a resource", inputSchema = JsObject("type" -> JsString("object")))
      val json        = bodyJson(toolRequest(Seq.empty, tools = Seq(customTool, ClaudeApiToolSpec.WebSearch(3))))

      json.fields("tools") shouldBe JsArray(
        JsObject(
          "name"         -> JsString("find"),
          "description"  -> JsString("Find a resource"),
          "input_schema" -> JsObject("type" -> JsString("object"))
        ),
        JsObject(
          "type"     -> JsString("web_search_20250305"),
          "name"     -> JsString("web_search"),
          "max_uses" -> JsNumber(3)
        )
      )
    }

    // HEL-757 design.md D2 -- server_tool_use/web_search_tool_result blocks round-trip through the
    // same message-content-array shape tool_use/tool_result already do.
    "serialize a server_tool_use block with id/name/input" in {
      val block = ClaudeApiContentBlock(
        blockType = "server_tool_use",
        text = None,
        id = Some("srvtoolu_1"),
        name = Some("web_search"),
        input = Some(JsObject("query" -> JsString("ESPN API docs")))
      )
      val message = ClaudeApiToolMessage("assistant", Seq(block))
      val json     = bodyJson(toolRequest(Seq(message)))

      json.fields("messages") shouldBe JsArray(
        JsObject(
          "role" -> JsString("assistant"),
          "content" -> JsArray(
            JsObject(
              "type"  -> JsString("server_tool_use"),
              "id"    -> JsString("srvtoolu_1"),
              "name"  -> JsString("web_search"),
              "input" -> JsObject("query" -> JsString("ESPN API docs"))
            )
          )
        )
      )
    }

    "serialize a web_search_tool_result block with tool_use_id/content, never lossily stringified" in {
      val resultContent = JsArray(JsObject("url" -> JsString("https://example.com"), "title" -> JsString("Docs")))
      val block = ClaudeApiContentBlock(
        blockType = "web_search_tool_result",
        text = None,
        toolUseId = Some("srvtoolu_1"),
        serverToolResult = Some(resultContent)
      )
      val message = ClaudeApiToolMessage("user", Seq(block))
      val json     = bodyJson(toolRequest(Seq(message)))

      json.fields("messages") shouldBe JsArray(
        JsObject(
          "role" -> JsString("user"),
          "content" -> JsArray(
            JsObject(
              "type"        -> JsString("web_search_tool_result"),
              "tool_use_id" -> JsString("srvtoolu_1"),
              "content"     -> resultContent
            )
          )
        )
      )
    }

    "serialize a plain text block the same way send/stream already do" in {
      val message = ClaudeApiToolMessage("user", Seq(ClaudeApiContentBlock(blockType = "text", text = Some("hi"))))
      val json     = bodyJson(toolRequest(Seq(message)))

      json.fields("messages") shouldBe JsArray(
        JsObject("role" -> JsString("user"), "content" -> JsArray(JsObject("type" -> JsString("text"), "text" -> JsString("hi"))))
      )
    }

    "serialize a tool_use block with id/name/input" in {
      val block = ClaudeApiContentBlock(
        blockType = "tool_use",
        text = None,
        id = Some("toolu_1"),
        name = Some("find"),
        input = Some(JsObject("query" -> JsString("revenue")))
      )
      val message = ClaudeApiToolMessage("assistant", Seq(block))
      val json     = bodyJson(toolRequest(Seq(message)))

      json.fields("messages") shouldBe JsArray(
        JsObject(
          "role" -> JsString("assistant"),
          "content" -> JsArray(
            JsObject(
              "type"  -> JsString("tool_use"),
              "id"    -> JsString("toolu_1"),
              "name"  -> JsString("find"),
              "input" -> JsObject("query" -> JsString("revenue"))
            )
          )
        )
      )
    }

    "serialize a tool_result block with tool_use_id/content/is_error" in {
      val block = ClaudeApiContentBlock(
        blockType = "tool_result",
        text = Some("3 rows found"),
        toolUseId = Some("toolu_1"),
        isError = Some(false)
      )
      val message = ClaudeApiToolMessage("user", Seq(block))
      val json     = bodyJson(toolRequest(Seq(message)))

      json.fields("messages") shouldBe JsArray(
        JsObject(
          "role" -> JsString("user"),
          "content" -> JsArray(
            JsObject(
              "type"         -> JsString("tool_result"),
              "tool_use_id"  -> JsString("toolu_1"),
              "content"      -> JsString("3 rows found"),
              "is_error"     -> JsBoolean(false)
            )
          )
        )
      )
    }

    // assistant-prompt-caching tasks.md 4.2 (design.md D6) -- a request already carrying the
    // breakpoint markers ClaudeClient.toApiToolRequest would set (last tools element, last content
    // block of the first message) serializes with cache_control on exactly those two locations and
    // nowhere else.
    "carry cache_control on the last tools element and the first message's last content block only, when marked" in {
      val plainTool  = ClaudeApiTool(name = "list", description = "List things", inputSchema = JsObject("type" -> JsString("object")))
      val markedTool = ClaudeApiTool(
        name = "find",
        description = "Find a resource",
        inputSchema = JsObject("type" -> JsString("object")),
        cacheControl = Some(ClaudeApiCacheControl.Ephemeral)
      )

      val firstMessage = ClaudeApiToolMessage(
        "user",
        Seq(
          ClaudeApiContentBlock(blockType = "text", text = Some("system prompt + goal")),
          ClaudeApiContentBlock(blockType = "text", text = Some("last block of first turn"), cacheControl = Some(ClaudeApiCacheControl.Ephemeral))
        )
      )
      val secondMessage = ClaudeApiToolMessage("assistant", Seq(ClaudeApiContentBlock(blockType = "text", text = Some("a later, unmarked turn"))))

      val json = bodyJson(toolRequest(Seq(firstMessage, secondMessage), tools = Seq(plainTool, markedTool)))

      val toolsJson = json.fields("tools").asInstanceOf[JsArray].elements
      toolsJson.head.asJsObject.fields.contains("cache_control") shouldBe false
      toolsJson.last.asJsObject.fields("cache_control") shouldBe JsObject("type" -> JsString("ephemeral"))

      val messagesJson  = json.fields("messages").asInstanceOf[JsArray].elements
      val firstContent  = messagesJson.head.asJsObject.fields("content").asInstanceOf[JsArray].elements
      val secondContent = messagesJson.last.asJsObject.fields("content").asInstanceOf[JsArray].elements
      firstContent.head.asJsObject.fields.contains("cache_control") shouldBe false
      firstContent.last.asJsObject.fields("cache_control") shouldBe JsObject("type" -> JsString("ephemeral"))
      secondContent.head.asJsObject.fields.contains("cache_control") shouldBe false
    }
  }

  private def apiRequest(messages: Seq[ClaudeApiMessage]): ClaudeApiRequest =
    ClaudeApiRequest(model = "claude-opus-4-8", maxTokens = 512, messages = messages, temperature = 1.0, stream = false)

  "HttpClaudeTransport.buildHttpRequest(ClaudeApiRequest)" should {

    // assistant-prompt-caching tasks.md 4.2 (design.md D6) -- send's request shape, with the
    // first-message marker ClaudeClient.toApiRequest would set.
    "carry the first-message block-array cache_control marker when marked" in {
      val marked = ClaudeApiMessage(role = "user", content = "system prompt text", cacheControl = Some(ClaudeApiCacheControl.Ephemeral))
      val json    = bodyJson(apiRequest(Seq(marked)))

      json.fields("messages") shouldBe JsArray(
        JsObject(
          "role" -> JsString("user"),
          "content" -> JsArray(
            JsObject(
              "type"          -> JsString("text"),
              "text"          -> JsString("system prompt text"),
              "cache_control" -> JsObject("type" -> JsString("ephemeral"))
            )
          )
        )
      )
    }

    "leave an unmarked request's JSON unchanged (plain string content, no cache_control anywhere)" in {
      val unmarked = ClaudeApiMessage(role = "user", content = "What is 2+2?")
      val json      = bodyJson(apiRequest(Seq(unmarked)))

      json shouldBe JsObject(
        "model"       -> JsString("claude-opus-4-8"),
        "max_tokens"  -> JsNumber(512),
        "messages"    -> JsArray(JsObject("role" -> JsString("user"), "content" -> JsString("What is 2+2?"))),
        "temperature" -> JsNumber(1.0),
        "stream"      -> JsBoolean(false)
      )
    }
  }
}
