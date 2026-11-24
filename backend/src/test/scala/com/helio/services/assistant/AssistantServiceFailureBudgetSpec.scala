package com.helio.services.assistant

import com.helio.services.assistant.AssistantSystemPrompt
import com.helio.services.sources.SourceService
import com.helio.api.protocols.sources.TestConnectionResponse
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

/** `AssistantService.converse` hop ceiling, failure budget and mid-turn input stop (HEL-1637; split out of
 *  `AssistantServiceSpec`, HEL-1803). */
class AssistantServiceFailureBudgetSpec extends AnyWordSpec with AssistantServiceTestSupport {

  "converse" should {

    // HEL-1637 task 1.1 (red first): successful tool calls are progress, not budget. Six successful
    // round trips followed by a final answer must complete with no budget stop (today the loop is
    // cut off at hop 5).
    "complete a turn of 6 successful round trips followed by a final answer (HEL-1637)" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(outputRepo)

      val findAttempt = Future.successful(toolUseResponse("t", "find", findInput))
      val transport = new FakeToolTransport(
        Vector.fill(6)(findAttempt) :+ Future.successful(finalTextResponse("Here is what I found."))
      )

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Look around", user))

      result.hopBudgetExhausted shouldBe false
      result.text shouldBe "Here is what I found."
      transport.toolInvocations shouldBe 7
    }

    // ---- HEL-1637: failure budget, ceiling, input stop ----

    def unknownTool(id: String): Future[ClaudeApiResponse] = Future.successful(toolUseResponse(id, "no_such_tool", JsObject.empty))
    def findOk(id: String): Future[ClaudeApiResponse]      = Future.successful(toolUseResponse(id, "find", findInput))

    def roles(msgs: Seq[ClaudeToolMessage]): Seq[String] = msgs.map(_.role)

    "stop after 3 failed tool calls interleaved with successes with a plain-language message (HEL-1637)" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(outputRepo)
      val transport = new FakeToolTransport(Vector(
        unknownTool("t1"), findOk("t2"), unknownTool("t3"), findOk("t4"), unknownTool("t5"), findOk("never")
      ))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Look around", user))

