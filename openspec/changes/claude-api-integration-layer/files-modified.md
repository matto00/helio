Cycle 2 (fold-in, design.md D9 — SSE mid-stream resilience):

- `backend/src/main/scala/com/helio/ai/ClaudeSseAssembler.scala` — added a `.recover` at the `Source` level (inside `assemble` itself, per D9) converting a mid-stream connection drop (a failure on the byte source after streaming has already started — not a request-initiation failure) into a terminal `ClaudeStreamEvent.Error(ClaudeError.TransportFailure(...))` element followed by normal completion, instead of an unhandled `Source` failure. Logs the exception, never the API key.
- `backend/src/test/scala/com/helio/ai/ClaudeStreamAssemblySpec.scala` — added a test proving a fake byte `Source` that emits a valid frame then fails produces a trailing typed error event and completes (never hangs, never fails unhandled). Uses a single-stage `.map`-based sequential-throw fixture rather than `Source.single(x) ++ Source.failed(e)`, per a probe-confirmed root cause: that `Concat`-based composition does not reliably deliver the first element before the second sub-source's failure propagates in Pekko Streams (a demand/backpressure race, not a `ClaudeSseAssembler` defect).

Cycle 1 files (original delivery, PR #326):

- `backend/src/main/scala/com/helio/ai/ClaudeConfig.scala` — env-sourced config (`ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CLAUDE_TEMPERATURE`, `CLAUDE_MAX_TOKENS`, `CLAUDE_MAX_INPUT_TOKENS`), `fromEnv()`, key-safe `toString`.
- `backend/src/main/scala/com/helio/ai/ClaudeModels.scala` — domain-facing types: `ClaudeMessage`, `ClaudeRequest`, `TokenUsage`, `ClaudeResponse`, `ClaudeError` (sealed), `ClaudeStreamEvent` (sealed).
- `backend/src/main/scala/com/helio/ai/ClaudeWireModels.scala` — Anthropic Messages API wire types (`ClaudeApiMessage`/`ClaudeApiRequest`/`ClaudeApiUsage`/`ClaudeApiContentBlock`/`ClaudeApiResponse`) and `ClaudeApiException`.
- `backend/src/main/scala/com/helio/ai/ClaudeProtocol.scala` — hand-written spray-json `RootJsonFormat`s translating camelCase Scala fields to/from the API's snake_case wire fields.
- `backend/src/main/scala/com/helio/ai/ClaudeSseFrameParser.scala` — parses one already-delimited SSE frame into a typed `ClaudeStreamEvent` (message_start/content_block_delta/message_delta/message_stop/ping/error); unmodeled event kinds return `None`.
- `backend/src/main/scala/com/helio/ai/ClaudeTransport.scala` — `ClaudeTransport` SPI trait (`send`/`stream`).
- `backend/src/main/scala/com/helio/ai/ClaudeTokenEstimator.scala` — `jtokkit` `o200k_base`-based input-token estimator for the guardrail pre-flight check.
- `backend/src/main/scala/com/helio/ai/HttpClaudeTransport.scala` — production `ClaudeTransport` over `pekko-http` (`Http.singleRequest`, `x-api-key`/`anthropic-version` headers, `ConnectionPoolSettings` timeouts matching `RestApiConnector`).
- `backend/src/main/scala/com/helio/ai/ClaudeClient.scala` — non-blocking client: pre-flight input-token guardrail (reject before any network call), output-token clamp, transport delegation, `ClaudeApiException` → `ClaudeError` mapping, never logs the API key.
- `backend/src/test/scala/com/helio/ai/ClaudeConfigSpec.scala` — key present/absent/blank, model/temperature/max-tokens/max-input-tokens defaults+overrides, `toString` never renders the key.
- `backend/src/test/scala/com/helio/ai/ClaudeClientSpec.scala` — hand-written fake `ClaudeTransport`: request construction, guardrail rejection (zero transport invocations, `send` and `stream`), output clamp, usage passthrough, API-error/transport-failure mapping, key-never-logged (Logback `ListAppender`).
- `infra/deploy-backend.sh` — added `ANTHROPIC_API_KEY=helio-anthropic-api-key:latest` to `--set-secrets`.
- `infra/.env.deploy.example` — added a documentation-only note (mirrors the existing `COOKIE_SECURE` note) explaining `ANTHROPIC_API_KEY` is Secret-Manager-sourced, not set in this file.
- `CLAUDE.md` — added `ANTHROPIC_API_KEY`/`CLAUDE_MODEL`/`CLAUDE_TEMPERATURE`/`CLAUDE_MAX_TOKENS`/`CLAUDE_MAX_INPUT_TOKENS` rows to the prod env-var table.
