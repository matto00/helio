package com.helio.ai

import org.apache.pekko.http.scaladsl.testkit.ScalatestRouteTest
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Sink, Source}
import org.apache.pekko.util.ByteString
import org.scalatest.matchers.should.Matchers
import org.scalatest.wordspec.AnyWordSpec

import scala.concurrent.duration._
import scala.concurrent.{Await, Future}

/** Coverage for `ClaudeSseAssembler`/`ClaudeSseFrameParser` (HEL-390 task 6.3): text-delta
 *  concatenation reproduces the full response text, usage is exposed on `message_delta`, an
 *  `error` frame surfaces as a typed error event rather than a silent drop, and frames split
 *  across chunk boundaries still parse correctly. Feeds hand-constructed raw SSE `ByteString`
 *  chunks directly — no HTTP layer, no real network — mirroring design.md D5's isolated,
 *  directly-unit-tested parser. */
class ClaudeStreamAssemblySpec extends AnyWordSpec with Matchers with ScalatestRouteTest {

  private implicit val mat: Materializer = Materializer(system)

  private def await[A](f: Future[A]): A = Await.result(f, 5.seconds)

  private def assemble(chunks: String*): Seq[ClaudeStreamEvent] = {
    val bytes = Source(chunks.map(ByteString(_)).toList)
    await(ClaudeSseAssembler.assemble(bytes).runWith(Sink.seq))
  }

  private val messageStartFrame =
    """event: message_start
      |data: {"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","model":"claude-opus-4-8","content":[],"usage":{"input_tokens":10,"output_tokens":1}}}
      |
      |""".stripMargin

  private def textDeltaFrame(text: String): String =
    s"""event: content_block_delta
       |data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"$text"}}
       |
       |""".stripMargin

  private val messageDeltaFrame =
    """event: message_delta
      |data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":15}}
      |
      |""".stripMargin

  private val messageStopFrame =
    """event: message_stop
      |data: {"type":"message_stop"}
      |
      |""".stripMargin

  private val pingFrame =
    """event: ping
      |data: {"type":"ping"}
      |
      |""".stripMargin

  private val errorFrame =
    """event: error
      |data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}
      |
      |""".stripMargin

  "ClaudeSseAssembler.assemble" should {

    "concatenate text-delta payloads, in order, into the full response text" in {
      val fullStream = messageStartFrame + textDeltaFrame("Hello") + textDeltaFrame(", world!") + messageDeltaFrame + messageStopFrame
      val events      = assemble(fullStream)

      val text = events.collect { case ClaudeStreamEvent.TextDelta(t) => t }.mkString
      text shouldBe "Hello, world!"
    }

    "expose message_start, message_delta usage, and message_stop as typed events" in {
      val fullStream = messageStartFrame + textDeltaFrame("hi") + messageDeltaFrame + messageStopFrame
      val events      = assemble(fullStream)

      events.collectFirst { case s: ClaudeStreamEvent.MessageStart => s } shouldBe
        Some(ClaudeStreamEvent.MessageStart(id = "msg_01", model = "claude-opus-4-8"))

      events.collectFirst { case u: ClaudeStreamEvent.UsageDelta => u } shouldBe
        Some(ClaudeStreamEvent.UsageDelta(TokenUsage(inputTokens = 0, outputTokens = 15)))

      events should contain(ClaudeStreamEvent.MessageStop)
    }

    "surface a ping frame as a typed Ping event" in {
      assemble(pingFrame) shouldBe Seq(ClaudeStreamEvent.Ping)
    }

    "surface an error frame as a typed error event rather than a silent drop" in {
      val events = assemble(errorFrame)

      events should have size 1
      events.head match {
        case ClaudeStreamEvent.Error(ClaudeError.ApiError(0, message)) => message should include("Overloaded")
        case other                                                       => fail(s"expected a typed error event, got $other")
      }
    }

    "parse correctly when a frame is split across two chunks that don't align on a line boundary" in {
      val frame           = textDeltaFrame("chunked-boundary-text")
      val midpoint         = frame.length / 2
      val (firstHalf, secondHalf) = frame.splitAt(midpoint)

      val events = assemble(firstHalf, secondHalf)

      events shouldBe Seq(ClaudeStreamEvent.TextDelta("chunked-boundary-text"))
    }

    "parse correctly when a frame is split into many arbitrarily small chunks" in {
      val frame  = messageStartFrame + textDeltaFrame("a") + textDeltaFrame("b") + messageStopFrame
      val chunks = frame.grouped(3).toSeq

      val events = assemble(chunks: _*)

      events.collect { case ClaudeStreamEvent.TextDelta(t) => t } shouldBe Seq("a", "b")
      events should contain(ClaudeStreamEvent.MessageStop)
    }
  }
}
