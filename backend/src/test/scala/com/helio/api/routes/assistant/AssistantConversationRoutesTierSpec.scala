package com.helio.api.routes.assistant

import com.helio.testkit.HelioRouteTest

import com.helio.infrastructure.ai._
import com.helio.api.JsonProtocols
import com.helio.api.protocols.assistant.TierErrorResponse
import com.helio.domain.model._
import com.helio.infrastructure.persistence.assistant.AssistantConversationRepository._
import com.helio.infrastructure.persistence.pipelines.OutputRepository
import com.helio.services.assistant.{AssistantModelPolicy, AssistantService, AssistantSystemPrompt}
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.{mock, when}
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import scala.concurrent.duration.DurationInt
import scala.concurrent.Future
import scala.jdk.CollectionConverters._

/** HTTP-shell coverage for the converse route's tier gating (HEL-703) and per-turn budgets (HEL-1637) (split out of
 *  `AssistantConversationRoutesSpec`, HEL-1803). */
class AssistantConversationRoutesTierSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with AssistantConversationRoutesFixture {

  "Tier gating" should {

    "deny a free-tier user 403 TIER_FORBIDDEN on every endpoint in the family, with nothing persisted" in {
      cleanDb()
      val freeUser = newUserWithTier("free")
      val routes   = routesFor(freeUser, None)
      // A conversation created by a DIFFERENT (owner) user — proves the 403 wins even when a real
      // id exists, i.e. the gate runs strictly before any handler/persistence logic.
      val existing = await(conversationService.create(userA, None, title = None))

      def assertForbidden() = {
        status shouldBe StatusCodes.Forbidden
        responseAs[TierErrorResponse].code shouldBe "TIER_FORBIDDEN"
      }

      Get("/assistant-conversations") ~> routes ~> check { assertForbidden() }
      Post("/assistant-conversations", jsonEntity("{}")) ~> routes ~> check { assertForbidden() }
      Get(s"/assistant-conversations/${existing.record.id.value}") ~> routes ~> check { assertForbidden() }
      Post(s"/assistant-conversations/${existing.record.id.value}/messages", jsonEntity("""{"turns":[]}""")) ~> routes ~> check { assertForbidden() }
      Post(s"/assistant-conversations/${existing.record.id.value}/converse", jsonEntity("""{"message":"hi"}""")) ~> routes ~> check { assertForbidden() }
      Patch(s"/assistant-conversations/${existing.record.id.value}", jsonEntity("""{"pinned":true}""")) ~> routes ~> check { assertForbidden() }

      // Nothing the free user attempted was persisted (the owner's pre-existing conversation is
      // untouched, and the free user created none of their own).
      conversationCountFor(freeUser) shouldBe 0
    }

    "a beta-tier user under the cap converses normally, then gets 429 CHAT_LIMIT_REACHED once at the cap -- no model call, no turns persisted for the denied attempt" in {
      cleanDb()
      val betaUser  = newUserWithTier("beta")
      val transport = new SequencedTransport(Vector(finalTextResponse("Hi there!")))
      val detail    = await(conversationService.create(betaUser, None, title = None))
      val routes    = routesForWithChatAccess(betaUser, Some(assistantServiceWith(transport)), chatAccessServiceWithLimit(1))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"one"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.OK
      }
      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"two"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.TooManyRequests
        val body = responseAs[TierErrorResponse]
        body.code shouldBe "CHAT_LIMIT_REACHED"
        body.limit shouldBe Some(1)
      }

      // Wiring guard (HEL-1473): the stored usage_date IS the pinned day. Fails on SystemClock on any
      // day but 2026-01-01, so dropping the pin from the repo is caught immediately.
      val storedDays = await(ctx.withSystemContext(
        sql"""SELECT usage_date::text FROM assistant_daily_usage WHERE user_id = ${betaUser.id.value}::uuid""".as[String]
      ))
      storedDays shouldBe Vector(pinnedDate.toString)

