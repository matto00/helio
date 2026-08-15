## Context

`ClaudeClient` (`backend/src/main/scala/com/helio/ai/`) wraps a swappable `ClaudeTransport` SPI with
guardrails (input-token budget, output-token clamp) and typed error mapping. Domain types live in
`ClaudeModels.scala`, wire types mirroring the Anthropic Messages API in `ClaudeWireModels.scala`,
hand-written spray-json formatters in `ClaudeProtocol.scala` (snake_case wire fields). Today
`ClaudeApiMessage.content` is a plain `String` and `ClaudeApiRequest` carries no `tools` field —
neither can represent a `tool_use`/`tool_result` turn, which the real Anthropic API requires as a
content-block array, not a string.

HEL-659's `AssistantService` (HEL-662, not this ticket) needs a bounded, multi-turn tool-calling
loop. This ticket is the `ClaudeClient`-level primitive only — no real tools, no caller yet.

## Goals / Non-Goals

**Goals:**
- `ClaudeClient.sendWithTools` runs a multi-turn loop: send → parse `tool_use` blocks → execute via
  caller-supplied executor → feed `tool_result` back → repeat, bounded by a caller-supplied `maxHops`.
- Graceful, typed termination on hop-budget exhaustion — no exception, no infinite loop.
- `send`/`stream` and their wire types are untouched in shape and behavior.

**Non-Goals:**
- No real tools (`find`, `get_resource`, `propose_*`) — HEL-661/662.
- No hardcoded hop count inside `ClaudeClient` — `maxHops` is caller-supplied; HEL-662 passes `3`.
- No user-facing "couldn't resolve this" copy — `HopBudgetExhausted` is a structured outcome; the
  caller (HEL-662+) owns presentation text, per the design spec's system-prompt/error-handling split.
- No conversation persistence or system-prompt construction (HEL-663).

## Decisions

**D1 — Parallel domain/wire types, not a widened `ClaudeMessage`/`ClaudeApiMessage`.** Add
`ClaudeContentBlock` (sealed: `Text`/`ToolUse`/`ToolResult`), `ClaudeToolMessage(role, content:
Seq[ClaudeContentBlock])`, `ClaudeTool(name, description, inputSchema)`, `ClaudeToolRequest(history,
tools, maxHops, maxTokens, temperature)`, and `ClaudeToolOutcome` (`FinalResponse` /
`HopBudgetExhausted` / `Failed`) in `ClaudeModels.scala`, entirely alongside the existing
`ClaudeMessage`/`ClaudeRequest`/`ClaudeResponse`. *Alternative rejected*: widen `ClaudeMessage.content`
from `String` to a block-array type. Rejected because it changes a field type every existing call
site and test constructs positionally/by name, for no benefit to `send`/`stream` callers who never
need blocks — directly conflicts with "existing single-shot methods are unchanged."

**D2 — `ClaudeApiContentBlock` grows additive optional fields, not a new sealed wire hierarchy.**
`id`, `name`, `input: Option[JsValue]` (tool_use), `toolUseId`, `isError` (tool_result) are added
with default `None`, alongside the existing `blockType`/`text`. All existing named-arg construction
(`ClaudeApiContentBlock(blockType = "text", text = Some(...))` in `ClaudeClientSpec`) and the
existing `claudeApiContentBlockFormat` reader (already only reading `type`/`text`) keep compiling and
behaving unchanged; the formatter gains branches for `tool_use`/`tool_result` block types.

**D3 — New wire request/message types (`ClaudeApiToolMessage`, `ClaudeApiTool`,
`ClaudeApiToolRequest`), not a widened `ClaudeApiRequest`.** Mirrors D1's reasoning at the wire
layer: `ClaudeApiRequest.messages: Seq[ClaudeApiMessage]` (content: `String`) stays exactly as
`send`/`stream` need it. `ClaudeApiToolRequest` carries `messages: Seq[ClaudeApiToolMessage]`
(content: `Seq[ClaudeApiContentBlock]`) plus `tools: Seq[ClaudeApiTool]`; no `stream` field —
`sendWithTools` is non-streaming per hop (mirrors `send`, not `stream`; per-hop progress streaming to
the frontend, if any, is `AssistantService`'s own concern layered on top, per the design spec's
"stream progress events to the frontend" line describing the *assistant* turn, not this primitive).

