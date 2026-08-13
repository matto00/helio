## 1. Backend: config

- [x] 1.1 Create `com.helio.ai` package.
- [x] 1.2 Add `ClaudeConfig` (`apiKey`, `model`, `maxOutputTokens`, `maxInputTokens`, `temperature`)
      with `ClaudeConfig.fromEnv(): Either[String, ClaudeConfig]` reading `ANTHROPIC_API_KEY`,
      `CLAUDE_MODEL` (default `claude-opus-4-8`), `CLAUDE_TEMPERATURE` (default `1.0`),
      `CLAUDE_MAX_TOKENS` (default `4096`), `CLAUDE_MAX_INPUT_TOKENS` (default `100000`).
- [x] 1.3 Ensure `ClaudeConfig`'s `toString`/logging never renders `apiKey`.

## 2. Backend: protocol + errors

- [x] 2.1 Define `ClaudeApiRequest`/`ClaudeApiResponse` wire types (spray-json protocol) for the
      Messages API (`model`, `max_tokens`, `messages`, `temperature`, `stream`).
- [x] 2.2 Define `TokenUsage(inputTokens, outputTokens)` and `ClaudeResponse` (text + `usage`).
- [x] 2.3 Define `ClaudeError` (`ApiError(status, body)`, `TransportFailure(message)`,
      `GuardrailExceeded(reason)`).
- [x] 2.4 Define `ClaudeStreamEvent` ADT covering message-start, text-delta, usage/message-delta,
      message-stop, ping, and error.

## 3. Backend: transport SPI

- [x] 3.1 Define `trait ClaudeTransport { def send(...): Future[ClaudeApiResponse]; def
      stream(...): Source[ClaudeStreamEvent, NotUsed] }`.
- [x] 3.2 Implement `HttpClaudeTransport` over `pekko-http` (`Http(system.classicSystem).
      singleRequest`, `x-api-key`/`anthropic-version`/`content-type` headers, connect/idle timeouts
      matching `RestApiConnector`'s `ConnectionPoolSettings` shape).
- [x] 3.3 Implement SSE frame parsing (`Framing.delimiter` on `\n\n`, `event:`/`data:` line parsing)
      into `ClaudeStreamEvent`s, tolerant of frames split across chunk boundaries.

## 4. Backend: guardrails + client

- [x] 4.1 Add an input-token estimator (via `jtokkit`), documented as an estimate, not exact.
- [x] 4.2 Implement `ClaudeClient.send`: estimate input tokens → reject
      (`GuardrailExceeded`) over `maxInputTokens` before any network call; clamp requested
      `maxTokens` to `ClaudeConfig.maxOutputTokens`; delegate to `ClaudeTransport.send`; map
      transport/API failures to `ClaudeError`; never log the API key.
- [x] 4.3 Implement `ClaudeClient.stream`: run the same pre-flight input-token guardrail check as
      `send`; on rejection return `Source.single(ClaudeStreamEvent.Error(GuardrailExceeded(...)))`
      and complete, with zero `ClaudeTransport.stream` invocations; otherwise delegate to
      `ClaudeTransport.stream`.

## 5. Infra

- [x] 5.1 Add `ANTHROPIC_API_KEY=helio-anthropic-api-key:latest` to `infra/deploy-backend.sh`'s
      `--set-secrets` list.
- [x] 5.2 Add a documentation-only note to `infra/.env.deploy.example` (mirroring the existing
      `COOKIE_SECURE` note) explaining `ANTHROPIC_API_KEY` is sourced via Secret Manager in
      `deploy-backend.sh`, not set in this file.
- [x] 5.3 Add `ANTHROPIC_API_KEY` (+ optional `CLAUDE_MODEL`/`CLAUDE_TEMPERATURE`/
      `CLAUDE_MAX_TOKENS`/`CLAUDE_MAX_INPUT_TOKENS`) to `CLAUDE.md`'s prod env-var table.

## 6. Tests

- [x] 6.1 `ClaudeConfigSpec`: key present/absent/blank, model/temperature/max-tokens/max-input-tokens
      defaults + overrides, no key in `toString`/logs.
- [x] 6.2 `ClaudeClientSpec` (stub `ClaudeTransport`, Mockito or a hand-written fake): request
      construction (model/max-tokens/temperature/messages wired through), over-input-budget
      rejection with zero transport invocations (both `send` and `stream`), over-output-ceiling
      clamping, successful-response `usage` passthrough, API-error mapping, key never appears in
      captured log output (e.g. a Logback `ListAppender` attached to the relevant logger).
- [x] 6.3 `ClaudeStreamAssemblySpec`: text-delta concatenation reproduces full text, usage exposed
      on `message_delta`, error frame surfaces as a typed error event, frames split across chunk
      boundaries still parse correctly.
- [x] 6.4 Confirm `sbt test` is green with no real network call (no test depends on
      `ANTHROPIC_API_KEY`/live network being present).
