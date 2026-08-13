# claude-api-client Specification

## Purpose
A reusable, non-blocking, streaming-capable server-side client for the Anthropic Claude Messages
API — env-driven config, a swappable transport SPI, and token/cost guardrails — so backend features
like the In-App NL Authoring endpoint can be thin callers instead of each re-implementing key
handling, streaming, and budget enforcement.
## Requirements
### Requirement: Config is env-sourced and never hardcoded at call sites
The backend SHALL define `ClaudeConfig` in `com.helio.ai`, constructed via `ClaudeConfig.fromEnv():
Either[String, ClaudeConfig]`, reading the API key from `ANTHROPIC_API_KEY`, the model id from
`CLAUDE_MODEL` (default `claude-opus-4-8`), temperature from `CLAUDE_TEMPERATURE` (default `1.0`),
and token ceilings from `CLAUDE_MAX_TOKENS` (default `4096`) / `CLAUDE_MAX_INPUT_TOKENS` (default
`100000`). No call site SHALL hardcode a model id, temperature, max-tokens value, or API key
literal.

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
outputTokens)` populated from the Anthropic API response's own `usage` field — never from the
pre-flight estimate.

#### Scenario: Usage reflects the API response, not the estimate
- **WHEN** a stub transport returns a response whose `usage` differs from the pre-flight estimated
  input token count
- **THEN** `ClaudeResponse.usage` equals the transport response's `usage`, not the estimate

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

