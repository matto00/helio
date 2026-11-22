package com.helio.services.assistant

import com.helio.api.protocols.assistant.{AssistantProposal, AssistantProtocol}
import com.helio.services.proposals.DashboardProposalService
import com.helio.services.assistant.AssistantService
import com.helio.infrastructure.ai._
import com.helio.domain.model._
import com.helio.infrastructure.persistence.sources.DataSourceRepository
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import org.mockito.Mockito.{mock, when}
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

import scala.concurrent.duration.DurationInt
import scala.concurrent.Future

/** Coverage for `AssistantService.converse` (HEL-662 tasks.md 6.3-6.8, 6.12) against a hand-written
 *  fake `ClaudeTransport` -- mirrors `ClaudeClientSpec`'s own `FakeToolTransport` fixture style
 *  exactly. Zero real network calls anywhere in this suite (task 6.10): every test builds its
 *  `AssistantService` over a `FakeToolTransport`, never `HttpClaudeTransport`, and every underlying
 *  repository is a Mockito mock, never a real database connection. Its fixtures live in
 *  `AssistantServiceTestSupport`; the failure-budget, search/repair and prompt/history tests live in the
 *  `AssistantService*Spec` siblings (HEL-1803). */
class AssistantServiceSpec extends AnyWordSpec with AssistantServiceTestSupport {

  "converse" should {

    // Task 6.3 — find and propose_dashboard scripted as a SINGLE hop's two tool_use blocks
    // (`ClaudeClient.sendWithTools` executes every tool_use in one hop concurrently via
    // Future.traverse), so only 2 transport invocations happen: hop 1 (both tool calls), hop 2
    // (final text) — matching the task's own "fake transport invoked exactly twice".
    "produce a dashboard proposal from a scripted find + propose_dashboard sequence" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(outputRepo)
      when(outputRepo.findByIdOwned(outputId, user)).thenReturn(Future.successful(Some(pipelineOutput(outputId))))

      val expected  = dashboardProposal(outputId.value)
      val transport = new FakeToolTransport(Vector(
        Future.successful(multiToolUseResponse(Seq(("t1", "find", findInput), ("t2", "propose_dashboard", expected.toJson)))),
        Future.successful(finalTextResponse("Here's your dashboard proposal."))
      ))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Build me a sales dashboard", user))

      result.proposal shouldBe Some(AssistantProposal.Dashboard(expected))
      transport.toolInvocations shouldBe 2

      // HEL-700 tasks.md 3.4 (design.md D5) — a FinalResponse outcome carries the executor's own
      // propose-call counters: one clean attempt, zero failures.
      result.proposeAttempts shouldBe 1
      result.proposeDecodeFailures shouldBe 0
      result.proposeValidationFailures shouldBe 0
    }

    // Task 6.4 — find turns up nothing, then propose_pipeline succeeds; no AssistantService code
    // path is special-cased on find's emptiness (this test scripts the tool sequence via the fake
    // transport only — AssistantService.converse/AssistantToolExecutor.execute never branch on
    // find's result at all, confirmed by code review of both files).
    "produce a pipeline proposal from a scripted empty find + propose_pipeline sequence" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(outputRepo)

      val expected  = inlinePipelineProposal()
      val transport = new FakeToolTransport(Vector(
        Future.successful(toolUseResponse("t1", "find", findInput)),
        Future.successful(toolUseResponse("t2", "propose_pipeline", expected.toJson)),
        Future.successful(finalTextResponse("No existing data — proposing a new pipeline."))
      ))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Track weekly revenue", user))

