package com.helio.ai

/** Domain-facing request/response/error types for [[ClaudeClient]] — the shapes callers
 *  (HEL-341 and future backend agent paths) actually work with. Wire-format types that mirror
 *  the Anthropic Messages API's own JSON shape live in `ClaudeWireModels.scala`; `ClaudeClient`
 *  translates between the two (design.md D3/D4). */

/** A single conversation turn. `role` is `"user"` or `"assistant"` per the Messages API. */
final case class ClaudeMessage(role: String, content: String)

object ClaudeRole {
  val User: String      = "user"
  val Assistant: String = "assistant"
}

/** Caller-facing request. `maxTokens`/`temperature` are optional per-call overrides —
 *  `maxTokens` is clamped down to (never rejected above) `ClaudeConfig.maxOutputTokens`;
 *  `temperature` overrides `ClaudeConfig.temperature` outright when supplied (design.md D4/D7).
 *  `model` is intentionally *not* a field here: it is configuration-only (`ClaudeConfig.model`),
 *  never a per-call override, per the ticket's "not hardcoded at call sites" requirement. */
final case class ClaudeRequest(
    messages: Seq[ClaudeMessage],
    maxTokens: Option[Int] = None,
    temperature: Option[Double] = None
)

/** Token usage as reported by the Anthropic API's own `usage` field — never inferred from the
 *  pre-flight `jtokkit` estimate (design.md D4/D9: the estimate is for the guardrail check only,
 *  real cost accounting always uses this). */
final case class TokenUsage(inputTokens: Int, outputTokens: Int)

/** Successful, fully-assembled `send` result. */
final case class ClaudeResponse(id: String, text: String, stopReason: Option[String], usage: TokenUsage)

/** Closed failure set for [[ClaudeClient.send]]'s `Left` channel (design.md D3), matching this
 *  codebase's `ServiceError`-style "sealed trait + object of case classes" convention. */
sealed trait ClaudeError

object ClaudeError {

  /** The Anthropic API responded with a non-2xx status (`send`), or a mid-stream `error` SSE
   *  frame was received (`stream`, where no HTTP status applies to an individual frame — `status`
   *  is `0` as a documented sentinel in that case; see `ClaudeSseFrameParser`). */
  final case class ApiError(status: Int, body: String) extends ClaudeError

  /** The request never reached / returned from the transport layer (connection failure, timeout,
   *  response-body parse failure). */
  final case class TransportFailure(message: String) extends ClaudeError

  /** The pre-flight input-token estimate exceeded `ClaudeConfig.maxInputTokens`; the transport was
   *  never invoked. */
  final case class GuardrailExceeded(reason: String) extends ClaudeError
}

/** Streaming Messages API surface exposed by [[ClaudeClient.stream]] (design.md D5), covering the
 *  subset of Anthropic SSE event kinds a caller needs to assemble streamed text and final usage —
 *  see design.md's Non-Goals for the event kinds intentionally left unmodeled (e.g.
 *  `content_block_start`/`content_block_stop`), which `ClaudeSseFrameParser` silently drops. */
sealed trait ClaudeStreamEvent

object ClaudeStreamEvent {
  final case class MessageStart(id: String, model: String) extends ClaudeStreamEvent
  final case class TextDelta(text: String) extends ClaudeStreamEvent

  /** Carries the `usage` object attached to a `message_delta` frame. Anthropic's real
   *  `message_delta` usage only ever carries `output_tokens` (input-token accounting happened on
   *  `message_start`); `TokenUsage.inputTokens` is `0` in that case — see
   *  `ClaudeSseFrameParser.parseUsageDelta`. */
  final case class UsageDelta(usage: TokenUsage) extends ClaudeStreamEvent
  case object MessageStop                        extends ClaudeStreamEvent
  case object Ping                               extends ClaudeStreamEvent
  final case class Error(error: ClaudeError) extends ClaudeStreamEvent
}
