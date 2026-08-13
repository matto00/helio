package com.helio.ai

import spray.json._
import spray.json.DefaultJsonProtocol._

import scala.util.Try

/** Parses a single already-delimited SSE frame's raw text (the `event:`/`data:` lines, without
 *  the trailing `\n\n` delimiter) into a typed [[ClaudeStreamEvent]] (design.md D5). Chunk-
 *  boundary / framing concerns live one layer up in [[ClaudeSseAssembler]] — this function only
 *  ever sees a frame it has already been handed in full.
 *
 *  Returns `None` for event kinds this client doesn't model (e.g. `content_block_start`/
 *  `content_block_stop`, or any future kind Anthropic adds) so callers can filter them out without
 *  special-casing — see design.md's Non-Goals. */
object ClaudeSseFrameParser {

  private final case class RawFrame(eventName: Option[String], data: String)

  def parse(rawFrame: String): Option[ClaudeStreamEvent] =
    toRawFrame(rawFrame).flatMap(toStreamEvent)

  private def toRawFrame(rawFrame: String): Option[RawFrame] = {
    val lines     = rawFrame.split("\n").map(_.trim).filter(_.nonEmpty)
    val dataLines = lines.filter(_.startsWith("data:")).map(_.stripPrefix("data:").trim)
    if (dataLines.isEmpty) None
    else Some(RawFrame(lines.find(_.startsWith("event:")).map(_.stripPrefix("event:").trim), dataLines.mkString))
  }

  private def toStreamEvent(frame: RawFrame): Option[ClaudeStreamEvent] =
    Try(frame.data.parseJson.asJsObject).toOption.flatMap { obj =>
      val eventType = obj.fields.get("type").map(_.convertTo[String]).orElse(frame.eventName).getOrElse("")
      eventType match {
        case "message_start"       => parseMessageStart(obj)
        case "content_block_delta" => parseTextDelta(obj)
        case "message_delta"       => parseUsageDelta(obj)
        case "message_stop"        => Some(ClaudeStreamEvent.MessageStop)
        case "ping"                => Some(ClaudeStreamEvent.Ping)
        case "error"                => Some(parseError(obj))
        case _                      => None
      }
    }

  private def parseMessageStart(obj: JsObject): Option[ClaudeStreamEvent] =
    obj.fields.get("message").map(_.asJsObject).map { message =>
      val id    = message.fields.get("id").map(_.convertTo[String]).getOrElse("")
      val model = message.fields.get("model").map(_.convertTo[String]).getOrElse("")
      ClaudeStreamEvent.MessageStart(id, model)
    }

  private def parseTextDelta(obj: JsObject): Option[ClaudeStreamEvent] =
    obj.fields
      .get("delta")
      .map(_.asJsObject)
      .flatMap(_.fields.get("text"))
      .map(_.convertTo[String])
      .map(text => ClaudeStreamEvent.TextDelta(text))

  private def parseUsageDelta(obj: JsObject): Option[ClaudeStreamEvent] =
    obj.fields
      .get("usage")
      .map(_.convertTo[ClaudeApiUsage](ClaudeProtocol.claudeApiUsageFormat))
      .map(usage => ClaudeStreamEvent.UsageDelta(TokenUsage(usage.inputTokens, usage.outputTokens)))

  private def parseError(obj: JsObject): ClaudeStreamEvent = {
    val message = obj.fields
      .get("error")
      .map(_.asJsObject)
      .flatMap(_.fields.get("message"))
      .map(_.convertTo[String])
      .getOrElse("Unknown Claude API error")
    // status=0: a mid-stream `error` SSE frame has no HTTP status of its own — the outer
    // response was already 200 OK by the time this frame arrived (documented sentinel, see
    // ClaudeError.ApiError).
    ClaudeStreamEvent.Error(ClaudeError.ApiError(status = 0, body = message))
  }
}
