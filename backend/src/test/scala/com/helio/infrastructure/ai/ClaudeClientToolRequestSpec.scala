package com.helio.infrastructure.ai

import com.helio.testkit.HelioRouteTest
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.concurrent.Future

/** The outbound request `ClaudeClient.sendWithTools` builds (split out of `ClaudeClientSpec`, HEL-1803): the
 *  `web_search` entry and its cross-hop budget, the cache breakpoints, and the system block. */
class ClaudeClientToolRequestSpec extends AnyWordSpec with Matchers with HelioRouteTest with ClaudeClientTestSupport {

  "ClaudeClient.sendWithTools" should {

    // ── web_search wiring (HEL-757 design.md D2/D3, tasks.md 5.2-5.4) ─────────────────────────

    // tasks.md 5.2 -- webSearch = false (the default) adds nothing to the outbound tool list.
    "not add the web_search tool to the outbound request when webSearch = false (default)" in {
      val transport    = new FakeToolTransport(Vector(Future.successful(finalTextResponse("done"))))
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("unused")))
      val client        = new ClaudeClient(config(), transport)

      await(client.sendWithTools(toolRequest(maxHops = 3), toolExecutor))

      val built = transport.toolRequests.head
      built.tools should have size 1
      built.tools.collect { case ws: ClaudeApiToolSpec.WebSearch => ws } shouldBe empty
    }

    // tasks.md 5.2 -- webSearch = true adds the server tool alongside the existing custom tools.
    "add the web_search server-tool entry alongside custom tools when webSearch = true" in {
      val transport    = new FakeToolTransport(Vector(Future.successful(finalTextResponse("done"))))
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("unused")))
      val client        = new ClaudeClient(config(), transport)

      val request = toolRequest(maxHops = 3).copy(webSearch = true)
      await(client.sendWithTools(request, toolExecutor))

      val built = transport.toolRequests.head
      built.tools should have size 2
      built.tools.collect { case t: ClaudeApiTool => t } should have size 1
      built.tools.last shouldBe ClaudeApiToolSpec.WebSearch(3)
    }

    // tasks.md 5.3 -- cross-hop budget: once the cumulative web_search count reaches
    // webSearchMaxUses, the tool is dropped from a later hop's outbound request entirely,
    // independent of maxHops (mirrors claude-api-client spec.md's own scenario).
    "drop the web_search tool from a later hop's outbound request once the cross-hop budget is exhausted" in {
      def twoSearchesThenClientTool(searchId1: String, searchId2: String, toolId: String): ClaudeApiResponse =
        ClaudeApiResponse(
          id = s"msg_$searchId1",
          content = Seq(
            serverToolUseBlock(searchId1),
            webSearchToolResultBlock(searchId1),
            serverToolUseBlock(searchId2),
            webSearchToolResultBlock(searchId2),
            clientToolUseBlock(toolId, "find")
          ),
          stopReason = Some("tool_use"),
          usage = ClaudeApiUsage(10, 5)
        )

      val transport = new FakeToolTransport(
        Vector(
          Future.successful(twoSearchesThenClientTool("s1", "s2", "t1")),
          Future.successful(twoSearchesThenClientTool("s3", "s4", "t2")),
          Future.successful(finalTextResponse("done"))
        )
      )
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("ok")))
      val client        = new ClaudeClient(config(webSearchMaxUses = 2), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3).copy(webSearch = true), toolExecutor))

      outcome shouldBe a[ClaudeToolOutcome.FinalResponse]
      // Hop 1's request is built with zero searches used so far -- web_search still offered.
      transport.toolRequests(0).tools.collect { case ws: ClaudeApiToolSpec.WebSearch => ws } should have size 1
      // By hop 2, hop 1's response already fired 2 searches -- the cumulative count already reached
      // webSearchMaxUses, so the tool is omitted from hop 2's request too (not just hop 3's).
      transport.toolRequests(1).tools.collect { case ws: ClaudeApiToolSpec.WebSearch => ws } shouldBe empty
      // By hop 3, the cumulative count (>= 2) already reached webSearchMaxUses -- tool omitted entirely.
      transport.toolRequests(2).tools.collect { case ws: ClaudeApiToolSpec.WebSearch => ws } shouldBe empty
    }

    // tasks.md 5.4 (spec.md's first scenario) -- a hop containing ONLY a web_search server-tool
    // pair (no client tool_use) never reaches the executor and resolves straight to FinalResponse.
    "resolve FinalResponse with zero executor invocations when a hop contains only a web_search server-tool pair" in {
      val searchOnly = ClaudeApiResponse(
        id = "msg_search_only",
        content = Seq(serverToolUseBlock("s1"), webSearchToolResultBlock("s1"), ClaudeApiContentBlock(blockType = "text", text = Some("Found it via search"))),
        stopReason = Some("end_turn"),
        usage = ClaudeApiUsage(10, 5)
      )
      val transport    = new FakeToolTransport(Vector(Future.successful(searchOnly)))
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("unused")))
      val client        = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3).copy(webSearch = true), toolExecutor))

      toolExecutor.invocations shouldBe 0
      outcome match {
        case ClaudeToolOutcome.FinalResponse(text, _, _) => text shouldBe "Found it via search"
        case other                                         => fail(s"expected FinalResponse, got $other")
      }
    }

    // tasks.md 5.4 (spec.md's second scenario) -- a hop with BOTH a web_search server-tool pair AND
    // a client tool_use block invokes executor.execute exactly once, for the client block only; the
    // server-tool blocks are preserved in the appended history unchanged.
    "invoke the executor exactly once when a hop contains both a web_search server-tool pair and a client tool_use block" in {
      val mixedHop = ClaudeApiResponse(
        id = "msg_mixed",
        content = Seq(serverToolUseBlock("s1"), webSearchToolResultBlock("s1"), clientToolUseBlock("t1", "find")),
        stopReason = Some("tool_use"),
        usage = ClaudeApiUsage(10, 5)
      )
      val transport    = new FakeToolTransport(Vector(Future.successful(mixedHop), Future.successful(finalTextResponse("done"))))
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("3 rows")))
      val client        = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3).copy(webSearch = true), toolExecutor))

      toolExecutor.invocations shouldBe 1
      toolExecutor.calls.head._1 shouldBe "find"
      outcome match {
        case ClaudeToolOutcome.FinalResponse(_, history, _) =>
          val serverBlocks = history.flatMap(_.content).collect {
            case s: ClaudeContentBlock.ServerToolUse    => s
            case r: ClaudeContentBlock.ServerToolResult => r
          }
          serverBlocks should have size 2
        case other => fail(s"expected FinalResponse, got $other")
      }
    }

    // assistant-prompt-caching tasks.md 4.3 (design.md D3) -- toApiToolRequest marks the last tools
    // element and the last content block of the first message, and nowhere else.
    // HEL-757 tasks.md 5.7 -- re-verified against the new ClaudeApiToolSpec sealed type: `built.tools`
    // is now Seq[ClaudeApiToolSpec], so the marker assertions narrow to the ClaudeApiTool ("Custom")
    // elements specifically, rather than calling .cacheControl on the sealed trait directly.
    "mark the last tools element and the first message's last content block with a cache breakpoint" in {
      val transport = new FakeToolTransport(Vector(Future.successful(finalTextResponse("done"))))
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("unused")))
      val client        = new ClaudeClient(config(), transport)

      val multiTools = ClaudeToolRequest(
        history = Seq(ClaudeToolMessage.text(ClaudeRole.User, "help me"), ClaudeToolMessage.text(ClaudeRole.Assistant, "sure")),
        tools = Seq(findTool, ClaudeTool(name = "list", description = "List things", inputSchema = JsObject("type" -> JsString("object")))),
        maxHops = 3
      )
      await(client.sendWithTools(multiTools, toolExecutor))

      val built       = transport.toolRequests.head
      val customTools = built.tools.collect { case t: ClaudeApiTool => t }
      customTools should have size 2
      customTools.init.foreach(_.cacheControl shouldBe None)
      customTools.last.cacheControl shouldBe Some(ClaudeApiCacheControl.Ephemeral)

      val firstMessageBlocks = built.messages.head.content
      firstMessageBlocks.init.foreach(_.cacheControl shouldBe None)
      firstMessageBlocks.last.cacheControl shouldBe Some(ClaudeApiCacheControl.Ephemeral)
      built.messages.tail.foreach(_.content.foreach(_.cacheControl shouldBe None))
    }

    // HEL-757 design.md D2a/tasks.md 5.7 -- the appended WebSearch entry is NEVER a candidate for
    // the "mark the last tools element" breakpoint: the last CUSTOM tool stays marked regardless of
    // webSearch, and WebSearch itself carries no cacheControl field to set. The first-message
    // marker (unrelated to the tools array) stays unaffected on hop 1 either way.
    "mark the last custom tool -- not the appended WebSearch entry -- when webSearch = true" in {
      val transport    = new FakeToolTransport(Vector(Future.successful(finalTextResponse("done"))))
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("unused")))
      val client        = new ClaudeClient(config(), transport)

      val request = toolRequest(maxHops = 3).copy(webSearch = true)
      await(client.sendWithTools(request, toolExecutor))

      val built = transport.toolRequests.head
      built.tools should have size 2
      val customTools = built.tools.collect { case t: ClaudeApiTool => t }
      customTools should have size 1
      customTools.head.cacheControl shouldBe Some(ClaudeApiCacheControl.Ephemeral)
      built.tools.last shouldBe ClaudeApiToolSpec.WebSearch(3)

      built.messages.head.content.last.cacheControl shouldBe Some(ClaudeApiCacheControl.Ephemeral)
    }

    // HEL-757 design.md D2a's accepted trade-off/tasks.md 5.7 -- once web_search has fired, the
    // remaining budget (and therefore the WebSearch entry's own max_uses) shrinks hop-to-hop, so the
    // tools-array byte sequence genuinely differs between hop 1 and hop 2 -- the documented cache-miss
    // trade-off is real, not silently absent.
    "produce a different tools-array byte sequence on the hop after web_search first fires" in {
      val searchThenClientTool = ClaudeApiResponse(
        id = "msg_search_then_tool",
        content = Seq(serverToolUseBlock("s1"), webSearchToolResultBlock("s1"), clientToolUseBlock("t1", "find")),
        stopReason = Some("tool_use"),
        usage = ClaudeApiUsage(10, 5)
      )
      val transport = new FakeToolTransport(Vector(Future.successful(searchThenClientTool), Future.successful(finalTextResponse("done"))))
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("ok")))
      val client        = new ClaudeClient(config(webSearchMaxUses = 3), transport)

      await(client.sendWithTools(toolRequest(maxHops = 3).copy(webSearch = true), toolExecutor))

      val hop1Tools = transport.toolRequests(0).tools
      val hop2Tools = transport.toolRequests(1).tools
      hop1Tools.last shouldBe ClaudeApiToolSpec.WebSearch(3)
      hop2Tools.last shouldBe ClaudeApiToolSpec.WebSearch(2)
      hop1Tools should not be hop2Tools
    }

    // HEL-1718 D8
    "send the same marked system block on every hop and never put it in a message" in {
      val transport = new FakeToolTransport(Vector(
        Future.successful(toolUseResponse("toolu_1", "find", JsObject.empty)),
        Future.successful(finalTextResponse("done"))
      ))
      val client = new ClaudeClient(config(), transport)
      val req    = toolRequest(maxHops = 3).copy(system = Some("SYSPROMPT-XYZ"))
      await(client.sendWithTools(req, new FakeToolExecutor(Future.successful(Right("ok")))))

      val wire = transport.toolRequests.map(r => ClaudeProtocol.claudeApiToolRequestFormat.write(r).asJsObject)
      wire should have size 2
      val expected = JsArray(JsObject("type" -> JsString("text"), "text" -> JsString("SYSPROMPT-XYZ"), "cache_control" -> JsObject("type" -> JsString("ephemeral"))))
      wire.foreach { w =>
        w.fields("system") shouldBe expected
        w.fields("messages").compactPrint should not include "SYSPROMPT-XYZ"
      }
      // breakpoints: last tool, system block, first message's last block, nothing else
      transport.toolRequests.head.messages.head.content.last.cacheControl shouldBe Some(ClaudeApiCacheControl.Ephemeral)
      transport.toolRequests.head.tools.collect { case t: ClaudeApiTool => t }.last.cacheControl shouldBe Some(ClaudeApiCacheControl.Ephemeral)
      // ...and nothing else: exactly 3 cache_control markers in the whole serialized request
      "cache_control".r.findAllIn(ClaudeProtocol.claudeApiToolRequestFormat.write(transport.toolRequests.head).compactPrint).size shouldBe 3
    }

    "send no system key when the request has no system, or a blank one" in {
      val transport = new FakeToolTransport(Vector(Future.successful(finalTextResponse("a")), Future.successful(finalTextResponse("b"))))
      val client    = new ClaudeClient(config(), transport)
      val exec      = new FakeToolExecutor(Future.successful(Right("ok")))
      await(client.sendWithTools(toolRequest(maxHops = 3), exec))
      await(client.sendWithTools(toolRequest(maxHops = 3).copy(system = Some("  ")), exec))
      transport.toolRequests.foreach(r => ClaudeProtocol.claudeApiToolRequestFormat.write(r).asJsObject.fields.get("system") shouldBe None)
    }
  }
}
