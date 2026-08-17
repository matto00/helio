package com.helio.email

import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.HttpEntity
import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import spray.json._

/** HEL-704 tasks.md 7.3 — `HttpResendEmailSender`'s request-shape assertions only, no real
 *  network call: `buildHttpRequest` is `private[email]` precisely so this spec can inspect the
 *  built `HttpRequest` directly, without ever invoking `send` (which would perform a real HTTP
 *  round trip) — mirrors `HttpClaudeTransportSpec`'s exact philosophy. Also covers the
 *  owner-notification-email spec's "API key never appears in logs" requirement at the one place
 *  it's mechanically checkable: `EmailConfig.toString`/`HttpResendEmailSender.toString`. */
class HttpResendEmailSenderSpec extends AnyWordSpec with Matchers with ScalatestRouteTest {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private val config = EmailConfig(apiKey = "re_test_key_should_never_be_logged", from = "noreply@helio.dev")
  private val sender  = new HttpResendEmailSender(config)

  private def bodyJson(to: Seq[String], subject: String, text: String): JsObject =
    sender.buildHttpRequest(to, subject, text).entity match {
      case HttpEntity.Strict(_, data) => data.utf8String.parseJson.asJsObject
      case other                      => fail(s"expected a strict JSON entity, got $other")
    }

  "HttpResendEmailSender.buildHttpRequest" should {

    "POST to the Resend emails endpoint" in {
      val request = sender.buildHttpRequest(Seq("owner@example.com"), "subject", "body")
      request.method.value shouldBe "POST"
      request.uri.toString shouldBe "https://api.resend.com/emails"
    }

    "carry the API key as a Bearer Authorization header" in {
      val request = sender.buildHttpRequest(Seq("owner@example.com"), "subject", "body")
      val authHeader = request.headers.find(_.name() == "Authorization").map(_.value())
      authHeader shouldBe Some("Bearer re_test_key_should_never_be_logged")
    }

    "serialize from/to/subject/text in the JSON body" in {
      val json = bodyJson(Seq("owner1@example.com", "owner2@example.com"), "Helio Beta access request", "hello")

      json.fields("from") shouldBe JsString("noreply@helio.dev")
      json.fields("to") shouldBe JsArray(JsString("owner1@example.com"), JsString("owner2@example.com"))
      json.fields("subject") shouldBe JsString("Helio Beta access request")
      json.fields("text") shouldBe JsString("hello")
    }
  }

  "EmailConfig.toString" should {
    "redact the API key" in {
      config.toString should not include "re_test_key_should_never_be_logged"
      config.toString should include("<redacted>")
    }
  }
}
