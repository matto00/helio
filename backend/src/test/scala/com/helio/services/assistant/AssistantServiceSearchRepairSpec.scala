package com.helio.services.assistant

import com.helio.infrastructure.ai._
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import org.mockito.Mockito.{mock, when}
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.concurrent.duration.DurationInt
import scala.concurrent.Future

/** `AssistantService.converse` `searchedWithNoResults` signalling and the repair of a dangling `tool_use` left by a
 *  hop-cap-exhausted turn (split out of `AssistantServiceSpec`, HEL-1803). */
class AssistantServiceSearchRepairSpec extends AnyWordSpec with AssistantServiceTestSupport {

  "converse" should {

    // HEL-667 design.md D2/tasks.md 7.2, spec Scenario 1 — a zero-result find immediately followed
    // by a plain final answer (no propose_* call) sets searchedWithNoResults.
    "set searchedWithNoResults for a zero-result find followed by a plain final answer" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(outputRepo)

      val transport = new FakeToolTransport(Vector(
        Future.successful(toolUseResponse("t1", "find", findInput)),
        Future.successful(finalTextResponse("I couldn't find anything matching that — can you narrow it down?"))
      ))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Track weekly revenue", user))

      result.searchedWithNoResults shouldBe true
      result.hopBudgetExhausted shouldBe false
      result.proposal shouldBe None
    }

    // HEL-667 design.md D2/tasks.md 7.2, spec Scenario 2 — a find call that DOES return results
    // never sets the flag, even with no proposal.
    "not set searchedWithNoResults for a find call with results" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubFindWithResults(outputRepo)

      val transport = new FakeToolTransport(Vector(
        Future.successful(toolUseResponse("t1", "find", findInput)),
        Future.successful(finalTextResponse("Here's what I found; let me know what you'd like to build."))
      ))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Track weekly revenue", user))

