package com.helio.api.routes.assistant

import com.helio.testkit.HelioRouteTest

import com.helio.infrastructure.ai._
import com.helio.api.JsonProtocols
import com.helio.domain.model._
import com.helio.infrastructure.persistence.assistant.AssistantConversationRepository._
import com.helio.services.assistant.AssistantSystemPrompt
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.StatusCodes
import org.mockito.Mockito.when
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import slick.jdbc.PostgresProfile.api._
import spray.json._

import scala.concurrent.duration.DurationInt
import scala.concurrent.Future
import scala.jdk.CollectionConverters._

/** HTTP-shell coverage for `POST /api/assistant-conversations/:id/converse` persistence and error mapping (HEL-665,
 *  reopened composer ticket, tasks.md 6.3/6.3a/6.4/6.5). Business-logic depth for `AssistantService.converse` itself
 *  is `AssistantServiceSpec`'s job (fake `ClaudeTransport`, zero real network calls anywhere in this suite either);
 *  this spec only exercises the HTTP + persistence wiring `converseFlow` composes. Its fixture lives in
 *  `AssistantConversationRoutesFixture`, and the idempotency/turn-outcome and tier/budget tests in the two
 *  `AssistantConversationRoutes*Spec` siblings (HEL-1803). Task 6.5's "second user cannot converse with the first
 *  user's conversation" is a genuine Postgres RLS assertion, not app-layer-only scoping. */
class AssistantConversationRoutesSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with AssistantConversationRoutesFixture {

