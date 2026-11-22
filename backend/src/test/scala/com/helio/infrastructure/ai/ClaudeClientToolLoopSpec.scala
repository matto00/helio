package com.helio.infrastructure.ai

import com.helio.testkit.HelioRouteTest
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.concurrent.{ExecutionContext, Future}

/** `ClaudeClient.sendWithTools` loop behaviour (split out of `ClaudeClientSpec`, HEL-1803): hop counting, executor
 *  error recovery, usage aggregation and the mid-loop guardrail. */
class ClaudeClientToolLoopSpec extends AnyWordSpec with Matchers with HelioRouteTest with ClaudeClientTestSupport {

  "ClaudeClient.sendWithTools" should {

    "resolve FinalResponse with zero executor invocations when the first response has no tool_use" in {
      val transport    = new FakeToolTransport(Vector(Future.successful(finalTextResponse("all set"))))
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("unused")))
      val client       = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3), toolExecutor))

      outcome match {
        case ClaudeToolOutcome.FinalResponse(text, _, _) => text shouldBe "all set"
        case other                                        => fail(s"expected FinalResponse, got $other")
      }
      toolExecutor.invocations shouldBe 0
      transport.toolInvocations shouldBe 1
    }

    "invoke the executor exactly once on a single tool_use round trip, then resolve FinalResponse" in {
      val transport = new FakeToolTransport(
        Vector(
          Future.successful(toolUseResponse("toolu_1", "find", JsObject("query" -> JsString("revenue")))),
          Future.successful(finalTextResponse("found it"))
        )
      )
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("3 rows")))
      val client        = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3), toolExecutor))

      toolExecutor.invocations shouldBe 1
      toolExecutor.calls.head._1 shouldBe "find"
      outcome match {
        case ClaudeToolOutcome.FinalResponse(text, _, _) => text shouldBe "found it"
        case other                                        => fail(s"expected FinalResponse, got $other")
      }
    }

    "hard-cap at maxHops: a 4th tool_use attempt terminates gracefully, not a 5th transport call" in {
      val toolUseFuture = Future.successful(toolUseResponse("toolu_x", "find", JsObject.empty))
      val transport      = new FakeToolTransport(Vector.fill(4)(toolUseFuture))
      val toolExecutor        = new FakeToolExecutor(Future.successful(Right("ok")))
      val client          = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3), toolExecutor))

      toolExecutor.invocations shouldBe 3
      transport.toolInvocations shouldBe 4
      outcome shouldBe a[ClaudeToolOutcome.HopBudgetExhausted]
    }

    "resolve FinalResponse (not HopBudgetExhausted) when exactly maxHops tool_use round trips are followed by a final response" in {
      val toolUseFuture = Future.successful(toolUseResponse("toolu_x", "find", JsObject.empty))
      val transport = new FakeToolTransport(
        Vector(toolUseFuture, toolUseFuture, toolUseFuture, Future.successful(finalTextResponse("done")))
      )
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("ok")))
      val client   = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3), toolExecutor))

      toolExecutor.invocations shouldBe 3
      outcome match {
        case ClaudeToolOutcome.FinalResponse(text, _, _) => text shouldBe "done"
        case other                                        => fail(s"expected FinalResponse, got $other")
      }
    }

    "feed a Left executor result back as an isError tool_result and continue the loop to FinalResponse" in {
      val transport = new FakeToolTransport(
        Vector(
          Future.successful(toolUseResponse("toolu_1", "find", JsObject.empty)),
          Future.successful(finalTextResponse("recovered"))
        )
      )
      val toolExecutor = new FakeToolExecutor(Future.successful(Left("resource not found")))
      val client   = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3), toolExecutor))

      outcome match {
        case ClaudeToolOutcome.FinalResponse(text, _, _) => text shouldBe "recovered"
        case other                                        => fail(s"expected FinalResponse, got $other")
      }

      val secondRequest   = transport.toolRequests(1)
      val toolResultBlock = secondRequest.messages.last.content.find(_.blockType == "tool_result")
      toolResultBlock.flatMap(_.isError) shouldBe Some(true)
      toolResultBlock.flatMap(_.text) shouldBe Some("resource not found")
    }

    // HEL-667 design.md D3/tasks.md 7.1 — a THROWN exception (not an explicit Left) from the
    // executor still recovers to an isError tool_result and the loop continues, rather than failing
    // sendWithTools's overall Future.
    "recover a THROWN executor exception as an isError tool_result and continue the loop to FinalResponse" in {
      val transport = new FakeToolTransport(
        Vector(
          Future.successful(toolUseResponse("toolu_1", "find", JsObject.empty)),
          Future.successful(finalTextResponse("recovered from a throw"))
        )
      )
      val throwingExecutor = new ClaudeToolExecutor {
        override def execute(name: String, input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]] =
          throw new RuntimeException("executor blew up synchronously")
      }
      val client = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3), throwingExecutor))

      outcome match {
        case ClaudeToolOutcome.FinalResponse(text, _, _) => text shouldBe "recovered from a throw"
        case other                                        => fail(s"expected FinalResponse, got $other")
      }

      val secondRequest   = transport.toolRequests(1)
      val toolResultBlock = secondRequest.messages.last.content.find(_.blockType == "tool_result")
      toolResultBlock.flatMap(_.isError) shouldBe Some(true)
      toolResultBlock.flatMap(_.text) shouldBe Some("executor blew up synchronously")
    }

    // HEL-667 design.md D3/tasks.md 7.1 — a FAILED inner Future (not Future.successful(Left(...)))
    // from the executor also recovers to an isError tool_result and the loop continues.
    "recover a FAILED inner Future from the executor as an isError tool_result and continue the loop to FinalResponse" in {
      val transport = new FakeToolTransport(
        Vector(
          Future.successful(toolUseResponse("toolu_1", "find", JsObject.empty)),
          Future.successful(finalTextResponse("recovered from a failed future"))
        )
      )
      val toolExecutor = new FakeToolExecutor(Future.failed(new RuntimeException("upstream lookup timed out")))
      val client        = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3), toolExecutor))

      outcome match {
        case ClaudeToolOutcome.FinalResponse(text, _, _) => text shouldBe "recovered from a failed future"
        case other                                        => fail(s"expected FinalResponse, got $other")
      }

      val secondRequest   = transport.toolRequests(1)
      val toolResultBlock = secondRequest.messages.last.content.find(_.blockType == "tool_result")
      toolResultBlock.flatMap(_.isError) shouldBe Some(true)
      toolResultBlock.flatMap(_.text) shouldBe Some("upstream lookup timed out")
    }

    "sum usage across hops into the FinalResponse" in {
      val transport = new FakeToolTransport(
        Vector(
          Future.successful(toolUseResponse("toolu_1", "find", JsObject.empty, usage = ClaudeApiUsage(inputTokens = 20, outputTokens = 5))),
          Future.successful(finalTextResponse("done", usage = ClaudeApiUsage(inputTokens = 15, outputTokens = 8)))
        )
      )
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("ok")))
      val client   = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3), toolExecutor))

      outcome match {
        case ClaudeToolOutcome.FinalResponse(_, _, usage) => usage shouldBe TokenUsage(inputTokens = 35, outputTokens = 13)
        case other                                          => fail(s"expected FinalResponse, got $other")
      }
    }

    // assistant-prompt-caching tasks.md 4.3 (design.md D3) -- empty-tools/empty-messages guard: no
    // exception, no marker to place.
    "not fail when tools and history are both empty (guarded on non-empty)" in {
      val transport = new FakeToolTransport(Vector(Future.successful(finalTextResponse("done"))))
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("unused")))
      val client        = new ClaudeClient(config(), transport)

      val empty = ClaudeToolRequest(history = Seq.empty, tools = Seq.empty, maxHops = 3)
      val outcome = await(client.sendWithTools(empty, toolExecutor))

      outcome shouldBe a[ClaudeToolOutcome.FinalResponse]
      val built = transport.toolRequests.head
      built.tools shouldBe Seq.empty
      built.messages shouldBe Seq.empty
    }

    // assistant-prompt-caching tasks.md 4.3 (design.md D4) -- the two new cache counters aggregate
    // across hops exactly like inputTokens/outputTokens already do.
    "aggregate cache-read and cache-creation input tokens across hops into the FinalResponse" in {
      val transport = new FakeToolTransport(
        Vector(
          Future.successful(
            toolUseResponse(
              "toolu_1",
              "find",
              JsObject.empty,
              usage = ClaudeApiUsage(inputTokens = 20, outputTokens = 5, cacheCreationInputTokens = 100, cacheReadInputTokens = 0)
            )
          ),
          Future.successful(
            finalTextResponse("done", usage = ClaudeApiUsage(inputTokens = 15, outputTokens = 8, cacheCreationInputTokens = 0, cacheReadInputTokens = 100))
          )
        )
      )
      val toolExecutor = new FakeToolExecutor(Future.successful(Right("ok")))
      val client        = new ClaudeClient(config(), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3), toolExecutor))

      outcome match {
        case ClaudeToolOutcome.FinalResponse(_, _, usage) =>
          usage shouldBe TokenUsage(inputTokens = 35, outputTokens = 13, cacheCreationInputTokens = 100, cacheReadInputTokens = 100)
        case other => fail(s"expected FinalResponse, got $other")
      }
    }

    "reject a mid-loop guardrail breach with Failed(GuardrailExceeded) and no transport call for that hop" in {
      val transport = new FakeToolTransport(Vector(Future.successful(toolUseResponse("toolu_1", "find", JsObject.empty))))
      val longResult = "a very long tool result that will blow the input token budget once appended to history"
      val toolExecutor    = new FakeToolExecutor(Future.successful(Right(longResult)))
      // Sized to admit the first hop's short prompt but not the grown history once the long
      // tool_result is appended ahead of the second hop's guardrail check.
      val client = new ClaudeClient(config(maxInputTokens = 10), transport)

      val outcome = await(client.sendWithTools(toolRequest(maxHops = 3, prompt = "hi"), toolExecutor))

      outcome match {
        case ClaudeToolOutcome.Failed(ClaudeError.GuardrailExceeded(_)) => succeed
        case other                                                        => fail(s"expected Failed(GuardrailExceeded), got $other")
      }
      transport.toolInvocations shouldBe 1
    }
  }
}