**D4 — `ClaudeTransport` gains `sendTool(request: ClaudeApiToolRequest): Future[ClaudeApiResponse]`
as a trait member **with a default implementation** (throws `UnsupportedOperationException`,
mirroring the existing "outbound-only" pattern already used for `claudeApiRequestFormat.read` in
`ClaudeProtocol.scala`), `send`/`stream` unchanged. `ClaudeTransport` has **7 implementers today**,
not just `HttpClaudeTransport` and `ClaudeClientSpec`'s fake: 5 more `FakeClaudeTransport` classes
exist in `AuthoringTelemetrySpec`, `DashboardAuthoringRoutesSpec`, `RefinementRoutesSpec`,
`DashboardAuthoringServiceSpec`, and `RefinementServiceSpec` (in `com.helio.api.routes` /
`com.helio.services`), each implementing only `send`/`stream` today, none of which will ever call
`sendTool`. A default body keeps all 5 compiling untouched — the "additive, minimal blast radius"
philosophy D1–D3 already establish, applied to the transport SPI too, not just the message/request
types. `ClaudeApiResponse`/`ClaudeApiContentBlock` are reused as the response shape (a tool-use
response is still `id`/`content`/`stopReason`/`usage`; only `content` now may include `tool_use`
blocks). `HttpClaudeTransport` overrides `sendTool` against the same `/v1/messages` endpoint (a
request-shape variant of the same Anthropic API, not a different endpoint), so the primitive is
real end-to-end once HEL-662 supplies actual tools — not just testable-in-isolation. `ClaudeClient`
tests substitute a fake `ClaudeTransport` overriding `sendTool` to record invocations, mirroring
`ClaudeClientSpec`'s existing `FakeClaudeTransport` pattern.

**D5 — Hop accounting: one hop = one Claude round-trip, regardless of how many `tool_use` blocks
that turn contains.** A single response may request several tools in parallel (Anthropic's own
pattern); all are executed and their results returned in one `tool_result`-bearing user turn before
the count increments. `maxHops = 3` (HEL-662's value) means at most 3 such round trips; a response
requesting tools on what would be the 4th round trip is detected and the loop stops *before*
executing anything or making a further Claude call — returns `HopBudgetExhausted(history, usage)`.

**D6 — Guardrail reuse.** The existing `guardrailReject`/`ClaudeTokenEstimator` check runs before
*every* hop's outbound call (history grows each hop), not just the first — approximating block
content (tool inputs/results) as flattened text for the estimate, since it is a pre-flight guardrail,
not exact billing (billing still comes from the real API `usage`, summed across hops into the
returned `TokenUsage`, exactly as design.md D4/D9 for `send` already establishes). Mechanically,
`ClaudeTokenEstimator.estimate` takes `Seq[ClaudeMessage]` (`content: String`), not
`Seq[ClaudeToolMessage]` (`content: Seq[ClaudeContentBlock]`) — `sendWithTools` flattens each
`ClaudeToolMessage`'s blocks into a single string (text verbatim; tool_use `input`/tool_result
`content` JSON/text-stringified) and calls the existing estimator against that flattened
`Seq[ClaudeMessage]`, rather than adding a second estimator overload. A mid-loop guardrail
rejection returns `ClaudeToolOutcome.Failed(ClaudeError.GuardrailExceeded(_))`.

**D7 — Tool execution errors feed back as an `is_error` tool_result, not a crash.** Matches the
design spec's error-handling section ("fed back to Claude as a tool result... instead of crashing the
turn") — `ClaudeToolExecutor.execute` returns `Future[Either[String, String]]`; a `Left` becomes a
`ToolResult(id, message, isError = true)`, consuming the hop exactly like a success.

## Risks / Trade-offs

- **Wire-format drift risk**: hand-written formatters for a second request shape (`ClaudeApiTool`,
  `ClaudeApiToolMessage`, `ClaudeApiToolRequest`) duplicate some of `ClaudeProtocol`'s existing
  snake_case mapping conventions → mitigated by reusing `claudeApiContentBlockFormat` unchanged
  (single source of truth for block JSON) rather than a parallel block formatter.
- **Token-estimate accuracy on block content** is approximate (D6) → acceptable, matches the existing
  guardrail's own documented role as a pre-flight estimate, not exact billing.
- **`ClaudeTransport` SPI grows a third method** → given a default (throwing) implementation per D4,
  so none of the 7 existing implementers (`HttpClaudeTransport` plus 6 test fakes across
  `com.helio.ai`, `com.helio.api.routes`, and `com.helio.services` — `ClaudeClient` already has
  real callers today via `ApiRoutes.scala`) need to change; only `HttpClaudeTransport` and the new
  `ClaudeClientSpec` fake override it.

## Planner Notes

- Self-approved: introducing new types rather than widening existing ones (D1/D3) — smallest
  blast radius for "existing send/stream unchanged," consistent with CONTRIBUTING.md's preference
  for additive, non-breaking changes when both are otherwise reasonable.
- Self-approved: wiring `HttpClaudeTransport.sendTool` for real (D4) rather than leaving it
  unimplemented — the ticket's "no actual tools yet" scopes out `find`/`get_resource`/`propose_*`
  only, not the transport-level ability to talk to Anthropic's tool-use wire shape at all.
- Self-approved (design-gate round 1 REFUTE fix): `sendTool` gets a default (throwing) trait-level
  body rather than being abstract, after the skeptic found 5 additional `FakeClaudeTransport`
  implementers outside `com.helio.ai` (`com.helio.api.routes`, `com.helio.services`) that would
  otherwise fail to compile the moment task 3.1 landed — see D4.