      result.searchedWithNoResults shouldBe false
    }

    // HEL-667 design.md D2/tasks.md 7.2, spec Scenario 3 — a turn whose tool calls never include
    // find (only get_resource) never sets the flag.
    "not set searchedWithNoResults for a turn with no find call at all" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      when(outputRepo.findByIdOwned(outputId, user)).thenReturn(Future.successful(Some(pipelineOutput(outputId))))

      val transport = new FakeToolTransport(Vector(
        Future.successful(toolUseResponse("t1", "get_resource", getResourceInput(outputId.value))),
        Future.successful(finalTextResponse("Here's the detail you asked for."))
      ))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "What is this DataType?", user))

      result.searchedWithNoResults shouldBe false
    }

    // HEL-667 design.md D2 — a hop-budget-exhausted outcome never sets searchedWithNoResults, even
    // when the last (never-executed) tool_use requested was find. HEL-756: 5 scripted attempts
    // (maxHops raised to 4).
    "not set searchedWithNoResults for a hop-budget-exhausted outcome" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(outputRepo)

      val findAttempt = Future.successful(toolUseResponse("t", "find", findInput))
      val transport   = new FakeToolTransport(Vector.fill(13)(findAttempt))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Build me a sales dashboard", user))

      result.hopBudgetExhausted shouldBe true
      result.searchedWithNoResults shouldBe false
    }

    // skeptic-final-1.md CR1 (final-gate round 1, live-verified defect against the real dev backend
    // + real Claude API) — root cause: `seedHistory` unconditionally appended the new user turn as
    // plain text onto whatever `history` it was given. A conversation that just hit the hop cap
    // persists a transcript whose LAST turn is an assistant turn with an UNRESOLVED `tool_use`
    // block (exactly `ClaudeToolOutcome.HopBudgetExhausted`'s own shape) — appending a bare text
    // user turn directly after that violates the Anthropic Messages API's structural invariant that
    // a `tool_use` block must be immediately followed by a `tool_result` in the very next message,
    // so EVERY subsequent `converse` call against that conversation failed identically with a 400.
    // This test constructs that exact dangling-history shape directly (mirrors the real persisted
    // shape without needing to script a full 4-hop sequence) and asserts the outbound request
    // resolves the dangling tool_use in the immediately-following message, and that no two
    // consecutive outbound messages share the same role (the OTHER structural invariant a naive
    // "always append a separate resolving turn" fix would break, since `seedHistory` would then
    // append its own new user turn right after an already-user-role synthetic repair turn).
    "repair a dangling tool_use left by a prior hop-cap-exhausted turn before continuing the conversation" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])

      val danglingHistory = Seq(
        ClaudeToolMessage.text(ClaudeRole.User, "Build me a huge dashboard"),
        ClaudeToolMessage(ClaudeRole.Assistant, Seq(ClaudeContentBlock.ToolUse("toolu_dangling", "find", JsObject.empty)))
      )
      val transport = new FakeToolTransport(Vector(Future.successful(finalTextResponse("Sure, let's narrow it down."))))

      awaitRight(newService(outputRepo, dsRepo, transport).converse(danglingHistory, "Just show total revenue", user))

      val outboundMessages = transport.firstReceivedRequest.messages
      outboundMessages.zipWithIndex.foreach {
        case (msg, idx) =>
          msg.content.filter(_.blockType == "tool_use").flatMap(_.id).foreach { danglingId =>
            withClue(s"tool_use '$danglingId' at message $idx must be resolved in the very next message: ") {
              outboundMessages(idx + 1).content.flatMap(_.toolUseId) should contain(danglingId)
            }
          }
      }
      outboundMessages.map(_.role).sliding(2).foreach {
        case Seq(a, b) => withClue("no two consecutive outbound messages may share a role: ") { a should not be b }
        case _         => ()
      }
    }

    // HEL-667 ticket.md "Post-delivery fold-in" (tasks.md 8.1) — final-gate skeptic round 2 flagged
    // that the test above only constructs ONE dangling tool_use block; danglingToolUseIds collects
    // over the ENTIRE last turn's content via `.collect` (not `.headOption`), so this mirrors that
    // test's exact structure/assertions but with THREE unresolved tool_use blocks in the SAME
    // hop-cap-exhausted assistant turn (multi-tool-use hops are real — task 6.3's own
    // multiToolUseResponse fixture scripts one) — locks in that every dangling block gets its own
    // paired synthetic isError tool_result, not just the first.
    "repair MULTIPLE dangling tool_use blocks left by a prior hop-cap-exhausted turn before continuing the conversation" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])

      val danglingHistory = Seq(
        ClaudeToolMessage.text(ClaudeRole.User, "Build me a huge dashboard"),
        ClaudeToolMessage(
          ClaudeRole.Assistant,
          Seq(
            ClaudeContentBlock.ToolUse("toolu_dangling_1", "find", JsObject.empty),
            ClaudeContentBlock.ToolUse("toolu_dangling_2", "get_resource", getResourceInput(outputId.value)),
            ClaudeContentBlock.ToolUse("toolu_dangling_3", "find", findInput)
          )
        )
      )
      val transport = new FakeToolTransport(Vector(Future.successful(finalTextResponse("Sure, let's narrow it down."))))

      awaitRight(newService(outputRepo, dsRepo, transport).converse(danglingHistory, "Just show total revenue", user))

      val outboundMessages = transport.firstReceivedRequest.messages
      val danglingTurnIdx  = outboundMessages.indexWhere(_.content.exists(_.id.contains("toolu_dangling_1")))
      danglingTurnIdx should be >= 0
      val repairTurn = outboundMessages(danglingTurnIdx + 1)

      // Every dangling id from the assistant turn gets its OWN paired tool_result in the very next
      // message, not just the first — the exact defect class a `.headOption`-based fix would leave
      // toolu_dangling_2/3 unresolved for, which would still 400 on the very next `converse` call.
      Seq("toolu_dangling_1", "toolu_dangling_2", "toolu_dangling_3").foreach { danglingId =>
        withClue(s"tool_use '$danglingId' must be resolved in the immediately-following message: ") {
          repairTurn.content.flatMap(_.toolUseId) should contain(danglingId)
        }
      }
      // Each paired tool_result is a synthetic isError block (mirrors ClaudeClient.executeTool's own
      // recovery idiom, applied here to a never-attempted call rather than a failed one).
      repairTurn.content.count(_.blockType == "tool_result") shouldBe 3
      repairTurn.content.filter(_.blockType == "tool_result").foreach { block =>
        withClue(s"tool_result for '${block.toolUseId}' must be marked isError: ") {
          block.isError shouldBe Some(true)
        }
      }

      // The other structural invariant (strict user/assistant alternation) must still hold with
      // multiple dangling blocks folded into a single repair turn.
      outboundMessages.map(_.role).sliding(2).foreach {
        case Seq(a, b) => withClue("no two consecutive outbound messages may share a role: ") { a should not be b }
        case _         => ()
      }
    }
  }
}