      result.stopReason shouldBe "failure_budget"
      result.failedToolCalls shouldBe 3
      result.hopsUsed shouldBe 5
      transport.toolInvocations shouldBe 5
      result.hopBudgetExhausted shouldBe false
      result.text should startWith("I stopped after 3 tool calls failed.")
      result.text should include("The last error was:")
      result.text should not include "maximum number of tool calls"
      result.stopMessage shouldBe Some(result.text)
      val last = result.fullHistory.last
      last.role shouldBe ClaudeRole.Assistant
      last.content shouldBe Seq(ClaudeContentBlock.Text(result.text))
      roles(result.fullHistory).sliding(2).foreach { case Seq(a, b) => a should not be b; case _ => () }
    }

    "report an unreachable source after 3 test_connection ok:false results, never raw JSON (HEL-1637)" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      val sourceService = mock(classOf[SourceService])
      when(sourceService.testRest(any(), any()))
        .thenReturn(Future.successful(Right(TestConnectionResponse(ok = false, error = Some("DNS resolution failed")))))
      val input = JsObject("type" -> JsString("rest_api"), "config" -> JsObject("url" -> JsString("https://api.example.com/data"), "method" -> JsString("GET")))
      def tc(id: String) = Future.successful(toolUseResponse(id, "test_connection", input))
      val transport = new FakeToolTransport(Vector(tc("t1"), tc("t2"), tc("t3"), tc("never")))

      val result = awaitRight(newService(outputRepo, dsRepo, transport, sourceService).converse(Seq.empty, "Connect it", user))

      result.stopReason shouldBe "failure_budget"
      result.failedToolCalls shouldBe 3
      result.text should include("I couldn't connect to the source after 3 tries.")
      result.text should include("DNS resolution failed")
      result.text should not include "\"ok\""
      result.text should not include "{"
      transport.toolInvocations shouldBe 3
    }

    "use the proposal wording when a proposal was captured before the budget ran out (HEL-1637)" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      val transport = new FakeToolTransport(Vector(
        Future.successful(toolUseResponse("t1", "propose_pipeline", inlinePipelineProposal().toJson)),
        unknownTool("t2"), unknownTool("t3"), unknownTool("t4")
      ))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Track revenue", user))

      result.proposal shouldBe defined
      result.stopReason shouldBe "failure_budget"
      result.text should startWith("I put together a proposal, but then 3 tool calls failed.")
    }

    "make a third failure on round trip 12 a failure_budget stop, not hop_ceiling (HEL-1637)" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(outputRepo)
      val responses = Vector(unknownTool("u1"), unknownTool("u2")) ++ (3 to 11).map(i => findOk(s"f$i")) :+ unknownTool("u12") :+ findOk("never")
      val transport = new FakeToolTransport(responses)

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Look around", user))

      result.stopReason shouldBe "failure_budget"
      result.hopBudgetExhausted shouldBe false
      result.hopsUsed shouldBe 12
      transport.toolInvocations shouldBe 12
    }

    "complete after 2 failures then a final answer and report both counts (HEL-1637)" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      val transport = new FakeToolTransport(Vector(unknownTool("t1"), unknownTool("t2"), Future.successful(finalTextResponse("Done anyway."))))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Look around", user))

      result.stopReason shouldBe "final"
      result.failedToolCalls shouldBe 2
      result.hopsUsed shouldBe 2
      result.stopMessage shouldBe None
      result.text shouldBe "Done anyway."
    }

    "report hop_ceiling with its message and keep the dangling tool_use at the 12 round-trip ceiling (HEL-1637)" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(outputRepo)
      val transport = new FakeToolTransport(Vector.fill(13)(findOk("t")))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Look around", user))

      result.stopReason shouldBe "hop_ceiling"
      result.stopMessage.get should include("12 steps")
      result.text should not include "maximum number of tool calls"
      result.fullHistory.last.role shouldBe ClaudeRole.Assistant
      result.fullHistory.last.content.collect { case tu: ClaudeContentBlock.ToolUse => tu } should not be empty
    }

    "send alternating roles ending with a user turn on the next turn after a failure-budget stop (HEL-1637)" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      val first = new FakeToolTransport(Vector(unknownTool("t1"), unknownTool("t2"), unknownTool("t3")))
      val stopped = awaitRight(newService(outputRepo, dsRepo, first).converse(Seq.empty, "Look around", user))
      stopped.stopReason shouldBe "failure_budget"

      val second = new FakeToolTransport(Vector(Future.successful(finalTextResponse("Ok, retrying."))))
      awaitRight(newService(outputRepo, dsRepo, second).converse(stopped.fullHistory, "Try again", user))

      val outbound = second.firstReceivedRequest.messages.map(_.role)
      outbound.sliding(2).foreach { case Seq(a, b) => a should not be b; case _ => () }
      outbound.last shouldBe ClaudeRole.User
    }

    "stop mid-turn on the input limit keeping the work so far, while a first-request overrun is still refused (HEL-1637)" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(outputRepo)
      def est(texts: Seq[String]): Int = ClaudeTokenEstimator.estimate(texts.map(t => ClaudeMessage(ClaudeRole.User, t)))
      def sized(target: Int): Seq[ClaudeToolMessage] = {
        def total(n: Int) = est(Seq(AssistantSystemPrompt.text, "word " * n, "ok", "Look around"))
        // Largest k with total(k) <= target, by bisection (each total() tokenizes the whole input, so a one-word walk is O(n^2)).
        var lo = 0
        var hi = target + 1
        require(total(lo) <= target && total(hi) > target, s"bisection seed does not bracket target $target: total(0)=${total(lo)}, total($hi)=${total(hi)}")
        while (hi - lo > 1) {
          val mid = lo + (hi - lo) / 2
          if (total(mid) <= target) lo = mid else hi = mid
        }
        val k = lo
        require(total(k) <= target && total(k + 1) > target, s"sized($target) is not the boundary: total($k)=${total(k)}, total(${k + 1})=${total(k + 1)}")
        Seq(ClaudeToolMessage.text(ClaudeRole.User, "word " * k), ClaudeToolMessage.text(ClaudeRole.Assistant, "ok"))
      }

      val near = new FakeToolTransport(Vector(findOk("t1"), Future.successful(finalTextResponse("never"))))
      val stopped = awaitRight(newService(outputRepo, dsRepo, near).converse(sized(config().maxInputTokens - 5), "Look around", user))
      stopped.stopReason shouldBe "input_budget"
      stopped.hopsUsed shouldBe 1
      near.toolInvocations shouldBe 1
      stopped.text should include("too long")
      stopped.fullHistory.last.role shouldBe ClaudeRole.Assistant
      stopped.fullHistory.exists(_.content.exists(_.isInstanceOf[ClaudeContentBlock.ToolResult])) shouldBe true

      val over = new FakeToolTransport(Vector(Future.successful(finalTextResponse("never"))))
      await(newService(outputRepo, dsRepo, over).converse(sized(config().maxInputTokens + 50), "Look around", user)) match {
        case Left(ClaudeError.GuardrailExceeded(_)) => succeed
        case other                                  => fail(s"expected GuardrailExceeded, got $other")
      }
      over.toolInvocations shouldBe 0
    }

    "count only this turn's failed calls, never the synthetic results that repair a previous turn's dangling tool_use (HEL-1637)" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      val danglingHistory = Seq(
        ClaudeToolMessage.text(ClaudeRole.User, "Build me a huge dashboard"),
        ClaudeToolMessage(ClaudeRole.Assistant, Seq(ClaudeContentBlock.ToolUse("toolu_dangling", "find", JsObject.empty)))
      )
      val transport = new FakeToolTransport(Vector(Future.successful(finalTextResponse("Fine."))))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(danglingHistory, "Just show total revenue", user))

      result.failedToolCalls shouldBe 0
      result.stopReason shouldBe "final"
    }

    "word the stop by the failed tools: proposals and workspace reads (HEL-1637)" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      def bad(name: String, input: JsValue) = Future.successful(toolUseResponse("t", name, input))

      val proposals = new FakeToolTransport(Vector.fill(4)(bad("propose_dashboard", JsObject("dashboardName" -> JsNumber(1)))))
      awaitRight(newService(outputRepo, dsRepo, proposals).converse(Seq.empty, "Build it", user)).text should
        startWith("I couldn't put together a valid proposal after 3 tries.")

      val reads = new FakeToolTransport(Vector.fill(4)(bad("get_resource", JsObject.empty)))
      awaitRight(newService(outputRepo, dsRepo, reads).converse(Seq.empty, "Read it", user)).text should
        startWith("I couldn't read what I needed from your workspace after 3 tries.")
    }
  }
}
