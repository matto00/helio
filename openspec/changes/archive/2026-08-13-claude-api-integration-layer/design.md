## Context

No `com.helio.ai` package exists; `PdfTextSupport.scala` only mentions "claude" incidentally. The
codebase has an established outbound-HTTP pattern (`RestApiConnector`, `backend/src/main/scala/com/
helio/domain/RestApiConnector.scala`): a class taking an implicit `ActorSystem`, `Http(system.
classicSystem).singleRequest(...)`, a `ConnectionPoolSettings` with explicit connect/idle timeouts,
and an `Either[String, T]`-returning method with a `.recover` that logs and maps to a category
message. `CookieConfig.fromEnv()` is the established "read config once from `sys.env`" pattern. No
SSE library is on the classpath; `pekko-http`/`pekko-stream` (already deps) are enough to parse SSE
by hand. `jtokkit` (already a dep, used by `ChunkByTokenCountStep`) gives a reasonable
token-count estimate without a network round trip; `ChunkByTokenCountConfig` already defaults to
the `o200k_base` encoding, reused here (D4) rather than introducing a second BPE-family default.

## Goals / Non-Goals

**Goals:**
- A reusable, non-blocking, streaming-capable Claude client with env-driven config and enforced
  token/cost guardrails, testable with zero real network calls.
- Never let the API key reach a log line, in redacted or unredacted form.

