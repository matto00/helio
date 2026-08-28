package com.helio.ai

import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** Coverage for `ClaudeProtocol`'s prompt-cache wire support (assistant-prompt-caching tasks.md
 *  4.1, design.md D2/D4): `cache_control` is emitted only when a wire model's `cacheControl` field
 *  is set (for a content block of any shape, a tool, and a message — where a marked message's
 *  `content` becomes a one-element `text` block array), an unmarked value serializes byte-identical
 *  to its pre-cache-support shape, and `ClaudeApiUsage`'s cache counters parse absent-tolerantly. */
class ClaudeProtocolSpec extends AnyWordSpec with Matchers with ClaudeProtocol {


  "claudeApiMessageFormat" should {

    "serialize an unmarked message with content as a plain string (byte-identical to pre-cache-support shape)" in {
      val json = ClaudeApiMessage(role = "user", content = "What is 2+2?").toJson

      json shouldBe JsObject(
        "role"    -> JsString("user"),
        "content" -> JsString("What is 2+2?")
      )
    }

    "serialize a cache-marked message's content as a one-element text block array carrying cache_control" in {
      val json = ClaudeApiMessage(role = "user", content = "system prompt text", cacheControl = Some(ClaudeApiCacheControl.Ephemeral)).toJson

      json shouldBe JsObject(
        "role" -> JsString("user"),
        "content" -> JsArray(
          JsObject(
            "type"          -> JsString("text"),
            "text"          -> JsString("system prompt text"),
            "cache_control" -> JsObject("type" -> JsString("ephemeral"))
          )
        )
      )
    }
  }


  "claudeApiContentBlockFormat" should {

    "not include cache_control when unmarked, for a text block (byte-identical to pre-cache-support shape)" in {
      val json = ClaudeApiContentBlock(blockType = "text", text = Some("hi")).toJson

      json shouldBe JsObject("type" -> JsString("text"), "text" -> JsString("hi"))
    }

    "append cache_control to a marked text block" in {
      val json = ClaudeApiContentBlock(
        blockType = "text",
        text = Some("hi"),
        cacheControl = Some(ClaudeApiCacheControl.Ephemeral)
      ).toJson

      json shouldBe JsObject(
        "type"          -> JsString("text"),
        "text"          -> JsString("hi"),
        "cache_control" -> JsObject("type" -> JsString("ephemeral"))
      )
    }

    "append cache_control to a marked tool_result block (the shape seedHistory's first turn can carry)" in {
      val json = ClaudeApiContentBlock(
        blockType = "tool_result",
        text = Some("3 rows found"),
        toolUseId = Some("toolu_1"),
        isError = Some(false),
        cacheControl = Some(ClaudeApiCacheControl.Ephemeral)
      ).toJson

      json shouldBe JsObject(
        "type"          -> JsString("tool_result"),
        "tool_use_id"   -> JsString("toolu_1"),
        "content"       -> JsString("3 rows found"),
        "is_error"      -> JsBoolean(false),
        "cache_control" -> JsObject("type" -> JsString("ephemeral"))
      )
    }
  }


  "claudeApiToolFormat" should {

    "not include cache_control when unmarked (byte-identical to pre-cache-support shape)" in {
      val json = ClaudeApiTool(name = "find", description = "Find a resource", inputSchema = JsObject("type" -> JsString("object"))).toJson

      json shouldBe JsObject(
        "name"         -> JsString("find"),
        "description"  -> JsString("Find a resource"),
        "input_schema" -> JsObject("type" -> JsString("object"))
      )
    }

    "append cache_control to a marked tool" in {
      val json = ClaudeApiTool(
        name = "find",
        description = "Find a resource",
        inputSchema = JsObject("type" -> JsString("object")),
        cacheControl = Some(ClaudeApiCacheControl.Ephemeral)
      ).toJson

      json shouldBe JsObject(
        "name"          -> JsString("find"),
        "description"   -> JsString("Find a resource"),
        "input_schema"  -> JsObject("type" -> JsString("object")),
        "cache_control" -> JsObject("type" -> JsString("ephemeral"))
      )
    }
  }


  "claudeApiUsageFormat" should {

    "emit all four counters on write, including zero-valued cache counters" in {
      val json = ClaudeApiUsage(inputTokens = 12, outputTokens = 3).toJson

      json shouldBe JsObject(
        "input_tokens"                -> JsNumber(12),
        "output_tokens"               -> JsNumber(3),
        "cache_creation_input_tokens" -> JsNumber(0),
        "cache_read_input_tokens"     -> JsNumber(0)
      )
    }

    "parse cache counters when present in the response" in {
      val json = JsObject(
        "input_tokens"                -> JsNumber(100),
        "output_tokens"               -> JsNumber(20),
        "cache_creation_input_tokens" -> JsNumber(50),
        "cache_read_input_tokens"     -> JsNumber(75)
      )

      json.convertTo[ClaudeApiUsage] shouldBe ClaudeApiUsage(
        inputTokens = 100,
        outputTokens = 20,
        cacheCreationInputTokens = 50,
        cacheReadInputTokens = 75
      )
    }

    "default cache counters to zero when absent from the response, without failing to parse" in {
      val json = JsObject(
        "input_tokens"  -> JsNumber(10),
        "output_tokens" -> JsNumber(5)
      )

      json.convertTo[ClaudeApiUsage] shouldBe ClaudeApiUsage(inputTokens = 10, outputTokens = 5, cacheCreationInputTokens = 0, cacheReadInputTokens = 0)
    }
  }
}