      result.proposal shouldBe Some(AssistantProposal.Pipeline(expected))
      transport.toolInvocations shouldBe 3
    }

    // Task 6.5 — find + get_resource only, ending in a text-only final response: no propose_* call
    // ever happens, so proposal stays None.
    "produce proposal = None for a find/get_resource-only sequence with a final text-only response" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(outputRepo)
      when(outputRepo.findByIdOwned(outputId, user)).thenReturn(Future.successful(Some(pipelineOutput(outputId))))

      val transport = new FakeToolTransport(Vector(
        Future.successful(toolUseResponse("t1", "find", findInput)),
        Future.successful(toolUseResponse("t2", "get_resource", getResourceInput(outputId.value))),
        Future.successful(finalTextResponse("Here's what I found; let me know what you'd like to build."))
      ))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "What data do we have?", user))

      result.proposal shouldBe None
      result.text should include("what you'd like to build")
    }

    // Task 6.6 — a rejected propose_dashboard is fed back as an isError tool_result and the loop
    // continues to a LATER successful propose_pipeline; the side channel only records the eventual
    // success, never the earlier rejected attempt.
    "record only the eventual success when an earlier propose_dashboard attempt is rejected" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      // The rejected attempt's outputId resolves to nothing -> DashboardProposalService.validate
      // rejects it (BadRequest), never touching the side channel.
      when(outputRepo.findByIdOwned(outputId, user)).thenReturn(Future.successful(None))

      val rejected = dashboardProposal(outputId.value)
      val accepted = inlinePipelineProposal("Recovered Pipeline")
      val transport = new FakeToolTransport(Vector(
        Future.successful(toolUseResponse("t1", "propose_dashboard", rejected.toJson)),
        Future.successful(toolUseResponse("t2", "propose_pipeline", accepted.toJson)),
        Future.successful(finalTextResponse("Proposing a new pipeline instead."))
      ))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Build me a sales dashboard", user))

      result.proposal shouldBe Some(AssistantProposal.Pipeline(accepted))
    }

    // Task 6.7 (HEL-756 tasks.md 2.8 — maxHops raised 3 -> 4): hard cap mirrors ClaudeClientSpec's
    // own hard-cap fixture style. maxHops = 4 is fixed inside AssistantService (never
    // test-configurable) — a 5th tool_use attempt terminates gracefully via HopBudgetExhausted, not
    // a 6th transport call.
    "resolve a hop-budget-exhausted result for a 13-tool_use-attempt sequence (ceiling 12, HEL-1637)" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      stubEmptyFind(outputRepo)

      val findAttempt = Future.successful(toolUseResponse("t", "find", findInput))
      val transport   = new FakeToolTransport(Vector.fill(13)(findAttempt))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Build me a sales dashboard", user))

      result.hopBudgetExhausted shouldBe true
      result.proposal shouldBe None
      result.stopReason shouldBe "hop_ceiling"
      result.hopsUsed shouldBe 12
      transport.toolInvocations shouldBe 13
    }

    // HEL-700 tasks.md 3.4 (design.md D5) — a HopBudgetExhausted outcome ALSO carries the
    // executor's propose-call counters, not just FinalResponse. Every one of the 5 SCRIPTED
    // transport responses is an unparseable propose_dashboard call, but (mirrors task 6.7's own
    // "5th tool_use attempt terminates gracefully... not a 6th transport call" doc comment, and
    // ClaudeClient.sendWithTools's own "thisHop > maxHops" guard) only the first 4 (maxHops,
    // HEL-756) are ever actually dispatched to the executor — the 5th arrives but is never executed.
    "carry the executor's propose-call counters on a failure-budget-exhausted outcome (HEL-1637)" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])

      val badProposeAttempt = Future.successful(toolUseResponse("t", "propose_dashboard", JsObject("dashboardName" -> JsNumber(1))))
      val transport          = new FakeToolTransport(Vector.fill(5)(badProposeAttempt))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Build me a sales dashboard", user))

      // 3 failed propose calls end the turn: the 4th scripted response is never requested.
      result.stopReason shouldBe "failure_budget"
      result.proposeAttempts shouldBe 3
      result.proposeDecodeFailures shouldBe 3
      result.proposeValidationFailures shouldBe 0
      transport.toolInvocations shouldBe 3
    }

    // Task 6.12 — a single hop with TWO successful propose_* tool_use calls still ends with exactly
    // one captured proposal; design.md D6 documents this as "some one of the successful calls'
    // proposals wins, non-deterministically" — this test asserts *some* proposal is present, not
    // which one.
    "capture exactly one proposal when a single hop contains two successful propose_* calls" in {
      val outputRepo = mock(classOf[OutputRepository])
      val dsRepo = mock(classOf[DataSourceRepository])
      when(outputRepo.findByIdOwned(outputId, user)).thenReturn(Future.successful(Some(pipelineOutput(outputId))))

      val dashboard = dashboardProposal(outputId.value)
      val pipeline  = inlinePipelineProposal()
      val transport = new FakeToolTransport(Vector(
        Future.successful(multiToolUseResponse(Seq(("t1", "propose_dashboard", dashboard.toJson), ("t2", "propose_pipeline", pipeline.toJson)))),
        Future.successful(finalTextResponse("Done."))
      ))

      val result = awaitRight(newService(outputRepo, dsRepo, transport).converse(Seq.empty, "Help me out", user))

      result.proposal shouldBe defined
      transport.toolInvocations shouldBe 2
    }
  }

  // Task 6.8 — AC3's tool-list assertion: no apply-shaped tool is ever a member of the bounded
  // set handed to Claude, enforced by the schema itself (there is no tool through which an apply
  // could even be requested). HEL-756 tasks.md 2.2 extends this (rather than duplicating it) to
  // also assert the new 7th tool, test_connection, is present.
  "AssistantProtocol.assistantTools" should {

    "contain exactly the 7 expected tools, including test_connection, none apply-shaped" in {
      val names = AssistantProtocol.assistantTools.map(_.name)

      names should contain theSameElementsAs Vector(
        "find", "get_resource", "test_connection", "propose_dashboard", "propose_pipeline", "propose_combined", "propose_patch_set"
      )
      AssistantProtocol.assistantTools.foreach { tool =>
        tool.name.toLowerCase should not include "apply"
        tool.description.toLowerCase should not include "apply the"
      }
    }
  }
}