**Non-Goals:**
- Wiring a route/consumer (HEL-341's job).
- Persisting conversations, multi-turn state, or telemetry (sibling HEL-341 tickets).
- Exact byte-for-byte coverage of every Anthropic SSE event type — only the subset a caller needs
  to assemble streamed text and final usage (`message_start`, `content_block_delta` text deltas,
  `message_delta` usage, `message_stop`, `ping`, `error`).

## Decisions

**D1 — Package `com.helio.ai`, not `com.helio.services`.** This is the first piece of a distinct
agentic-integration surface (HEL-341/343 build directly on it); a dedicated package keeps it out of
the general `services` grab-bag and gives future AI-adjacent code (prompt construction, multi-turn
state) an obvious home. Mirrors the ticket's own "(or a new `com/helio/ai/` package)" allowance.

**D2 — `ClaudeTransport` SPI, not a concrete `HttpClaudeTransport` called directly.**
`trait ClaudeTransport { def send(req): Future[ClaudeApiResponse]; def stream(req): Source[
ClaudeStreamEvent, NotUsed] }`. Production: `HttpClaudeTransport(apiKey, model defaults)(implicit
system)`, `Http(system.classicSystem).singleRequest` against `https://api.anthropic.com/v1/
messages`, headers `x-api-key`, `anthropic-version`, `content-type: application/json` — same
`ConnectionPoolSettings`-with-timeouts shape as `RestApiConnector`. Tests inject a stub/mock
`ClaudeTransport` — satisfies "mocked/stubbed Anthropic transport (no real network)" directly,
without an HTTP-level fake server. Alternative considered: fake the wire via `pekko-http-testkit`
route testing — rejected as heavier for no added coverage, since the SPI boundary is exactly where
the ticket asks for the seam.

**D3 — `ClaudeClient` returns `Future[Either[ClaudeError, ClaudeResponse]]`, not a thrown
exception.** Matches `RestApiConnector.fetch`'s `Future[Either[String, JsValue]]` convention, but
with a typed `ClaudeError` (`ApiError(status, body)`, `TransportFailure(message)`,
`GuardrailExceeded(reason)`) so callers — and tests — can branch on *why* a call failed, in
particular distinguishing a deterministic guardrail rejection from a transport/API failure.
`HttpClaudeTransport.send` signals a non-2xx response by failing its returned `Future` with a typed
`ClaudeApiException(status, body)`; `ClaudeClient.send` catches that in its `.recover`/`.transform`
and maps it to `Left(ClaudeError.ApiError(status, body))`, mirroring `RestApiConnector`'s
"transport throws, client catches and maps" split rather than pushing `Either` down into the SPI
itself.

**D4 — Guardrails: clamp output, reject input; concrete ceiling defaults.** `max_tokens` (output)
is a ceiling from `ClaudeConfig.maxOutputTokens` (env `CLAUDE_MAX_TOKENS`, default **4096**); a
caller-requested value above it is silently clamped down to the ceiling (an output cap can never
make a request fail, only shorter). Estimated input tokens (via `jtokkit`'s `o200k_base` encoding —
the same default `ChunkByTokenCountConfig` already uses elsewhere in this codebase, and the closer
BPE-family approximation to modern Claude models than `cl100k_base` — documented as an estimate,
not exact) above `ClaudeConfig.maxInputTokens` (env `CLAUDE_MAX_INPUT_TOKENS`, default **100,000**,
comfortably inside every configurable model's context window while still rejecting runaway prompts)
reject deterministically with `ClaudeError.GuardrailExceeded` *before* any network call is made.
`ClaudeResponse.usage: TokenUsage(inputTokens, outputTokens)` is always populated from the API's own
`usage` field on success, so real cost is never inferred from the estimate. "Cost" in this ticket's
guardrail AC is interpreted as *token count*, with dollar cost left to the caller to compute from
returned `usage` — not a separate in-client dollar-figure/pricing-table guardrail, which would need
independent upkeep as prices change.

**D4a — `stream`'s guardrail rejection is a synthetic error event, not a thrown exception.**
`ClaudeClient.stream` runs the same pre-flight input-token check as `send` before touching
`ClaudeTransport.stream` at all. On rejection, it returns `Source.single(ClaudeStreamEvent.Error(
GuardrailExceeded(reason)))` (single element, then completes normally) rather than
`Source.failed(...)` — a stream consumer already has to handle `ClaudeStreamEvent.Error` for
mid-stream API errors (Non-Goals list), so this reuses that same handling path for the pre-flight
case instead of requiring a second, stream-failure-specific handler. `ClaudeTransport.stream` sees
zero invocations in this case, identical to `send`'s zero-transport-invocations guarantee.

**D5 — Streaming SSE parsed by hand via `Framing`.** `response.entity.dataBytes` (a `Source[
ByteString, _]`) through `Framing.delimiter(ByteString("\n\n"), maximumFrameLength, allowTruncation
= true)` splits into per-event frames; each frame's `event:`/`data:` lines parse into a
`ClaudeStreamEvent` ADT via the same spray-json protocol as `send`. Alternative considered: add an
SSE library dependency — rejected, no such dependency exists on the classpath today and the frame
format is simple enough to parse directly, avoiding a new third-party dependency for ~30 lines of
logic.

**D6 — Config fails fast at construction, not at `Main.scala` startup.** `ClaudeConfig.fromEnv()`
returns `Either[String, ClaudeConfig]` (missing/blank `ANTHROPIC_API_KEY` → `Left`), mirroring
`CookieConfig.fromEnv()`'s "read once" shape but *not* `Main.scala`'s `requireEnv` (which kills the
whole process at startup) — this ticket wires no consumer into `Main.scala`, so nothing should force
every backend boot to have a key set just because this library exists. HEL-341's route wiring is
where a real fail-fast-at-startup decision belongs, once there's an actual caller.

**D7 — Model id is a plain configured `String`, not a closed enum; temperature is env-configurable
too.** Anthropic ships new model ids faster than this codebase would track a sealed trait;
`ClaudeConfig.model: String` (default `"claude-opus-4-8"`, overridable via `CLAUDE_MODEL`) keeps
every id "configurable, not hardcoded at call sites" per the AC without this layer becoming the
bottleneck for adopting a new model id. The ticket's Scope line names temperature alongside model
and max-tokens as required to be equally configurable — `ClaudeConfig.temperature: Double` is read
from `CLAUDE_TEMPERATURE` (default **1.0**, matching the Anthropic Messages API's own default),
overridable per-call (mirroring `maxTokens`'s per-call-overridable-down-to-the-ceiling shape). This
closes the gap where `tasks.md` previously declared `temperature` as a field with no env var
populating it.

**D8 — Secret Manager entry, not `.env.deploy.example` value.** `ANTHROPIC_API_KEY` is a *secret*
(like `DB_PASSWORD`/`GOOGLE_CLIENT_SECRET`), so it is added to `deploy-backend.sh`'s
`--set-secrets` list (new Secret Manager secret `helio-anthropic-api-key`, following the existing
`helio-db-password`/`helio-google-client-secret` naming), never written as a plaintext value in
`infra/.env.deploy.example`. `.env.deploy.example` instead gets a documentation-only comment
(mirroring the file's existing `COOKIE_SECURE` note) explaining the secret is sourced via Secret
Manager and named in `deploy-backend.sh`, not operator-supplied here. Provisioning the actual
Secret Manager secret value in GCP is an infra-operator action outside this ticket's/this repo's
reach (same as every other pre-existing `--set-secrets` entry) — flagged as a deploy prerequisite
in the PR body, not a task this change can complete.

## Risks / Trade-offs

[jtokkit's estimate diverges from Claude's real tokenizer] → documented as an estimate in
`ClaudeConfig`/`ClaudeClient` doc comments; guardrail ceiling should be set with headroom, and real
`usage` from the API response is always the source of truth for logged cost, never the estimate.

[Hand-rolled SSE parsing could mis-handle a frame shape Anthropic changes later] → the parser is
isolated to one small, directly-unit-tested function (`SseFrameParser`-equivalent) with a stubbed
transport feeding it raw byte chunks, including mid-frame chunk-boundary splits, in tests.

[No real consumer this ticket → risk of speculative/unused-in-practice API shape] → mitigated by
building directly against HEL-341's stated needs (streaming to a client, token usage for cost
logging) rather than a speculative general-purpose surface; HEL-341 remains free to extend, not
required to redesign.

## Migration Plan

Additive only — no existing route, config, or data model changes. Deploy prerequisite: create the
`helio-anthropic-api-key` secret in Secret Manager before the next `infra/deploy-backend.sh` run
(the script will fail its `--set-secrets` resolution otherwise, exactly as it would for any other
secret entry referencing a nonexistent secret).

## Planner Notes

Self-approved: package name (`com.helio.ai`), transport SPI shape, error ADT, guardrail
clamp-vs-reject split, and the Secret Manager secret name — all conventional extensions of existing
patterns already in this codebase, none introduce a new external dependency or an architectural
change beyond what the ticket already scopes.

## Open Questions

None outstanding — self-approved per Planner Notes above.
