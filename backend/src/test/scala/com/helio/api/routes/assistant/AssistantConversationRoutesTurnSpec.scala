package com.helio.api.routes.assistant

import com.helio.testkit.HelioRouteTest

import com.helio.infrastructure.ai._
import com.helio.api.JsonProtocols
import com.helio.domain.model._
import com.helio.infrastructure.persistence.assistant.AssistantConversationRepository._
import com.helio.infrastructure.persistence.pipelines.OutputRepository
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

/** HTTP-shell coverage for the converse route's idempotency key, turn-outcome signals and the second call after a
 *  hop-cap-exhausted turn (split out of `AssistantConversationRoutesSpec`, HEL-1803). */
class AssistantConversationRoutesTurnSpec
    extends AnyWordSpec
    with Matchers
    with HelioRouteTest
    with JsonProtocols
    with AssistantConversationRoutesFixture {

  // HEL-698 tasks.md 4.3 (design.md D3/D4/D5, assistant-live-converse spec) — client-generated
  // idempotency key: a same-key replay is a no-op, an over-long key is rejected, a keyless call is
  // unaffected, and both GET/converse responses carry the persisted `lastIdempotencyKey`.
  "POST /assistant-conversations/:id/converse idempotency key" should {

    "a second converse with the SAME key is a no-op replay -- 200, transcript unchanged, the underlying Claude transport invoked exactly once" in {
      cleanDb()
      val detail    = await(conversationService.create(userA, None, title = None))
      val transport = new SequencedTransport(Vector(finalTextResponse("Hi there!")))
      val assistantService = assistantServiceWith(transport)

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello","idempotencyKey":"key-1"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        transcriptOf(responseAs[String]) should have size 2
      }

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello","idempotencyKey":"key-1"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        transcriptOf(responseAs[String]) should have size 2
      }

      transport.receivedRequests should have size 1
    }

    "an idempotencyKey longer than 128 characters is rejected with 400 and nothing is persisted" in {
      cleanDb()
      val detail            = await(conversationService.create(userA, None, title = None))
      val assistantService  = assistantServiceWith(new FakeTransport(finalTextResponse("Hi there!")))
      val overLongKey       = "k" * 129

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity(s"""{"message":"Hello","idempotencyKey":"$overLongKey"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.BadRequest
      }

      Get(s"/assistant-conversations/${detail.record.id.value}") ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        transcriptOf(responseAs[String]) shouldBe empty
      }
    }

    "a keyless converse behaves exactly as before -- no lastIdempotencyKey field on the response" in {
      cleanDb()
      val detail            = await(conversationService.create(userA, None, title = None))
      val assistantService  = assistantServiceWith(new FakeTransport(finalTextResponse("Hi there!")))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        val obj = responseAs[String].parseJson.asJsObject
        obj.fields.keySet should not contain "lastIdempotencyKey"
      }
    }

    "GET and converse responses both carry lastIdempotencyKey once a keyed send has landed" in {
      cleanDb()
      val detail            = await(conversationService.create(userA, None, title = None))
      val assistantService  = assistantServiceWith(new FakeTransport(finalTextResponse("Hi there!")))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello","idempotencyKey":"key-1"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject.fields("lastIdempotencyKey") shouldBe JsString("key-1")
      }

      Get(s"/assistant-conversations/${detail.record.id.value}") ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        responseAs[String].parseJson.asJsObject.fields("lastIdempotencyKey") shouldBe JsString("key-1")
      }
    }
  }

  // HEL-667 tasks.md 7.3 (design.md D1, assistant-live-converse spec) — the two new ephemeral
  // turn-outcome signals surface on a converse response and stay absent on GET.
  "POST /assistant-conversations/:id/converse turn-outcome signals" should {

    "surfaces stopReason failure_budget with a stopMessage when the turn spends 3 failed tool calls (HEL-1637)" in {
      cleanDb()
      val detail = await(conversationService.create(userA, None, title = None))
      // "unknown_tool" is never a member of AssistantProtocol.assistantTools -- AssistantToolExecutor
      // falls back to `Left(s"Unknown tool: $other")` for it without touching any collaborator, so
      // every one of the (null) collaborators in assistantServiceWith stays unreached.
      val assistantService = assistantServiceWith(new FakeTransport(toolUseResponse("t", "unknown_tool", JsObject.empty)))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        val obj = responseAs[String].parseJson.asJsObject
        obj.fields("hopBudgetExhausted") shouldBe JsBoolean(false)
        obj.fields("searchedWithNoResults") shouldBe JsBoolean(false)
        obj.fields("stopReason") shouldBe JsString("failure_budget")
        obj.fields("stopMessage").convertTo[String] should include("3 tool calls failed")
      }
    }

    "surfaces searchedWithNoResults = true when the turn's find call comes back empty" in {
      cleanDb()
      val detail = await(conversationService.create(userA, None, title = None))
      val outputRepo = mock(classOf[OutputRepository])
      when(outputRepo.findAllByOwner(userA.id, Page.Default)).thenReturn(Future.successful(PagedResult(Vector.empty[Output], 0, 0, 200)))
      val findInput = JsObject("query" -> JsString("orders"), "resourceTypes" -> JsArray(JsString("dataType")))
      val transport = new SequencedTransport(
        Vector(toolUseResponse("t1", "find", findInput), finalTextResponse("I couldn't find anything -- can you narrow it down?"))
      )
      val assistantService = assistantServiceWithSearch(transport, outputRepo)

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Track weekly revenue"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        val obj = responseAs[String].parseJson.asJsObject
        obj.fields("searchedWithNoResults") shouldBe JsBoolean(true)
        obj.fields("hopBudgetExhausted") shouldBe JsBoolean(false)
      }
    }

    "GET never carries either signal, even right after a converse call that set them" in {
      cleanDb()
      val detail            = await(conversationService.create(userA, None, title = None))
      val assistantService  = assistantServiceWith(new FakeTransport(toolUseResponse("t", "unknown_tool", JsObject.empty)))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Hello"}""")) ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
      }

      Get(s"/assistant-conversations/${detail.record.id.value}") ~> routesFor(userA, Some(assistantService)) ~> check {
        status shouldBe StatusCodes.OK
        val obj = responseAs[String].parseJson.asJsObject
        obj.fields.keySet should not contain "hopBudgetExhausted"
        obj.fields.keySet should not contain "searchedWithNoResults"
        obj.fields.keySet should not contain "stopReason"
        obj.fields.keySet should not contain "stopMessage"
      }
    }
  }

  // skeptic-final-1.md CR1 (final-gate round 1, live-verified defect) — a conversation that hits
  // the hop cap must remain usable: a SECOND `POST /:id/converse` call on the SAME conversation
  // must succeed, not fail with the Anthropic API's "tool_use ids were found without tool_result
  // blocks immediately after" 400 the live bug reproduced twice against the real dev backend.
  "POST /assistant-conversations/:id/converse after a hop-cap-exhausted turn" should {

    "a second converse call succeeds, and its outbound request resolves the dangling tool_use in the immediately-following message" in {
      cleanDb()
      val detail = await(conversationService.create(userA, None, title = None))

      // First call: every hop returns the SAME unresolved tool_use, driving the loop to the hop cap
      // ("unknown_tool" is never in AssistantProtocol.assistantTools -- AssistantToolExecutor's
      // fallback never touches a real collaborator, mirroring this file's own established fixture).
      val firstAssistant = assistantServiceWith(new FakeTransport(toolUseResponse("dangling-1", "unknown_tool", JsObject.empty)))

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Build me a huge dashboard"}""")) ~>
        routesFor(userA, Some(firstAssistant)) ~> check {
          status shouldBe StatusCodes.OK
          val obj = responseAs[String].parseJson.asJsObject
          obj.fields("stopReason") shouldBe JsString("failure_budget")
        }

      // Second call: a FRESH transport that records exactly what it received.
      val secondTransport = new SequencedTransport(Vector(finalTextResponse("Sure, let's narrow it down.")))
      val secondAssistant  = assistantServiceWith(secondTransport)

      Post(s"/assistant-conversations/${detail.record.id.value}/converse", jsonEntity("""{"message":"Just show total revenue"}""")) ~>
        routesFor(userA, Some(secondAssistant)) ~> check {
          status shouldBe StatusCodes.OK
        }

      val outboundMessages = secondTransport.receivedRequests.head.messages
      // Every tool_use content block is immediately followed, in the VERY NEXT message, by a
      // tool_result block carrying a matching id -- the exact invariant the live 400 violated.
      outboundMessages.zipWithIndex.foreach {
        case (msg, idx) =>
          msg.content.filter(_.blockType == "tool_use").flatMap(_.id).foreach { danglingId =>
            outboundMessages(idx + 1).content.flatMap(_.toolUseId) should contain(danglingId)
          }
      }
      // No two consecutive outbound messages share a role either (the other structural invariant).
      outboundMessages.map(_.role).sliding(2).foreach {
        case Seq(a, b) => a should not be b
        case _         => ()
      }
      outboundMessages.last.role shouldBe ClaudeRole.User
    }
  }
}
