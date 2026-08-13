## Why

The backend has no Claude/Anthropic integration today. HEL-341 (In-App NL Authoring) and future
backend agent paths need one reusable, non-blocking, streaming-capable, cost-guarded server-side
Claude client so those endpoints can be thin callers instead of each re-inventing key handling.

## What Changes

- Add a new `com.helio.ai` package: `ClaudeConfig` (env-sourced model/key/limits config),
  `ClaudeClient` (non-blocking wrapper over the Anthropic Messages API), a `ClaudeTransport` SPI
  (production `HttpClaudeTransport` over `pekko-http`; test transports are stubbed/mocked), request/
  response/streaming-event protocol types, and token/cost guardrails.
- Streaming: model the Anthropic streaming Messages API surface (SSE) as a Pekko `Source` of
  typed stream events, assembled from raw SSE frames.
- Guardrails: a configurable max-output-tokens ceiling (clamped) and a max-input-tokens budget
  (rejected deterministically when exceeded); every successful response exposes `TokenUsage`.
- Config is entirely env-driven (`ANTHROPIC_API_KEY`, model id, token ceilings) — never hardcoded
  at call sites; fails fast (typed error, not a startup requirement) when the client is actually
  constructed/used without a key.
- Infra: add an Anthropic Secret-Manager entry to `infra/deploy-backend.sh`'s `--set-secrets`, and
  document the new secret in `infra/.env.deploy.example` and `CLAUDE.md`'s prod env-var table.
- No route/actor wiring into `Main.scala`/`ApiRoutes` this ticket — no consumer exists yet
  (HEL-341 is the first caller); this ticket ships the library only.
- **Fold-in (post-delivery follow-up A, coordinator-approved):** `HttpClaudeTransport.stream`
  surfaces a mid-stream connection drop as a `ClaudeStreamEvent.Error` element followed by normal
  completion, instead of an unhandled stream failure — the original `.recover` only covered
  request-initiation failures, not a failure on the byte source after streaming had already begun.

## Capabilities

### New Capabilities

- `claude-api-client`: server-side Claude Messages API client — config, non-blocking request/
  streaming transport, and token/cost guardrails, with no real network access from the test suite.

### Modified Capabilities

(none — no existing capability's requirements change)

## Impact

- New: `backend/src/main/scala/com/helio/ai/*`, matching `backend/src/test/scala/com/helio/ai/*`.
- `backend/build.sbt`: no new runtime dependency expected (`pekko-http`/`pekko-stream` already
  present for the HTTP+SSE transport; `jtokkit` already present for input-token estimation).
- `infra/deploy-backend.sh`, `infra/.env.deploy.example`, `CLAUDE.md` (prod env-var table).
- No database/migration impact. No frontend impact.
