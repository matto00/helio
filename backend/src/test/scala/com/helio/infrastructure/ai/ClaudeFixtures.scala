package com.helio.infrastructure.ai

import org.apache.pekko.NotUsed
import org.apache.pekko.stream.scaladsl.{Source => StreamSource}
import spray.json._

import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicInteger
import scala.concurrent.Future
import scala.io.Source
import scala.jdk.CollectionConverters._

/** HEL-1636 test support: hand-built JSON fixtures (documented Anthropic response shapes, no
 *  secrets) under `src/test/resources/claude/`, decoded through the REAL `ClaudeProtocol` reader,
 *  plus a recording transport that exposes every outbound tool request as the JSON that would hit
 *  the wire. */
object ClaudeFixtures {

  def fixtureJson(name: String): JsValue = {
    val stream = getClass.getResourceAsStream(s"/claude/$name")
    require(stream != null, s"missing fixture /claude/$name")
    try Source.fromInputStream(stream, "UTF-8").mkString.parseJson
    finally stream.close()
  }

  /** The fixture decoded exactly as `HttpClaudeTransport` decodes a real response body. */
  def fixture(name: String): ClaudeApiResponse =
    fixtureJson(name).convertTo[ClaudeApiResponse](ClaudeProtocol.claudeApiResponseFormat)

  /** The fixture's own `content` array, untouched (the byte-exact reference for round-trip checks). */
  def fixtureContent(name: String): Vector[JsValue] =
    fixtureJson(name).asJsObject.fields("content").asInstanceOf[JsArray].elements

  /** [[fixture]] with literal placeholder substitutions applied to the JSON text first. */
  def fixtureWith(name: String, replacements: (String, String)*): ClaudeApiResponse =
    replacements
      .foldLeft(fixtureJson(name).compactPrint) { case (acc, (from, to)) => acc.replace(from, to) }
      .parseJson
      .convertTo[ClaudeApiResponse](ClaudeProtocol.claudeApiResponseFormat)

  def textResponse(text: String, id: String = "msg_text"): ClaudeApiResponse =
    ClaudeApiResponse(id, Seq(ClaudeApiContentBlock("text", Some(text))), Some("end_turn"), ClaudeApiUsage(5, 5))

  /** Scripted tool-request transport that records each outbound request. */
  final class RecordingToolTransport(responses: Vector[ClaudeApiResponse]) extends ClaudeTransport {
    private val count    = new AtomicInteger(0)
    private val received = new ConcurrentLinkedQueue[ClaudeApiToolRequest]()

    def invocations: Int                         = count.get()
    def requests: Vector[ClaudeApiToolRequest]   = received.asScala.toVector
    /** Request `i` exactly as serialized for the wire. */
    def requestJson(i: Int): JsObject =
      ClaudeProtocol.claudeApiToolRequestFormat.write(requests(i)).asJsObject
    def messagesJson(i: Int): Vector[JsObject] =
      requestJson(i).fields("messages").asInstanceOf[JsArray].elements.map(_.asJsObject)

    override def send(request: ClaudeApiRequest): Future[ClaudeApiResponse] =
      Future.failed(new UnsupportedOperationException("not used"))
    override def stream(request: ClaudeApiRequest): StreamSource[ClaudeStreamEvent, NotUsed] =
      throw new UnsupportedOperationException("not used")
    override def sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse] = {
      received.add(request)
      Future.successful(responses(count.getAndIncrement()))
    }
  }

  /** Every `{"type":"text","text":""}` (blank) block anywhere in a serialized request. */
  def emptyTextBlocks(requestJson: JsValue): Vector[JsValue] = {
    def walk(v: JsValue): Vector[JsValue] = v match {
      case o: JsObject =>
        val here = (o.fields.get("type"), o.fields.get("text")) match {
          case (Some(JsString("text")), Some(JsString(t))) if t.trim.isEmpty => Vector(o)
          case _                                                             => Vector.empty
        }
        here ++ o.fields.values.flatMap(walk)
      case JsArray(es) => es.flatMap(walk)
      case _           => Vector.empty
    }
    walk(requestJson)
  }

  /** Content blocks of a serialized message, by `type`. */
  def blockTypes(message: JsObject): Vector[String] =
    message.fields("content") match {
      case JsArray(es) => es.collect { case o: JsObject => o.fields.get("type").collect { case JsString(s) => s }.getOrElse("") }
      case _           => Vector.empty
    }
}
