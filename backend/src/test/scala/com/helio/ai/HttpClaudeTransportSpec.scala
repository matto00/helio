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

  private def toolRequest(messages: Seq[ClaudeApiToolMessage], tools: Seq[ClaudeApiTool] = Seq.empty): ClaudeApiToolRequest =
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
  }
}