  "POST /assistant-conversations/:id/converse" should {

    "persist the new turns on success -- a subsequent GET returns the identical transcript (tasks.md 6.3)" in {
      cleanDb()
      val detail           = await(conversationService.create(userA, None, title = None))
      val assistantService = assistantServiceWith(new FakeTransport(finalTextResponse("Hi there!")))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        transcriptOf(responseAs[String]) should have size 2
      }

      Get(s"/assistant-conversations/${detail.record.id.value}") ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        transcriptOf(responseAs[String]) should have size 2
      }
    }

    // HEL-1718 seam: two POSTs through the real route; the system prompt reaches the wire on BOTH
    // turns (serialized `system` field) and never lands in the persisted transcript.
    "send the system prompt in the wire system field on the second POST and never persist it (HEL-1718)" in {
      cleanDb()
      val detail    = await(conversationService.create(userA, None, title = None))
      val transport = new SequencedTransport(Vector(finalTextResponse("One."), finalTextResponse("Two.")))
      val service   = assistantServiceWith(transport)
      val id        = detail.record.id.value

      Post(s"/assistant-conversations/$id/converse", jsonEntity("""{"message":"First"}""")) ~> routesFor(userA, Some(service)) ~> check {
        status shouldBe StatusCodes.OK
      }
      Post(s"/assistant-conversations/$id/converse", jsonEntity("""{"message":"Second"}""")) ~> routesFor(userA, Some(service)) ~> check {
        status shouldBe StatusCodes.OK
      }

      val wire = transport.receivedRequests.map(r => ClaudeProtocol.claudeApiToolRequestFormat.write(r).asJsObject)
      wire should have size 2
      val promptText = AssistantSystemPrompt.text
      wire(1).fields.get("system").map(_.compactPrint).getOrElse("") should include(JsString(promptText).compactPrint)
      wire(1).fields.get("system") shouldBe wire(0).fields.get("system")
      wire.foreach(_.fields("messages").compactPrint should not include "Worked examples")

      Get(s"/assistant-conversations/$id") ~> routesFor(userA, Some(service)) ~> check {
        status shouldBe StatusCodes.OK
        val body = responseAs[String]
        body should not include "Worked examples"
        val transcript = transcriptOf(body)
        transcript should have size 4
        transcript.head.content shouldBe Seq(ClaudeContentBlock.Text("First"))
        transcript.map(_.content.toString).foreach(_ should not include "Worked examples")
      }
    }

    // evaluation-1.md Change Request 1 (cycle 2, live-verified defect) — dedicated regression
    // coverage at the route/persistence layer. Task 6.3 above already exercises a brand-new
    // (empty-history) conversation but only asserted `transcript.size` — exactly why this shipped
    // without a test catching it (evaluation-1.md's own note). This test asserts the persisted
    // first turn's CONTENT: exactly the typed message, never AssistantSystemPrompt.text folded in.
    "persist EXACTLY the typed message (never the internal system prompt) as the first turn's content for a brand-new conversation" in {
      cleanDb()
      val detail            = await(conversationService.create(userA, None, title = None))
      val assistantService  = assistantServiceWith(new FakeTransport(finalTextResponse("Hi there!")))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"What's our revenue?"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        val transcript = transcriptOf(responseAs[String])
        transcript should have size 2
        transcript.head.role shouldBe "user"
        transcript.head.content shouldBe Seq(ClaudeContentBlock.Text("What's our revenue?"))
      }

      Get(s"/assistant-conversations/${detail.record.id.value}") ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        transcriptOf(responseAs[String]).head.content shouldBe Seq(ClaudeContentBlock.Text("What's our revenue?"))
      }
    }

    "return the mapped error status and persist nothing on a real Claude/transport failure (tasks.md 6.3a)" in {
      cleanDb()
      val detail            = await(conversationService.create(userA, None, title = None))
      val failingAssistant  = assistantServiceWith(new FakeTransport(Future.failed(ClaudeApiException(500, "internal server error"))))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello"}""")) ~> routesFor(userA, Some(failingAssistant)) ~> check {
        status shouldBe StatusCodes.BadGateway
      }

      Get(s"/assistant-conversations/${detail.record.id.value}") ~> routesFor(userA, Some(failingAssistant)) ~> check {
        status shouldBe StatusCodes.OK
        transcriptOf(responseAs[String]) shouldBe empty
      }
    }

    // HEL-1636 D6 / 5.4: a refusal is a 502 naming the refusal, and persists nothing.
    "return 502 saying Claude declined the request on a refusal, and persist nothing (HEL-1636)" in {
      cleanDb()
      val detail    = await(conversationService.create(userA, None, title = None))
      val assistant = assistantServiceWith(new FakeTransport(Future.successful(ClaudeFixtures.fixture("refusal.json"))))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello"}""")) ~> routesFor(userA, Some(assistant)) ~> check {
        status shouldBe StatusCodes.BadGateway
        responseAs[String] should include("Claude declined this request (category: cyber)")
      }

      Get(s"/assistant-conversations/${detail.record.id.value}") ~> routesFor(userA, Some(assistant)) ~> check {
        status shouldBe StatusCodes.OK
        transcriptOf(responseAs[String]) shouldBe empty
      }
    }

    "return 503 when assistantServiceOpt is None, while GET /assistant-conversations still works normally (tasks.md 6.4)" in {
      cleanDb()
      val detail = await(conversationService.create(userA, None, title = None))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello"}""")) ~> routesFor(userA, None) ~> check {
        status shouldBe StatusCodes.ServiceUnavailable
      }

      Get("/assistant-conversations") ~> routesFor(userA, None) ~> check {
        status shouldBe StatusCodes.OK
      }
    }

    "a second user cannot converse with the first user's conversation -- not-found, no turns persisted (tasks.md 6.5, real Postgres RLS)" in {
      cleanDb()
      val detail            = await(conversationService.create(userA, None, title = None))
      val assistantService  = assistantServiceWith(new FakeTransport(finalTextResponse("Hi there!")))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"intrusion"}""")) ~> routesFor(userB, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.NotFound
      }

      Get(s"/assistant-conversations/${detail.record.id.value}") ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        transcriptOf(responseAs[String]) shouldBe empty
      }
    }
  }
}
