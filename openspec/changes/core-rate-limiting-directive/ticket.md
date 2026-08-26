# HEL-495: Core per-user / per-PAT request rate limiting directive with 429 responses

## Description

There is no rate limiting anywhere in the backend today. Every route under `/api` is composed in `ApiRoutes.scala` behind `AuthDirectives.authenticate` / `optionalAuthenticate`, which resolve a principal from either the `helio_session` cookie or a `helio_pat_` bearer token. We need a foundational, reusable rate-limiting mechanism keyed on that principal before the more specific abuse-protection tickets can build on it.

## Scope

* Implement a reusable Pekko HTTP `Directive` (e.g. `rateLimit(bucketKey)`) that enforces a token-bucket / fixed-window limit and, on exceed, completes `429 Too Many Requests` with a JSON `ErrorResponse` and a `Retry-After` header. Follow the existing directive style in `AuthDirectives`/`AclDirective`; no inline fully-qualified names.
* Key selection: per authenticated user id, and separately per PAT token id when the caller is PAT-authenticated (so one noisy token doesn't exhaust a user's whole budget). Fall back to client IP for unauthenticated requests (the directive must be usable ahead of/around `optionalAuthenticate`).
* Config-driven limits (requests/window) via env vars documented in the CLAUDE.md prod env table, with sane defaults; a global default plus the ability for callers to pass a tighter per-route limit.
* Storage: start with an in-process store (e.g. a concurrent map / Caffeine-style expiring cache) but structure the limiter behind a trait so a shared/distributed backend can replace it later (Cloud Run runs up to `max-instances=3`; document that in-process limits are per-instance for now).
* Wire the directive into `ApiRoutes` at the `/api` boundary as the default limiter.

## Acceptance criteria

* Exceeding the configured limit returns `429` with `Retry-After` and a JSON body; under the limit passes through (route testkit tests for both).
* Limits are keyed correctly: two different users/tokens have independent budgets; the same token is throttled across requests.
* Limits are configurable via env var; defaults documented in CLAUDE.md.
* Per-instance limitation documented; trait boundary allows a future shared store.
* `sbt compile test` green.

## Out of scope

* Auth brute-force lockout (separate ticket).
* Expensive-op guards / LLM cost (separate ticket).
* Public-endpoint-specific tuning (separate ticket).
* A distributed/shared limiter backend implementation.

## Dependencies

Foundation for the rest of the Rate Limiting epic; the brute-force, expensive-op, and public-endpoint tickets build on this directive.

## Orchestrator notes (not part of the ticket; delivery guidance)

* Two PATs belonging to the SAME user must have independent budgets — this is the property most likely to be silently wrong; test it explicitly.
* Test unauthenticated IP fallback path.
* Consider clock/window-boundary burst behavior.
* Models for this run: executor=sonnet, evaluator=sonnet, auditor=sonnet, skeptic=opus (explicit per-spawn override on every gate spawn).
* Reconciliation check done at Setup: no existing rate-limiting code found; HEL-515 (Abuse detection signals + alerting hook) is a distinct downstream consumer of this ticket's trip events — no overlap.