      // The model was invoked exactly once (for the first, under-cap call) -- the second,
      // over-cap call never reached AssistantService.converse at all.
      transport.receivedRequests should have size 1
      // Exactly one user+assistant turn pair persisted -- from the first call only.
      val after = await(conversationService.get(betaUser, detail.record.id))
      after.map(_.transcript.convertTo[Vector[ClaudeToolMessage]].size) shouldBe Right(2)
    }

    "a beta-tier user at the cap can still list conversations and read one (200)" in {
      cleanDb()
      val betaUser = newUserWithTier("beta")
      val detail   = await(conversationService.create(betaUser, None, title = None))
      // limit = 0 deterministically puts this user "at the cap" (design.md D6: < 1 is always
      // capped) without needing to first burn through N real messages.
      val routes = routesForWithChatAccess(betaUser, None, chatAccessServiceWithLimit(0))

      Get("/assistant-conversations") ~> routes ~> check { status shouldBe StatusCodes.OK }
      Get(s"/assistant-conversations/${detail.record.id.value}") ~> routes ~> check { status shouldBe StatusCodes.OK }
    }

    "an owner-tier user converses successfully with no cap, past the beta limit, and writes no assistant_daily_usage row" in {
      cleanDb()
      val ownerUser = newUserWithTier("owner")
      val transport = new SequencedTransport(Vector(finalTextResponse("a"), finalTextResponse("b"), finalTextResponse("c")))
      val detail    = await(conversationService.create(ownerUser, None, title = None))
      // The "beta" limit here is deliberately tiny (1) -- proves owner ignores it entirely.
      val routes = routesForWithChatAccess(ownerUser, Some(assistantServiceWith(transport)), chatAccessServiceWithLimit(1))

      (1 to 3).foreach { n =>
        Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity(s"""{"message":"msg-$n"}""")) ~> routes ~> check {
          status shouldBe StatusCodes.OK
        }
      }

      transport.receivedRequests should have size 3
      dailyUsageCount(ownerUser) shouldBe None
    }
  }

  // HEL-1637 tasks.md 4.2: one turn is one charge however many round trips it takes, and the input-token limit
  // keeps its refusal semantics.
  "POST /assistant-conversations/:id/converse budgets (HEL-1637)" should {

    def findInput: JsValue = JsObject("query" -> JsString("orders"), "resourceTypes" -> JsArray(JsString("dataType")))

    "charge a beta turn of 7 round trips exactly the model weight once" in {
      cleanDb()
      val betaUser   = newUserWithTier("beta")
      val outputRepo = mock(classOf[OutputRepository])
      when(outputRepo.findAllByOwner(betaUser.id, Page.Default)).thenReturn(Future.successful(PagedResult(Vector.empty[Output], 0, 0, 200)))
      val transport = new SequencedTransport(Vector.tabulate(6)(i => toolUseResponse(s"t$i", "find", findInput)) :+ finalTextResponse("Done."))
      val detail    = await(conversationService.create(betaUser, None, title = None))
      val routes    = routesForWithChatAccess(betaUser, Some(assistantServiceWithSearch(transport, outputRepo)), chatAccessServiceWithLimit(50))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Look around","model":"claude-sonnet-5-5"}""")) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject.fields("stopReason") shouldBe JsString("final")
      }

      transport.receivedRequests should have size 7
      dailyUsageCount(betaUser) shouldBe Some(new AssistantModelPolicy(ClaudeModelCatalog.all, "claude-test").weightOf("claude-sonnet-5-5"))
    }

    def sizedMessage(target: Int): String = {
      def total(n: Int) = ClaudeTokenEstimator.estimate(Seq(ClaudeMessage(ClaudeRole.User, AssistantSystemPrompt.text), ClaudeMessage(ClaudeRole.User, "word " * n)))
      // Largest k with total(k) <= target, by bisection (each total() tokenizes the whole input, so a one-word walk is O(n^2)).
      var lo = 0
      var hi = target + 1
      require(total(lo) <= target && total(hi) > target, s"bisection seed does not bracket target $target: total(0)=${total(lo)}, total($hi)=${total(hi)}")
      while (hi - lo > 1) {
        val mid = lo + (hi - lo) / 2
        if (total(mid) <= target) lo = mid else hi = mid
      }
      val k = lo
      require(total(k) <= target && total(k + 1) > target, s"sizedMessage($target) is not the boundary: total($k)=${total(k)}, total(${k + 1})=${total(k + 1)}")
      "word " * k
    }

    "refuse a first request over the input limit with nothing persisted, but keep the work of a turn that grows past it, after which every send is refused" in {
      cleanDb()
      val detail     = await(conversationService.create(userA, None, title = None))
      val outputRepo = mock(classOf[OutputRepository])
      when(outputRepo.findAllByOwner(userA.id, Page.Default)).thenReturn(Future.successful(PagedResult(Vector.empty[Output], 0, 0, 200)))
      val transport = new SequencedTransport(Vector(toolUseResponse("t1", "find", findInput), finalTextResponse("never")))
      val routes    = routesFor(userA, Some(assistantServiceWithSearch(transport, outputRepo)))
      val id        = detail.record.id.value

      // First request over the limit: refused before sending, nothing persisted.
      val over = JsObject("message" -> JsString(sizedMessage(claudeConfig().maxInputTokens + 50))).compactPrint
      Post(s"/assistant-conversations/$id/converse", jsonEntity(over)) ~> routes ~> check { status shouldBe StatusCodes.UnprocessableEntity }
      transport.receivedRequests shouldBe empty
      Get(s"/assistant-conversations/$id") ~> routes ~> check { transcriptOf(responseAs[String]) shouldBe empty }

      // Fits the first request, grows past the limit mid-turn: the turn stops with input_budget and persists its work.
      val near = JsObject("message" -> JsString(sizedMessage(claudeConfig().maxInputTokens - 5))).compactPrint
      Post(s"/assistant-conversations/$id/converse", jsonEntity(near)) ~> routes ~> check {
        status shouldBe StatusCodes.OK
        val obj = responseAs[String].parseJson.asJsObject
        obj.fields("stopReason") shouldBe JsString("input_budget")
        obj.fields("stopMessage").convertTo[String] should include("too long")
      }
      transport.receivedRequests should have size 1
      var persisted = 0
      Get(s"/assistant-conversations/$id") ~> routes ~> check { persisted = transcriptOf(responseAs[String]).size }
      persisted shouldBe 4 // user, assistant tool_use, user tool_result, assistant stop text

      // The stored conversation already exceeds the limit: the next send is the guardrail error, nothing persisted.
      Post(s"/assistant-conversations/$id/converse", jsonEntity("""{"message":"again"}""")) ~> routes ~> check { status shouldBe StatusCodes.UnprocessableEntity }
      Get(s"/assistant-conversations/$id") ~> routes ~> check { transcriptOf(responseAs[String]).size shouldBe persisted }
    }
  }
}
