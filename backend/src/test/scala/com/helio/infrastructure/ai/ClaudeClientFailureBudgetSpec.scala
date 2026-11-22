package com.helio.infrastructure.ai

import com.helio.testkit.HelioRouteTest
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.{ExecutionContext, Future}

/** The HEL-1637 failure budget, mid-loop input stop and hop ceiling of `ClaudeClient.sendWithTools` (split out of
 *  `ClaudeClientSpec`, HEL-1803). */
class ClaudeClientFailureBudgetSpec extends AnyWordSpec with Matchers with HelioRouteTest with ClaudeClientTestSupport {

  "ClaudeClient.sendWithTools" should {

    // ---- HEL-1637: failure budget, mid-loop input stop, ceiling 12 ----

    /** Fails (`Left`) every call named "bad"; every other call succeeds. */
    class BadNameExecutor extends ClaudeToolExecutor {
      val invocationCount = new AtomicInteger(0)
      override def execute(name: String, input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] = {
        invocationCount.incrementAndGet()
        Future.successful(if (name == "bad") Left(s"bad call failed") else Right("ok"))
      }
    }
    val failIsError: (ClaudeContentBlock.ToolUse, ClaudeContentBlock.ToolResult) => Option[String] =
      (_, r) => if (r.isError) Some(r.content) else None
    def budgetRequest(maxHops: Int = 12): ClaudeToolRequest =
      toolRequest(maxHops).copy(failureBudget = Some(ToolFailureBudget(3, failIsError)))
    def call(id: String, name: String): Future[ClaudeApiResponse] = Future.successful(toolUseResponse(id, name, JsObject.empty))

    "stop after the round trip with the 3rd failed call, with no further transport call (HEL-1637)" in {
      val transport = new FakeToolTransport(Vector(call("a", "bad"), call("b", "find"), call("c", "bad"), call("d", "bad"), call("never", "find")))
      val bad  = new BadNameExecutor
      val outcome   = await(new ClaudeClient(config(), transport).sendWithTools(budgetRequest(), bad))
      outcome match {
        case e: ClaudeToolOutcome.FailureBudgetExhausted =>
          e.failedCalls.map(_.name) shouldBe Seq("bad", "bad", "bad")
          e.hopsUsed shouldBe 4
          e.history.last.role shouldBe ClaudeRole.User
        case other => fail(s"expected FailureBudgetExhausted, got $other")
      }
      transport.toolInvocations shouldBe 4
      bad.invocationCount.get shouldBe 4
    }

    "complete when 2 failures are followed by success and a final answer (HEL-1637)" in {
      val transport = new FakeToolTransport(Vector(call("a", "bad"), call("b", "bad"), call("c", "find"), Future.successful(finalTextResponse("done"))))
      val outcome   = await(new ClaudeClient(config(), transport).sendWithTools(budgetRequest(), new BadNameExecutor))
      outcome match {
        case f: ClaudeToolOutcome.FinalResponse =>
          f.failedToolCalls shouldBe 2
          f.hopsUsed shouldBe 3
        case other => fail(s"expected FinalResponse, got $other")
      }
    }

    "not count once-per-response rejections as failures (HEL-1637)" in {
      val multi = ClaudeApiResponse(
        id = "msg_multi",
        content = (1 to 4).map(i => clientToolUseBlock(s"p$i", "propose")),
        stopReason = Some("tool_use"),
        usage = ClaudeApiUsage(10, 5)
      )
      val transport = new FakeToolTransport(Vector(Future.successful(multi), Future.successful(finalTextResponse("done"))))
      val bad  = new BadNameExecutor
      val request   = budgetRequest().copy(oncePerResponseTools = Set("propose"))
      val outcome   = await(new ClaudeClient(config(), transport).sendWithTools(request, bad))
      bad.invocationCount.get shouldBe 1
      outcome match {
        case f: ClaudeToolOutcome.FinalResponse => f.failedToolCalls shouldBe 0
        case other                              => fail(s"expected FinalResponse, got $other")
      }
    }

    "return every parallel result of the round trip that spends the budget (HEL-1637)" in {
      val three = ClaudeApiResponse(
        id = "msg_three",
        content = (1 to 3).map(i => clientToolUseBlock(s"b$i", "bad")),
        stopReason = Some("tool_use"),
        usage = ClaudeApiUsage(10, 5)
      )
      val transport = new FakeToolTransport(Vector(Future.successful(three)))
      val outcome   = await(new ClaudeClient(config(), transport).sendWithTools(budgetRequest(), new BadNameExecutor))
      outcome match {
        case e: ClaudeToolOutcome.FailureBudgetExhausted =>
          e.history.last.content.collect { case r: ClaudeContentBlock.ToolResult => r.toolUseId } shouldBe Seq("b1", "b2", "b3")
          e.failedToolCalls shouldBe 3
        case other => fail(s"expected FailureBudgetExhausted, got $other")
      }
      transport.toolInvocations shouldBe 1
    }

    "leave behaviour unchanged when failureBudget is None (HEL-1637)" in {
      val transport = new FakeToolTransport(Vector.fill(5)(call("a", "bad")) :+ Future.successful(finalTextResponse("done")))
      val outcome   = await(new ClaudeClient(config(), transport).sendWithTools(toolRequest(maxHops = 6), new BadNameExecutor))
      outcome shouldBe a[ClaudeToolOutcome.FinalResponse]
      transport.toolInvocations shouldBe 6
    }

    "stop mid-loop on the input limit with stopOnInputBudget, but still refuse hop 1 with zero transport calls (HEL-1637)" in {
      val big       = new FakeToolExecutor(Future.successful(Right("word " * 60)))
      val transport = new FakeToolTransport(Vector(call("a", "find"), call("never", "find")))
      val request   = toolRequest(maxHops = 5).copy(stopOnInputBudget = true)
      val outcome   = await(new ClaudeClient(config(maxInputTokens = 30), transport).sendWithTools(request, big))
      outcome match {
        case i: ClaudeToolOutcome.InputBudgetExhausted =>
          i.hopsUsed shouldBe 1
          i.history.last.role shouldBe ClaudeRole.User
        case other => fail(s"expected InputBudgetExhausted, got $other")
      }
      transport.toolInvocations shouldBe 1

      val refused = new FakeToolTransport(Vector(Future.successful(finalTextResponse("never"))))
      val first   = toolRequest(maxHops = 5).copy(stopOnInputBudget = true, system = Some("x " * 200))
      await(new ClaudeClient(config(maxInputTokens = 30), refused).sendWithTools(first, big)) match {
        case ClaudeToolOutcome.Failed(ClaudeError.GuardrailExceeded(_)) => succeed
        case other                                                       => fail(s"expected Failed(GuardrailExceeded), got $other")
      }
      refused.toolInvocations shouldBe 0

      // Default (stopOnInputBudget = false): a mid-loop overrun stays `Failed`.
      val plain = new FakeToolTransport(Vector(call("a", "find"), call("never", "find")))
      await(new ClaudeClient(config(maxInputTokens = 30), plain).sendWithTools(toolRequest(maxHops = 5), big)) match {
        case ClaudeToolOutcome.Failed(ClaudeError.GuardrailExceeded(_)) => succeed
        case other                                                       => fail(s"expected Failed(GuardrailExceeded), got $other")
      }
    }

    "execute 12 round trips and leave the 13th tool_use unexecuted at maxHops 12 (HEL-1637)" in {
      val transport = new FakeToolTransport(Vector.fill(13)(call("t", "find")))
      val bad  = new BadNameExecutor
      val outcome   = await(new ClaudeClient(config(), transport).sendWithTools(toolRequest(maxHops = 12), bad))
      outcome match {
        case h: ClaudeToolOutcome.HopBudgetExhausted => h.hopsUsed shouldBe 12
        case other                                   => fail(s"expected HopBudgetExhausted, got $other")
      }
      transport.toolInvocations shouldBe 13
      bad.invocationCount.get shouldBe 12
    }

    "omit web_search after webSearchMaxUses across more than 4 round trips (HEL-1637)" in {
      val searchThenTool = ClaudeApiResponse(
        id = "msg_s",
        content = Seq(serverToolUseBlock("s1"), webSearchToolResultBlock("s1"), clientToolUseBlock("t0", "find")),
        stopReason = Some("tool_use"),
        usage = ClaudeApiUsage(10, 5)
      )
      val transport = new FakeToolTransport(Vector(Future.successful(searchThenTool)) ++ Vector.fill(5)(call("t", "find")) :+ Future.successful(finalTextResponse("done")))
      val outcome   = await(new ClaudeClient(config(webSearchMaxUses = 1), transport).sendWithTools(toolRequest(maxHops = 12).copy(webSearch = true), new BadNameExecutor))
      outcome shouldBe a[ClaudeToolOutcome.FinalResponse]
      transport.toolRequests should have size 7
      transport.toolRequests(0).tools.collect { case ws: ClaudeApiToolSpec.WebSearch => ws } should have size 1
      transport.toolRequests.drop(1).foreach(_.tools.collect { case ws: ClaudeApiToolSpec.WebSearch => ws } shouldBe empty)
    }

    "count the system prompt in the guardrail: messages alone fit, messages plus system do not" in {
      val prompt = "hi"
      val limit  = 5
      val okTransport = new FakeToolTransport(Vector(Future.successful(finalTextResponse("fine"))))
      await(new ClaudeClient(config(maxInputTokens = limit), okTransport).sendWithTools(toolRequest(maxHops = 3, prompt = prompt), new FakeToolExecutor(Future.successful(Right("ok")))))
      okTransport.toolInvocations shouldBe 1

      val badTransport = new FakeToolTransport(Vector(Future.successful(finalTextResponse("fine"))))
      val outcome = await(new ClaudeClient(config(maxInputTokens = limit), badTransport)
        .sendWithTools(toolRequest(maxHops = 3, prompt = prompt).copy(system = Some("x" * 400)), new FakeToolExecutor(Future.successful(Right("ok")))))
      outcome match {
        case ClaudeToolOutcome.Failed(ClaudeError.GuardrailExceeded(_)) => succeed
        case other                                                        => fail(s"expected Failed(GuardrailExceeded), got $other")
      }
      badTransport.toolInvocations shouldBe 0
    }
  }
}
