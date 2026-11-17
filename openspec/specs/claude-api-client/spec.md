# claude-api-client Specification

## Purpose
A reusable, non-blocking, streaming-capable server-side client for the Anthropic Claude Messages
API — env-driven config, a swappable transport SPI, and token/cost guardrails — so backend features
like the In-App NL Authoring endpoint can be thin callers instead of each re-implementing key
handling, streaming, and budget enforcement.

## Requirements

### Requirement: Config is env-sourced and never hardcoded at call sites
The backend SHALL define `ClaudeConfig` in `com.helio.infrastructure.ai`, constructed via `ClaudeConfig.fromEnv():
Either[String, ClaudeConfig]`, reading the API key from `ANTHROPIC_API_KEY`, the model id from
`CLAUDE_MODEL` (default `claude-opus-4-8`), temperature from `CLAUDE_TEMPERATURE` (default `1.0`),
token ceilings from `CLAUDE_MAX_TOKENS` (default `4096`) / `CLAUDE_MAX_INPUT_TOKENS` (default
`100000`), and the per-turn `web_search` call budget from `CLAUDE_WEB_SEARCH_MAX_USES` (default `3`).
No call site SHALL hardcode a model id, temperature, max-tokens value, web-search-budget value, or
API key literal.

#### Scenario: Key present
- **WHEN** `ANTHROPIC_API_KEY` is set to a non-blank value in the environment
- **THEN** `ClaudeConfig.fromEnv()` returns `Right(config)` with `config.apiKey` equal to that value

#### Scenario: Key absent or blank
- **WHEN** `ANTHROPIC_API_KEY` is unset or blank in the environment
- **THEN** `ClaudeConfig.fromEnv()` returns `Left(<clear error message naming the missing variable>)`

#### Scenario: Model id defaults and is overridable
- **WHEN** `CLAUDE_MODEL` is unset
- **THEN** `ClaudeConfig.fromEnv()`'s resulting config has `model == "claude-opus-4-8"`, and setting
  `CLAUDE_MODEL` to another value overrides it

#### Scenario: Temperature defaults and is overridable
- **WHEN** `CLAUDE_TEMPERATURE` is unset
- **THEN** `ClaudeConfig.fromEnv()`'s resulting config has `temperature == 1.0`, and setting
  `CLAUDE_TEMPERATURE` to another value overrides it

#### Scenario: Token ceilings default when unset
- **WHEN** `CLAUDE_MAX_TOKENS` and `CLAUDE_MAX_INPUT_TOKENS` are both unset
- **THEN** `ClaudeConfig.fromEnv()`'s resulting config has `maxOutputTokens == 4096` and
  `maxInputTokens == 100000`, and setting either env var overrides its respective default

#### Scenario: web_search budget defaults and is overridable
- **WHEN** `CLAUDE_WEB_SEARCH_MAX_USES` is unset
- **THEN** `ClaudeConfig.fromEnv()`'s resulting config has `webSearchMaxUses == 3`, and setting
  `CLAUDE_WEB_SEARCH_MAX_USES` to another value overrides it

