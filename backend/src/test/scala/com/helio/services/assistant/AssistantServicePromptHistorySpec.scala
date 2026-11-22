package com.helio.services.assistant

import com.helio.api.protocols.pipelines.{PipelineProposalSource, ProposalRestApiConfig}
import com.helio.api.protocols.assistant.AssistantTurnResult
import com.helio.api.protocols.pipelines.PipelineProposal
import com.helio.services.assistant.AssistantSystemPrompt
import com.helio.infrastructure.ai._
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.{mock, when}
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.concurrent.duration.DurationInt
import scala.concurrent.Future

/** `AssistantService.converse` system prompt placement, `fullHistory`, transport errors and the always-on `web_search`
 *  (split out of `AssistantServiceSpec`, HEL-1803). */
class AssistantServicePromptHistorySpec extends AnyWordSpec with AssistantServiceTestSupport {

  "converse" should {

    // Task 6.1 (HEL-665 design.md D1) — a FinalResponse outcome's fullHistory includes the
    // original (empty) history, the new user message turn, and Claude's final response turn, in
    // order. Also locks in evaluation-1.md CR1 (cycle 2): the first turn's content is EXACTLY the
    // caller-supplied message, never AssistantSystemPrompt.text folded in.
    "populate fullHistory with the new user turn and Claude's final response, in order" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])

      val transport = new FakeToolTransport(Vector(
        Future.successful(finalTextResponse("Here you go."))
      ))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Hello", user))

      result.fullHistory should have size 2
      result.fullHistory.head.role shouldBe ClaudeRole.User
      result.fullHistory.head.content shouldBe Seq(ClaudeContentBlock.Text("Hello"))
      result.fullHistory.last.role shouldBe ClaudeRole.Assistant
      result.fullHistory.last.content should contain(ClaudeContentBlock.Text("Here you go."))
    }

    // evaluation-1.md Change Request 1 (cycle 2, live-verified defect) — dedicated regression
    // coverage. Root cause: `seedHistory` folds `AssistantSystemPrompt.text + "\n\n" + message`
    // into the SAME ClaudeToolMessage used as the first turn whenever the caller-supplied `history`
    // is empty (a brand-new conversation's first message — exactly AC4's own scenario); before the
    // fix, that literal seeded text flowed straight through into `AssistantTurnResult.fullHistory`
    // (now persisted via `AssistantConversationRoutes.converseFlow`'s `appendTurn` and rendered
    // verbatim by `MessageTurn.tsx`). This test asserts BOTH sides of the fix: the RETURNED/
    // persisted value never leaks the system prompt, AND the OUTBOUND request Claude actually
    // receives still carries it unchanged (no regression to response quality).
    "never leak AssistantSystemPrompt.text into fullHistory's first turn for an empty-history call, while the outbound request to Claude is unaffected" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])

      val transport = new FakeToolTransport(Vector(
        Future.successful(finalTextResponse("Hi there!"))
      ))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "What's our revenue?", user))

      // RETURNED/persisted/rendered value: exactly the typed message, nothing else.
      result.fullHistory.head.content shouldBe Seq(ClaudeContentBlock.Text("What's our revenue?"))

      // OUTBOUND request Claude actually received (HEL-1718): the system prompt travels in the API
      // `system` field, never folded into the first message.
      val outboundFirstTurnText = transport.firstReceivedRequest.messages.head.content.flatMap(_.text).mkString
      outboundFirstTurnText shouldBe "What's our revenue?"
    }

    // HEL-1718 D8 — asserts on the SERIALIZED request JSON (not a Scala field) so these compile and
    // fail on the unfixed code.
    def systemOf(req: ClaudeApiToolRequest): Option[JsValue] =
      ClaudeProtocol.claudeApiToolRequestFormat.write(req).asJsObject.fields.get("system")
    def messagesJson(req: ClaudeApiToolRequest): String =
      ClaudeProtocol.claudeApiToolRequestFormat.write(req).asJsObject.fields("messages").compactPrint
    // The prompt as it appears inside serialized JSON (newlines/quotes escaped); a raw-text check could never match.
    val escapedPrompt: String = JsString(AssistantSystemPrompt.text).compactPrint.drop(1).dropRight(1)
    val expectedSystem: JsValue = JsArray(JsObject(
      "type"          -> JsString("text"),
      "text"          -> JsString(AssistantSystemPrompt.text),
      "cache_control" -> JsObject("type" -> JsString("ephemeral"))
    ))

    "send the system prompt in the system field on turn 2, identical to turn 1, never in any message (HEL-1718)" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      val transport = new FakeToolTransport(Vector(
        Future.successful(finalTextResponse("First answer.")),
        Future.successful(finalTextResponse("Second answer."))
      ))
      val service = newService(outputRepo, dsRepo, transport)

      val turn1 = awaitRight(service.converse(Seq.empty, "Hello", user))
      val turn2 = awaitRight(service.converse(turn1.fullHistory, "And again", user))

      val Vector(req1, req2) = transport.allReceivedRequests
      systemOf(req1) shouldBe Some(expectedSystem)
      systemOf(req2) shouldBe Some(expectedSystem)
      systemOf(req2) shouldBe systemOf(req1)
      messagesJson(req1) should not include escapedPrompt
      messagesJson(req2) should not include escapedPrompt
      turn1.fullHistory.toString should not include AssistantSystemPrompt.text
      turn2.fullHistory.toString should not include AssistantSystemPrompt.text
      turn2.fullHistory.head.content shouldBe Seq(ClaudeContentBlock.Text("Hello"))
    }

    "send the system prompt on every hop of a multi-hop turn (HEL-1718)" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(outputRepo)
      val transport = new FakeToolTransport(Vector(
        Future.successful(toolUseResponse("t1", "find", findInput)),
        Future.successful(finalTextResponse("Nothing found."))
      ))
      awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Find orders", user))

      val reqs = transport.allReceivedRequests
      reqs should have size 2
      reqs.foreach(r => systemOf(r) shouldBe Some(expectedSystem))
    }

    "send the system prompt for a legacy conversation whose turn 1 is the plain user message (HEL-1718)" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      val transport = new FakeToolTransport(Vector(Future.successful(finalTextResponse("Welcome back."))))
      val legacy = Seq(
        ClaudeToolMessage.text(ClaudeRole.User, "Legacy first message"),
        ClaudeToolMessage.text(ClaudeRole.Assistant, "Legacy answer")
      )

      awaitRight(newService(outputRepo, dsRepo, transport).converse(legacy, "Next question", user))

      val req = transport.firstReceivedRequest
      systemOf(req) shouldBe Some(expectedSystem)
      messagesJson(req) should not include escapedPrompt
    }

    // Task 6.2 (HEL-665 design.md D1) — fullHistory is populated (not empty/partial) even when the
    // hop budget is exhausted, mirroring task 6.7's own 5-tool_use-attempt scripted sequence
    // (HEL-756: maxHops raised to 4).
    "populate fullHistory even when the hop budget is exhausted" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(outputRepo)

      val findAttempt = Future.successful(toolUseResponse("t", "find", findInput))
      val transport   = new FakeToolTransport(Vector.fill(13)(findAttempt))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Build me a sales dashboard", user))

      result.hopBudgetExhausted shouldBe true
      result.fullHistory should not be empty
      result.fullHistory.size should be > 1
    }

    // Task 6.2a (HEL-665 design.md D1, design-gate round-1 fix) — a ClaudeToolOutcome.Failed
    // outcome (here: a transport-level API failure) yields Left(claudeError), never a value-less
    // or fabricated Right(AssistantTurnResult).
    "yield Left(claudeError) for a real transport/API failure, never a fabricated result" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])

      val transport = new FakeToolTransport(Vector(
        Future.failed(ClaudeApiException(500, "internal server error"))
      ))

      val result = await(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Hello", user))

      result shouldBe Left(ClaudeError.ApiError(500, "internal server error"))
    }

    // HEL-757 design.md D1/tasks.md 5.5 -- every converse call offers web_search unconditionally,
    // never gated on message content/intent -- even for a goal with nothing to do with an external
    // API (find/get_resource only, no propose_* call).
    "set webSearch = true on every outbound request, regardless of message content" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(outputRepo)

      val transport = new FakeToolTransport(Vector(
        Future.successful(toolUseResponse("t1", "find", findInput)),
        Future.successful(finalTextResponse("Here's what I found."))
      ))

      awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "What data do we have?", user))

      val outboundTools = transport.firstReceivedRequest.tools
      outboundTools.collect { case ws: ClaudeApiToolSpec.WebSearch => ws } should have size 1
    }

    // HEL-757 tasks.md 5.6, assistant-web-research spec.md's "still enforces the existing
    // test_connection requirement unchanged" -- a preceding web_search call earlier in the SAME hop
    // does not bypass HEL-756's structural test_connection gate: propose_pipeline for an untested
    // inline REST source is still rejected identically, exactly as it would be with no preceding
    // search at all (AssistantToolExecutorSpec's own "reject propose_pipeline for an untested
    // inline rest_api source" coverage, replayed here with a web_search call ahead of it in history).
    "still enforce the existing test_connection requirement for a REST-source proposal after a preceding web_search call" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])

      val restSource = PipelineProposalSource(
        sourceId = None,
        `type` = Some("rest_api"),
        name = Some("Inline REST"),
        csvConfig = None,
        restConfig = Some(ProposalRestApiConfig(url = Some("https://api.example.com/data"), method = Some("GET"), headers = None)),
        sqlConfig = None,
        staticConfig = None
      )
      val restProposal = PipelineProposal("REST Pipeline", Vector(restSource), steps = Vector.empty, outputs = Vector.empty)

      val searchThenProposeHop = ClaudeApiResponse(
        id = "msg_search_then_propose",
        content = Seq(
          ClaudeApiContentBlock(
            blockType = "server_tool_use",
            text = None,
            id = Some("s1"),
            name = Some("web_search"),
            input = Some(JsObject("query" -> JsString("example API docs")))
          ),
          ClaudeApiContentBlock(blockType = "web_search_tool_result", text = None, toolUseId = Some("s1"), serverToolResult = Some(JsArray.empty)),
          ClaudeApiContentBlock(blockType = "tool_use", text = None, id = Some("t1"), name = Some("propose_pipeline"), input = Some(restProposal.toJson))
        ),
        stopReason = Some("tool_use"),
        usage = ClaudeApiUsage(10, 5)
      )

      val transport = new FakeToolTransport(Vector(
        Future.successful(searchThenProposeHop),
        Future.successful(finalTextResponse("Please verify this source with test_connection first."))
      ))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Build a pipeline from this REST API", user))

      result.proposal shouldBe None
      result.proposeAttempts shouldBe 1
      result.proposeValidationFailures shouldBe 1
      transport.toolInvocations shouldBe 2
    }
  }
}
