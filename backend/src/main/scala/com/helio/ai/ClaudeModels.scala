package com.helio.ai

import spray.json.JsValue

import scala.concurrent.{ExecutionContext, Future}

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
 *  real cost accounting always uses this). `cacheCreationInputTokens`/`cacheReadInputTokens`
 *  (assistant-prompt-caching design.md D4) default `0` so every existing 2-arg construction site
 *  keeps compiling; `ClaudeClient.addUsage` sums all four counters across tool-loop hops. */
final case class TokenUsage(
    inputTokens: Int,
    outputTokens: Int,
    cacheCreationInputTokens: Int = 0,
    cacheReadInputTokens: Int = 0
)

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

/** A single content block of a [[ClaudeToolMessage]] turn (design.md D1) — parallel to, and
 *  deliberately not unifying with, `ClaudeMessage.content: String`: `send`/`stream` callers never
 *  need blocks, so widening the existing type would touch every call site for no benefit (design.md
 *  D1's rejected alternative). */
sealed trait ClaudeContentBlock

object ClaudeContentBlock {
  final case class Text(text: String) extends ClaudeContentBlock

  /** Claude requesting a tool call. `input` is the tool's arguments as raw JSON — validated/decoded
   *  by the caller-supplied [[ClaudeToolExecutor]], never by `ClaudeClient` itself. */
  final case class ToolUse(id: String, name: String, input: JsValue) extends ClaudeContentBlock

  /** The result fed back to Claude for a prior `ToolUse`, keyed by `toolUseId`. `isError = true`
   *  when the executor resolved to `Left`, threw, or its `Future` failed (design.md D7, widened
   *  HEL-667 design.md D3) — Claude sees a failed tool call, the overall `Future` never fails for
   *  it. */
  final case class ToolResult(toolUseId: String, content: String, isError: Boolean = false) extends ClaudeContentBlock

  /** Anthropic executing one of its OWN server-side tools inline during generation (HEL-757
   *  design.md D2) — e.g. `name = "web_search"`. Distinct from [[ToolUse]] (a CLIENT tool Claude
   *  wants the caller's [[ClaudeToolExecutor]] to run): a `ServerToolUse` requires no client-side
   *  execution and is never dispatched to `executor.execute` — `ClaudeClient.sendWithTools` only
   *  ever collects it into history untouched. `input` mirrors `ToolUse.input`'s "raw JSON,
   *  uninterpreted by ClaudeClient" contract. */
  final case class ServerToolUse(id: String, name: String, input: JsValue) extends ClaudeContentBlock

  /** The result Anthropic's own server-side execution produced for a prior [[ServerToolUse]],
   *  keyed by `toolUseId` (HEL-757 design.md D2/D4) — e.g. a `web_search_tool_result` block.
   *  `result` is kept OPAQUE/pass-through `JsValue`, never modeled field-by-field: this ticket's
   *  explicit Non-Goal is no result-content filtering, so there is nothing `ClaudeClient` needs to
   *  extract from it. `name` mirrors the originating [[ServerToolUse]]'s tool name — the wire
   *  `web_search_tool_result` block itself carries no `name` field, so callers constructing this
   *  from the wire shape supply the one constant name this ticket wires ("web_search"). */
  final case class ServerToolResult(toolUseId: String, name: String, result: JsValue) extends ClaudeContentBlock
}

/** A single tool-use-loop conversation turn — the `ClaudeToolRequest`/`ClaudeToolOutcome` analog of
 *  [[ClaudeMessage]] (design.md D1). */
final case class ClaudeToolMessage(role: String, content: Seq[ClaudeContentBlock])

object ClaudeToolMessage {

  /** Convenience constructor for a plain-text turn (e.g. the initial user prompt seeding
   *  `ClaudeToolRequest.history`), so callers don't have to hand-wrap a single `Text` block. */
  def text(role: String, text: String): ClaudeToolMessage =
    ClaudeToolMessage(role, Seq(ClaudeContentBlock.Text(text)))
}

/** A tool `sendWithTools` may offer Claude, described the same way the Anthropic Messages API
 *  expects: a name, a natural-language description, and a JSON Schema for its input. No actual
 *  tools are defined by this ticket (HEL-661/662 supply them) — `ClaudeTool` is the shape a caller
 *  constructs one with. */
final case class ClaudeTool(name: String, description: String, inputSchema: JsValue)

/** Caller-facing request for [[ClaudeClient.sendWithTools]]. `maxHops` is a REQUIRED, caller-supplied
 *  parameter — never a `ClaudeClient`-internal constant (ticket scope boundary; HEL-662's
 *  `AssistantService` is the caller that will pass `3`). `maxTokens`/`temperature` mirror
 *  [[ClaudeRequest]]'s identical optional per-call overrides.
 *
 *  `webSearch` (HEL-757 design.md D2) opts this call into Anthropic's server-side `web_search`
 *  tool, alongside `tools`' ordinary custom function-tools. Defaults `false` so every existing
 *  caller/construction site is completely unaffected — `AssistantService.converse` is the only
 *  caller that sets it `true` today. */
final case class ClaudeToolRequest(
    history: Seq[ClaudeToolMessage],
    tools: Seq[ClaudeTool],
    maxHops: Int,
    maxTokens: Option[Int] = None,
    temperature: Option[Double] = None,
    webSearch: Boolean = false
)

/** Caller-supplied tool execution callback (design.md D7, widened HEL-667 design.md D3). A `Left`
 *  is a recoverable tool-execution failure — fed back to Claude as an `isError = true` `ToolResult`
 *  so the loop can continue. So is a THROWN exception from `execute` or a FAILED `Future` it
 *  returns: `ClaudeClient.executeTool` recovers all three shapes identically, so an implementation
 *  is free to `throw`/fail its `Future` for an unexpected error instead of hand-wrapping every
 *  failure path in an explicit `Left` — none of them ever raise a failed `sendWithTools` `Future`. */
trait ClaudeToolExecutor {
  def execute(name: String, input: JsValue)(implicit ec: ExecutionContext): Future[Either[String, String]]
}

/** Closed outcome set for [[ClaudeClient.sendWithTools]] (design.md D1), matching this codebase's
 *  `ServiceError`-style "sealed trait + object of case classes" convention already used by
 *  [[ClaudeError]]. */
sealed trait ClaudeToolOutcome

object ClaudeToolOutcome {

  /** Claude returned a response with no `tool_use` block — the loop is done. `history` is the full
   *  accumulated turn sequence (useful for a caller that wants to persist/display the transcript);
   *  `usage` is summed across every hop (design.md D5). */
  final case class FinalResponse(text: String, history: Seq[ClaudeToolMessage], usage: TokenUsage) extends ClaudeToolOutcome

  /** `maxHops` round trips were already used and Claude requested another tool call — the loop
   *  terminates gracefully (design.md D5): no exception, no further transport call. */
  final case class HopBudgetExhausted(history: Seq[ClaudeToolMessage], usage: TokenUsage) extends ClaudeToolOutcome

  /** A guardrail rejection or transport/API failure at any hop (design.md D6/D7's error-mapping
   *  parity with [[ClaudeClient.send]]). */
  final case class Failed(error: ClaudeError) extends ClaudeToolOutcome
}
