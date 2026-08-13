# HEL-390: Server-side Claude API integration layer (model config, Secret Manager key, streaming, cost guardrails)

## Description

The backend has no Claude/Anthropic integration today (only `PdfTextSupport.scala` mentions "claude" incidentally; no client, no key wiring). The In-App NL Authoring endpoint (sibling HEL-341 ticket) and future backend agent paths need a single, reusable server-side Claude client with proper secret handling, model configuration, streaming, and cost/token guardrails. This ticket builds that shared infrastructure layer so the NL endpoint is a thin caller.

Secrets follow the existing Cloud Run pattern: `infra/deploy-backend.sh` injects secrets via `--set-secrets=...:latest` from Secret Manager (see `DB_PASSWORD`, `GOOGLE_CLIENT_SECRET`). The Anthropic API key must be added the same way — never committed to code or `.env` for prod. Model ids per the claude-api standard: default to the most capable appropriate model (`claude-opus-4-8`), with `claude-sonnet-5` / `claude-haiku-4-5-20251001` selectable; all configurable, not hardcoded at call sites.

Touches: new `backend/src/main/scala/com/helio/services/` (or a new `com/helio/ai/` package) Claude client wrapper, config plumbing, `infra/deploy-backend.sh` + `infra/.env.deploy.example`, and `CLAUDE.md`'s prod env-var table.

## Scope

* Backend Scala: a `ClaudeClient` (name at author's discretion) wrapping the Anthropic Messages API — non-blocking (returns `Future`/stream; NEVER block a Pekko actor/execution path per CLAUDE.md), configurable model, max-tokens, temperature. No fully-qualified names inline; import at top.
* Config: API key read from env (`ANTHROPIC_API_KEY` or similar) sourced from Secret Manager in prod; model id + limits configurable. Fail fast with a clear error if the key is absent in a context that needs it.
* Streaming: support the streaming Messages API so the NL endpoint can stream tokens to the client (SSE/chunked) — model the streaming surface here.
* Guardrails: enforce a max-tokens ceiling and a per-request input+output token/cost budget; expose token usage from responses so callers can log cost. Reject or truncate over-budget requests deterministically.
* Infra: add `--set-secrets` entry for the Anthropic key in `infra/deploy-backend.sh`; document it in `infra/.env.deploy.example` and the `CLAUDE.md` prod env-var table.
* Tests: ScalaTest against a mocked/stubbed Anthropic transport (no real network) covering request construction, streaming assembly, and guardrail rejection; verify no key is logged.

## Acceptance criteria

- [ ] A reusable server-side Claude client exists; model, max-tokens, and limits are configuration, not hardcoded at call sites.
- [ ] API key is read from env/Secret Manager; `infra/deploy-backend.sh` sets it via `--set-secrets`; it never appears in code, `.env` (committed), or logs (verified by test).
- [ ] Calls are non-blocking (no blocking op on an actor/execution path).
- [ ] Streaming responses are supported and exposed to callers.
- [ ] A max-tokens/cost guardrail rejects or bounds over-budget requests; token usage is returned for logging.
- [ ] `CLAUDE.md` prod env-var table + `infra/.env.deploy.example` updated.
- [ ] `sbt test` green with mocked transport; no real API call in tests.

## Out of scope

* The NL authoring endpoint + prompt construction (sibling ticket, which consumes this client).
* Frontend chat UI.
* Persisting conversations or telemetry (separate HEL-341 tickets).

## Dependencies

* None hard (foundation). Consumed by the HEL-341 NL authoring endpoint, multi-turn state, and telemetry tickets, and available to HEL-343 refinement.

## Orchestrator notes (not part of the ticket)

The user running this delivery clarified: a real `ANTHROPIC_API_KEY` is already set in `backend/.env` (gitignored) for local dev. Tests must still use a mocked/stubbed transport per the ticket's own acceptance criteria — no real API calls in the automated `sbt test` suite. The evaluator/skeptic may use the real local key for an optional live manual sanity check of the client if useful, but this is not a substitute for the mocked-transport test suite.
