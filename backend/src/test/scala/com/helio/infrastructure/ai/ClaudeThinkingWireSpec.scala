package com.helio.infrastructure.ai

import ch.qos.logback.classic.{Logger => LogbackLogger}
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import com.helio.infrastructure.persistence.assistant.AssistantConversationRepository._
import com.helio.testkit.HelioRouteTest
import org.apache.pekko.actor.typed.ActorSystem
import org.apache.pekko.actor.typed.scaladsl.adapter._
import org.apache.pekko.http.scaladsl.model.{HttpResponse, StatusCodes}
import org.apache.pekko.http.scaladsl.model.headers.RawHeader
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec
import org.slf4j.LoggerFactory
import spray.json._

import scala.jdk.CollectionConverters._

/** HEL-1636 tasks 1.2 / 2.2 / 2.4: protocol read+write of model-internal blocks, the repository
 *  blob format's new cases, and the transport's request-id log line. */
class ClaudeThinkingWireSpec extends AnyWordSpec with Matchers with HelioRouteTest {

  private implicit val typedSystem: ActorSystem[Nothing] = system.toTyped

  private def readBlock(json: String): ClaudeApiContentBlock =
    ClaudeProtocol.claudeApiContentBlockFormat.read(json.parseJson)
  private def writeBlock(b: ClaudeApiContentBlock): JsValue =
    ClaudeProtocol.claudeApiContentBlockFormat.write(b)

  "ClaudeProtocol content blocks (1.2)" should {
    "keep an empty thinking string and its signature exactly, and write them back" in {
      val json = """{"type":"thinking","thinking":"","signature":"SIG"}"""
      val b    = readBlock(json)
      b.thinking shouldBe Some("")
      b.signature shouldBe Some("SIG")
      b.text shouldBe None
      writeBlock(b) shouldBe json.parseJson
    }
    "keep redacted_thinking data exactly" in {
      val json = """{"type":"redacted_thinking","data":"D1"}"""
      writeBlock(readBlock(json)) shouldBe json.parseJson
    }
    "keep an unknown block whole, with no text, and write it back verbatim" in {
      val json = """{"type":"brand_new","a":1,"text":"must not become Text","n":{"k":[1,2]}}"""
      val b    = readBlock(json)
      b.text shouldBe None
      b.raw.map(_.compactPrint) shouldBe Some(json.parseJson.compactPrint)
      writeBlock(b) shouldBe json.parseJson
    }
    "parse stop_details and treat null as absent" in {
      val r = ClaudeFixtures.fixture("refusal.json")
      r.stopDetails.flatMap(_.asJsObject.fields.get("category")) shouldBe Some(JsString("cyber"))
      ClaudeFixtures.fixture("haiku55-thinking-then-text.json").stopDetails shouldBe None
    }
  }

  "AssistantConversationRepository block format (2.2)" should {
    "round-trip thinking, redacted_thinking and opaque blocks" in {
      val blocks: Seq[ClaudeContentBlock] = Seq(
        ClaudeContentBlock.Thinking("", "SIG"),
        ClaudeContentBlock.RedactedThinking("D1"),
        ClaudeContentBlock.Opaque("brand_new", JsObject("type" -> JsString("brand_new"), "a" -> JsNumber(1)))
      )
      blocks.foreach(b => claudeContentBlockFormat.read(claudeContentBlockFormat.write(b)) shouldBe b)
    }
  }

  "HttpClaudeTransport.logResponse (2.4)" should {
    "log the status and request-id only, never the key or a body" in {
      val key       = "sk-ant-test-key-should-never-be-logged"
      val transport = new HttpClaudeTransport(key)
      val logger    = LoggerFactory.getLogger(transport.getClass).asInstanceOf[LogbackLogger]
      val appender  = new ListAppender[ILoggingEvent]()
      appender.start()
      logger.addAppender(appender)
      try {
        transport.logResponse(HttpResponse(StatusCodes.BadRequest, headers = List(RawHeader("request-id", "req_123")), entity = "secret-body"))
        val lines = appender.list.asScala.map(_.getFormattedMessage).toSeq
        lines should have size 1
        lines.head should (include("req_123") and include("400"))
        lines.head should not include key
        lines.head should not include "secret-body"
      } finally logger.detachAppender(appender)
    }
  }
}