### Requirement: The client never blocks an actor/execution path
`ClaudeClient`'s `send` and `stream` methods SHALL return `Future[Either[ClaudeError,
ClaudeResponse]]` and `Source[ClaudeStreamEvent, NotUsed]` respectively; neither SHALL perform a
blocking network or I/O call on the calling thread.

#### Scenario: send returns a Future immediately
- **WHEN** `ClaudeClient.send(request)` is called
- **THEN** it returns a `Future` without blocking the calling thread for the network round trip

### Requirement: The Anthropic transport is a swappable SPI
The backend SHALL define `trait ClaudeTransport` with `send`/`stream` methods that `ClaudeClient`
delegates to, and a production `HttpClaudeTransport` implementation over `pekko-http`. Tests SHALL
be able to substitute a stub/mock `ClaudeTransport` so the automated suite makes no real network
call.

#### Scenario: A stub transport satisfies the test suite
- **WHEN** `ClaudeClient` is constructed with a stub `ClaudeTransport` that returns a canned
  response
- **THEN** `ClaudeClient.send` resolves using that canned response, with no outbound network
  connection made

### Requirement: Streaming responses are modeled and exposed to callers
`ClaudeClient.stream(request)` SHALL return a `Source[ClaudeStreamEvent, NotUsed]` assembled from
the Anthropic streaming Messages API's SSE frames, covering at minimum: message start, incremental
text deltas, final usage, and stream completion/error events.

#### Scenario: Text deltas assemble into the full response text
- **WHEN** a stub transport emits a `message_start` frame, a sequence of `content_block_delta` text
  frames, and a `message_stop` frame
- **THEN** concatenating the emitted `ClaudeStreamEvent` text-delta payloads, in order, reproduces
  the full response text

#### Scenario: Final usage is exposed on stream completion
- **WHEN** a stub transport's SSE stream includes a `message_delta` frame carrying `usage`
- **THEN** the corresponding `ClaudeStreamEvent` in the resulting `Source` exposes that token usage
  to the caller

#### Scenario: A stream error surfaces as a typed event, not a silent drop
- **WHEN** a stub transport's SSE stream includes an `error` frame
- **THEN** the resulting `Source` emits a corresponding error `ClaudeStreamEvent` rather than
  terminating with no signal

### Requirement: A max-output-tokens ceiling is enforced
`ClaudeClient` SHALL clamp any caller-requested `maxTokens` above `ClaudeConfig.maxOutputTokens`
down to that ceiling before issuing the request; it SHALL NOT reject a request solely for
requesting more output tokens than the ceiling.

#### Scenario: Over-ceiling request is clamped, not rejected
- **WHEN** a caller requests `maxTokens` greater than `ClaudeConfig.maxOutputTokens`
- **THEN** the outbound request's `max_tokens` value equals `ClaudeConfig.maxOutputTokens`, and the
  call proceeds (no `GuardrailExceeded` error)

### Requirement: A max-input-tokens budget rejects over-budget requests deterministically
`ClaudeClient` SHALL estimate the request's input token count before issuing any network call; when
the estimate exceeds `ClaudeConfig.maxInputTokens`, it SHALL return
`Left(ClaudeError.GuardrailExceeded(reason))` without making a network call.

#### Scenario: Over-budget input is rejected before any network call
- **WHEN** a request's estimated input token count exceeds `ClaudeConfig.maxInputTokens`
- **THEN** `ClaudeClient.send` resolves to `Left(ClaudeError.GuardrailExceeded(_))`, and the
  injected `ClaudeTransport` records zero invocations

#### Scenario: Under-budget input proceeds normally
- **WHEN** a request's estimated input token count is at or below `ClaudeConfig.maxInputTokens`
- **THEN** `ClaudeClient.send` issues the request via the transport as normal

### Requirement: The max-input-tokens guardrail applies identically to streaming
`ClaudeClient.stream` SHALL run the same pre-flight input-token estimate as `send`. When the
estimate exceeds `ClaudeConfig.maxInputTokens`, `stream` SHALL return a `Source` that emits exactly
one `ClaudeStreamEvent` representing the guardrail rejection and then completes, without invoking
`ClaudeTransport.stream`.

#### Scenario: Over-budget input rejects the stream before any transport call
- **WHEN** a request's estimated input token count exceeds `ClaudeConfig.maxInputTokens` and
  `ClaudeClient.stream(request)` is run
- **THEN** the resulting `Source` emits exactly one `ClaudeStreamEvent` carrying the
  `GuardrailExceeded` reason and completes, and the injected `ClaudeTransport` records zero
  `stream` invocations

### Requirement: Token usage is returned for cost logging
On a successful `send`, `ClaudeResponse` SHALL expose `usage: TokenUsage(inputTokens,
outputTokens, cacheCreationInputTokens, cacheReadInputTokens)` populated from the Anthropic API
response's own `usage` field — never from the pre-flight estimate. The cache-token counters SHALL
parse `cache_creation_input_tokens`/`cache_read_input_tokens` tolerantly, defaulting to 0 when the
API omits them, and the tool-use loop SHALL aggregate all four counters across hops into the
outcome's `TokenUsage`.

#### Scenario: Usage reflects the API response, not the estimate
- **WHEN** a stub transport returns a response whose `usage` differs from the pre-flight estimated
  input token count
- **THEN** `ClaudeResponse.usage` equals the transport response's `usage`, not the estimate

#### Scenario: Cache counters absent from the API response default to zero
- **WHEN** a transport response's `usage` object carries no `cache_creation_input_tokens` or
  `cache_read_input_tokens` fields
- **THEN** the parsed usage exposes 0 for both cache counters and parsing does not fail

#### Scenario: Cache counters aggregate across tool-loop hops
- **WHEN** `sendWithTools` completes a multi-hop loop whose per-hop API responses carry nonzero
  `cache_read_input_tokens`
- **THEN** the outcome's `TokenUsage.cacheReadInputTokens` equals the sum across all hops

### Requirement: The API key never appears in logs
`ClaudeConfig`, `ClaudeClient`, and `HttpClaudeTransport` SHALL NOT emit any log line — at any log
level, including on an API/transport error — that contains the configured `ANTHROPIC_API_KEY`
value.

#### Scenario: An API error does not leak the key
- **WHEN** the transport returns an API error response (e.g. HTTP 401) and `ClaudeClient` logs the
  failure
- **THEN** the resulting log output does not contain the configured API key value

#### Scenario: Config construction does not leak the key
- **WHEN** `ClaudeConfig.fromEnv()` is called and any resulting log statement is emitted
- **THEN** the resulting log output does not contain the configured API key value

### Requirement: Mid-stream connection failures surface as a typed error event
`ClaudeClient.stream` and `HttpClaudeTransport.stream` SHALL NOT silently hang or terminate the
`Source` with no signal when the underlying SSE connection fails or drops after streaming has
already started; a mid-stream failure SHALL surface as a `ClaudeStreamEvent.Error` element, after
which the `Source` SHALL complete.

#### Scenario: A mid-stream connection drop surfaces as an error event, not a silent hang
- **WHEN** the byte source driving an active `ClaudeClient.stream` call fails after at least one
  prior `ClaudeStreamEvent` has already been emitted
- **THEN** the resulting `Source` emits a `ClaudeStreamEvent.Error` element and then completes,
  rather than hanging indefinitely or terminating with an unhandled stream failure

### Requirement: A bounded multi-turn tool-use loop is available
`ClaudeClient` SHALL expose `sendWithTools(request: ClaudeToolRequest, executor:
ClaudeToolExecutor): Future[ClaudeToolOutcome]`, where `ClaudeToolRequest` carries a message
history, a tool schema list, and a caller-supplied `maxHops` value. The loop SHALL: send the
current history and tools to the transport; when the response contains no `tool_use` content
block, return `ClaudeToolOutcome.FinalResponse`; when it contains one or more `tool_use` blocks
and the hop budget is not yet exhausted, invoke `executor` for each `tool_use` block, append a
`tool_result`-bearing turn to the history, and repeat.

#### Scenario: A single tool round-trip resolves to a final answer
- **WHEN** a fake transport's first scripted response contains a `tool_use` block and its second
  scripted response contains only a final text block
- **THEN** `sendWithTools` invokes the executor exactly once and resolves to
  `ClaudeToolOutcome.FinalResponse` carrying the second response's text

#### Scenario: A response with no tool_use resolves immediately, zero executor invocations
- **WHEN** a fake transport's first scripted response contains only a final text block
- **THEN** `sendWithTools` resolves to `ClaudeToolOutcome.FinalResponse` without invoking the
  executor at all

### Requirement: The tool-use loop hard-caps at a caller-supplied hop count
`sendWithTools` SHALL NOT execute a `tool_use` block, and SHALL NOT issue a further request to the
transport, once `maxHops` round trips have already been used; it SHALL instead resolve to
`ClaudeToolOutcome.HopBudgetExhausted` carrying the accumulated history and usage. `maxHops` SHALL
be a parameter of `ClaudeToolRequest` supplied by the caller, never a value hardcoded inside
`ClaudeClient`.

#### Scenario: A 4th tool_use attempt terminates gracefully instead of looping again
- **GIVEN** `maxHops = 3` and a fake transport whose first four scripted responses each contain a
  `tool_use` block (fails/throws if invoked a 5th time)
- **WHEN** `sendWithTools` is called
- **THEN** the executor is invoked exactly 3 times, the transport is invoked exactly 4 times, and
  the result is `ClaudeToolOutcome.HopBudgetExhausted` — not an exception, not a 5th transport call

#### Scenario: Exactly at the hop budget still resolves normally
- **GIVEN** `maxHops = 3` and a fake transport whose first three scripted responses each contain a
  `tool_use` block and whose fourth scripted response contains only a final text block
- **WHEN** `sendWithTools` is called
- **THEN** the executor is invoked exactly 3 times and the result is
  `ClaudeToolOutcome.FinalResponse`

### Requirement: A failed tool execution is fed back to Claude, not raised as an exception
`sendWithTools` SHALL feed a failed tool execution back to Claude as an `isError` tool_result
rather than failing the overall `Future`, regardless of HOW that failure manifests: an explicit
`Left(message)` from the injected `ClaudeToolExecutor`, a thrown exception during `execute`, or a
failed inner `Future` the executor returns — every case becomes an `isError = true` tool_result,
and the loop continues (consuming one hop), never propagating as a failed `sendWithTools` `Future`.
A recovered thrown/failed-`Future` exception SHALL be logged at `warn` before being converted, so a
genuine programming-error bug in an executor stays observable rather than silently masked.

#### Scenario: A tool execution error is fed back and the loop continues
- **WHEN** the executor resolves a `tool_use` block to `Left("resource not found")` and the
  transport's next scripted response contains only a final text block
- **THEN** `sendWithTools` resolves to `ClaudeToolOutcome.FinalResponse` (the loop recovered),
  and the outbound `tool_result` block for that hop carries `isError = true`

#### Scenario: A thrown exception during tool execution is fed back, not raised
- **WHEN** the executor's `execute` throws an exception (rather than returning `Left`) for a
  `tool_use` block, and the transport's next scripted response contains only a final text block
- **THEN** `sendWithTools` resolves to `ClaudeToolOutcome.FinalResponse` (the loop recovered), the
  outbound `tool_result` block for that hop carries `isError = true`, and the exception is logged

#### Scenario: A failed inner Future from tool execution is fed back, not raised
- **WHEN** the executor's `execute` returns a failed `Future` (rather than `Future.successful(Left(_))`)
  for a `tool_use` block, and the transport's next scripted response contains only a final text
  block
- **THEN** `sendWithTools` resolves to `ClaudeToolOutcome.FinalResponse` (the loop recovered), and
  the outbound `tool_result` block for that hop carries `isError = true`

### Requirement: The existing input-token guardrail applies to every hop of the tool-use loop
`sendWithTools` SHALL run the same pre-flight input-token estimate `send` already runs before each
hop's outbound call (not only the first). When the estimate exceeds `ClaudeConfig.maxInputTokens`
mid-loop, it SHALL resolve to `ClaudeToolOutcome.Failed(ClaudeError.GuardrailExceeded(_))` without
issuing that hop's transport call.

#### Scenario: A mid-loop guardrail rejection stops the loop without a further transport call
- **GIVEN** a hop's accumulated history estimate exceeds `ClaudeConfig.maxInputTokens`
- **WHEN** `sendWithTools` would otherwise issue that hop's request
- **THEN** it resolves to `ClaudeToolOutcome.Failed(ClaudeError.GuardrailExceeded(_))` and the
  transport records no invocation for that hop

### Requirement: Token usage accumulates across every hop of the tool-use loop
`ClaudeToolOutcome.FinalResponse` and `ClaudeToolOutcome.HopBudgetExhausted` SHALL carry a
`TokenUsage` that sums `inputTokens`/`outputTokens` across every hop's transport response, not
just the final hop's.

#### Scenario: Usage sums across two hops
- **WHEN** a fake transport's first response (a `tool_use` hop) reports usage A and its second
  (final) response reports usage B
- **THEN** the resulting `ClaudeToolOutcome.FinalResponse.usage` equals the sum of A and B

### Requirement: Existing single-shot send and stream are unaffected
Adding `sendWithTools` SHALL NOT change the request/response shape, behavior, or guardrail
semantics of `ClaudeClient.send` or `ClaudeClient.stream`, and SHALL NOT modify
`ClaudeApiMessage`/`ClaudeApiRequest`'s existing fields. Prompt-cache support supersedes the
"unmodified" guarantee in exactly one additive way: every built `send`/`stream` request with a
non-empty message list carries the first-message `cacheControl` marker (see "Outbound requests
carry prompt-cache breakpoints on the stable prefix"), and `ClaudeApiMessage` gains that one
default-`None` field. Pre-existing fields SHALL keep their exact meaning and serialization.

#### Scenario: send's existing behavior is unchanged
- **WHEN** the existing `ClaudeClientSpec` suite for `send`/`stream` is run after prompt-cache
  support lands
- **THEN** every test passes, with the sole permitted modification that expected built requests
  now carry the first-message cache marker — no other expectation changes

### Requirement: Outbound requests carry prompt-cache breakpoints on the stable prefix
Outbound Anthropic Messages API requests SHALL mark the stable prompt prefix with
`"cache_control": {"type": "ephemeral"}` breakpoints: for the tool-use path (`sendTool`), on the
last element of the `tools` array, on the last block of the top-level `system` array when the request
carries a system prompt, and on the last content block of the first message; for the
non-tool path (`send`/`stream`), on the first message (its string content written as an equivalent
one-element `text` block array to carry the marker). Wire models and writers SHALL default to no
marker, and any request that sets no marker SHALL serialize byte-identically to its
pre-cache-support form.

#### Scenario: sendTool marks the tools array and the first turn
- **WHEN** a `ClaudeApiToolRequest` with a non-empty `tools` array, no system prompt and a non-empty message
  history is built and serialized for `sendTool`
- **THEN** the serialized JSON carries `"cache_control": {"type": "ephemeral"}` on the last `tools`
  element and on the last content block of the first message, and on no other element

#### Scenario: sendTool marks the system block when a system prompt is present
- **WHEN** a `ClaudeToolRequest` with a non-empty `system` prompt is built and serialized for `sendTool`
- **THEN** the serialized JSON's top-level `system` array's last block carries
  `"cache_control": {"type": "ephemeral"}`, in addition to the last-tool and first-message markers, and no other
  element carries one

#### Scenario: send marks the system-prompt-carrying first message
- **WHEN** a `ClaudeApiRequest` with a non-empty message list is built and serialized for `send`
- **THEN** the first message's content is serialized as a one-element `text` block array whose
  block carries `"cache_control": {"type": "ephemeral"}`, and later messages are plain strings

#### Scenario: Unmarked requests serialize unchanged
- **WHEN** a wire request is serialized with every `cacheControl` field left at its `None` default
- **THEN** the produced JSON is byte-identical to the serialization before cache support existed

### Requirement: A caller can request Anthropic's server-side web_search tool on a tool-use request
`ClaudeToolRequest` SHALL carry a `webSearch: Boolean` field, defaulting `false` so every existing
caller is unaffected. When `true`, `ClaudeClient.sendWithTools` SHALL include one server-side
`web_search` tool object (Anthropic's documented wire shape, distinct from a custom
`ClaudeTool`/`ClaudeApiTool`) in the outbound request's tool list, alongside `request.tools`'
ordinary custom tools.

#### Scenario: webSearch defaults to false and adds nothing to the outbound tool list
- **WHEN** a `ClaudeToolRequest` is built without setting `webSearch`
- **THEN** the outbound API request's tool list contains only the custom tools from `request.tools`

#### Scenario: webSearch = true adds the server-side tool alongside custom tools
- **WHEN** a `ClaudeToolRequest` with `webSearch = true` and two custom tools is sent
- **THEN** the outbound API request's tool list contains both custom tools plus one web_search
  server-tool entry

### Requirement: The web_search budget is enforced across the whole tool-use loop, not per hop
`sendWithTools` SHALL track the cumulative count of `web_search` server-tool invocations across every
hop of one `ClaudeToolRequest`, and SHALL stop offering the web_search tool (omit it from the
outbound tool list) on any hop once that cumulative count reaches `ClaudeConfig.webSearchMaxUses` —
regardless of `maxHops`, so a multi-hop request can never exceed the configured per-turn budget.

#### Scenario: The web_search tool is dropped once the cross-hop budget is exhausted
- **GIVEN** `ClaudeConfig.webSearchMaxUses = 2` and a fake transport whose first two scripted
  responses each contain two `web_search` server-tool-use blocks
- **WHEN** `sendWithTools` issues its third hop
- **THEN** that hop's outbound tool list omits the web_search tool entirely

#### Scenario: Budget tracking is independent per ClaudeToolRequest call
- **WHEN** two separate `sendWithTools` calls each set `webSearch = true`
- **THEN** each call's web_search budget starts fresh at `ClaudeConfig.webSearchMaxUses`, unaffected
  by how many searches the other call used

### Requirement: Server-tool content blocks are never dispatched to the caller's ClaudeToolExecutor
`ClaudeContentBlock` SHALL gain `ServerToolUse(id, name, input)` and `ServerToolResult(toolUseId,
name, result: JsValue)` cases for Anthropic's server-executed tool blocks (`server_tool_use`/
`web_search_tool_result`). `sendWithTools` SHALL append these to the accumulated history exactly as
received, but SHALL NOT invoke `executor.execute` for a `ServerToolUse` block — server tools are
already resolved by Anthropic during generation, requiring no client-side execution or synthesized
`tool_result`.

#### Scenario: A web_search call in a hop's response never reaches the executor
- **WHEN** a fake transport's scripted response contains a `server_tool_use`/`web_search_tool_result`
  pair and no client `tool_use` block
- **THEN** `executor.execute` is invoked zero times for that hop, and the loop resolves to
  `ClaudeToolOutcome.FinalResponse` once no further client tool_use is pending

#### Scenario: A web_search call and a client tool_use in the same hop are handled independently
- **WHEN** a fake transport's scripted response contains both a `server_tool_use`/
  `web_search_tool_result` pair and a client `tool_use` block
- **THEN** `executor.execute` is invoked exactly once (for the client `tool_use` block only), and the
  server-tool blocks are preserved in the appended history unchanged

### Requirement: A tool-use request can carry a system prompt in the API's system field
`ClaudeToolRequest` SHALL accept an optional `system` prompt. When it is present and non-empty, every hop of
`sendWithTools` SHALL send it as the Messages API's top-level `system` field (an array of one `text` block),
identical on every hop, and SHALL NOT place it in any message. When it is absent, the serialized request SHALL
contain no `system` key and be byte-identical to its form before this field existed. The pre-flight input-token
guardrail SHALL count the system prompt on every hop.

#### Scenario: Every hop carries the same system field
- **WHEN** `sendWithTools` runs a two-hop loop for a request with `system = Some(s)`
- **THEN** both outbound requests serialize a top-level `system` array whose single text block equals `s`, and no
  message content contains `s`

#### Scenario: No system prompt means no system key
- **WHEN** a `ClaudeApiToolRequest` with no system blocks is serialized
- **THEN** the JSON object has no `system` key

#### Scenario: The guardrail counts the system prompt
- **WHEN** a request's messages alone are under `ClaudeConfig.maxInputTokens` but messages plus `system` exceed it
- **THEN** `sendWithTools` resolves to `Failed(GuardrailExceeded(_))` with no transport call

### Requirement: Thinking and unrecognised content blocks are kept exactly, never turned into text
The client SHALL decode a `thinking` block with its `thinking` text and `signature` exactly as received (an empty
`thinking` string stays empty), a `redacted_thinking` block with its `data` exactly as received, and any other
content-block type it does not model as the complete original JSON object. No such block SHALL ever become a text
block, and none SHALL contribute to the response's answer text.

#### Scenario: Haiku 5.5 thinking block followed by text
- **WHEN** a tool-use response contains `{"type":"thinking","thinking":"","signature":"S1"}` then `{"type":"text","text":"Hi"}`
- **THEN** the turn holds a thinking block with `thinking` "" and `signature` "S1", then a text block "Hi"
- **AND** the answer text is "Hi"

#### Scenario: Unknown block type
- **WHEN** a response contains a block of a type the client does not model, carrying arbitrary fields
- **THEN** the block is held as its complete original JSON object and never as a text block

### Requirement: Within one tool-use loop, model-internal blocks are sent back unchanged
A "strip point" is a hop whose offered tools differ from the previous hop's, or a hop where removing an empty
text block would alter a message that holds a thinking block. At a strip point, the client SHALL discard every
thinking and redacted-thinking block produced so far in that loop. It SHALL never send any of them again in that
loop. Every other earlier-hop thinking, redacted-thinking and unrecognised block SHALL be sent back in the same
position and order, with every field byte-equal to what the API returned.

#### Scenario: Web search shrinks the tool list
- **WHEN** hop 1 returns a thinking block, a `web_search` server-tool use and its result, and a `tool_use` block, so
  hop 2 offers `web_search` with a smaller `max_uses`
- **THEN** hop 2's request contains no thinking block from hop 1, and still contains hop 1's other blocks

#### Scenario: A later hop after a strip point
- **WHEN** hop 2 (a strip point) returns a thinking block with signature "S2" and a `tool_use`, makes no search, and
  hop 3 offers the same tools as hop 2
- **THEN** hop 3's request contains the "S2" thinking block byte-exact and no thinking block from hop 1

#### Scenario: Thinking then tool_use, second hop
- **WHEN** hop 1 returns a thinking block (empty `thinking`, signature "S1"), a `redacted_thinking` block (data "D1")
  and a `tool_use` block, and the loop makes a second request
- **THEN** that request's assistant message contains `{"type":"thinking","thinking":"","signature":"S1"}`,
  `{"type":"redacted_thinking","data":"D1"}` and the `tool_use` block, in that order

### Requirement: The client never sends an empty text block
No request the client sends SHALL contain a text content block whose text is empty, including requests built from
history that already holds empty text blocks. A message left with no blocks after removing them SHALL be dropped, and
same-role neighbours this creates SHALL be merged so roles still alternate.

#### Scenario: Single-shot request with an empty assistant message
- **WHEN** a single-shot request's messages include an assistant message with empty content between two user messages
- **THEN** the serialized request has no empty message and the two user messages are one user message

#### Scenario: Legacy history with an empty text block
- **WHEN** the history holds an assistant turn `[text "", text "Hello"]` and the next request is built
- **THEN** the serialized request contains no `{"type":"text","text":""}` block and keeps the "Hello" block

### Requirement: A refusal or a response with no answer is a typed error
In the tool-use loop, a hop with `stop_reason` `refusal`, or a response with no `tool_use` block, no non-empty text
and `stop_reason` `max_tokens` or `pause_turn`, SHALL fail. In single-shot `send`, a refusal or any response with no
non-empty text SHALL fail. Either failure SHALL be carrying the stop reason and, for a refusal, the
`stop_details.category` when present. It SHALL never be a successful empty answer.

#### Scenario: Refusal
- **WHEN** a hop returns `stop_reason: "refusal"`, empty `content` and `stop_details.category: "cyber"`
- **THEN** the loop fails with a no-answer error carrying reason `refusal` and category `cyber`

#### Scenario: Empty end_turn after a tool hop
- **WHEN** hop 1 calls a tool and hop 2 returns `stop_reason: "end_turn"` with empty `content`
- **THEN** the loop completes successfully with empty answer text and the full tool history

#### Scenario: Single-shot refusal reaches a pipeline AI step
- **WHEN** a pipeline AI step's model call is refused
- **THEN** the AI step fails with an error naming the refusal and writes no empty output

#### Scenario: Thinking only, out of tokens
- **WHEN** a hop returns only a thinking block with `stop_reason: "max_tokens"`
- **THEN** the loop fails with a no-answer error carrying reason `max_tokens`

### Requirement: Default sampling parameters are not sent
The client SHALL omit `temperature` from the request when the resolved temperature equals the API default of 1.0, and
SHALL send it only when it differs from that default. It SHALL never send `top_p` or `top_k`.

#### Scenario: Default configuration
- **WHEN** no caller override is supplied and the configured temperature is 1.0
- **THEN** neither a `send` nor a tool-use request contains `temperature`, `top_p` or `top_k`

#### Scenario: Explicit non-default temperature
- **WHEN** the configured temperature is 0.5
- **THEN** the request carries `"temperature": 0.5`

### Requirement: Each API response's request id is logged
The transport SHALL log, for every Messages API response, the HTTP status and the `request-id` response header value.
It SHALL never log the API key, the request body or the response body as part of that line.

#### Scenario: Successful response
- **WHEN** a response arrives with header `request-id: req_123`
- **THEN** one log line names `req_123` and the status, and contains no key material
