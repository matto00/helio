## Why

There is no rate limiting anywhere in the backend today. Every route under `/api` is exposed
with no protection against a noisy client, a leaked PAT, or a runaway script exhausting backend
capacity. HEL-436 (Rate Limiting & Abuse Protection epic) needs a foundational, reusable directive
before its sibling tickets (brute-force lockout, expensive-op guards, public-endpoint tuning) can
build on it.

## What Changes

- Add a `RateLimiter` trait (in-process token-bucket/fixed-window implementation) that can later be
  swapped for a distributed backend without changing call sites.
- Add a `rateLimit(bucketKeyName, limit)` Pekko HTTP directive, in the style of `AuthDirectives` /
  `AclDirective`, that resolves a bucket key from the request context and completes `429 Too Many
  Requests` with a JSON `ErrorResponse` + `Retry-After` header when the bucket is exhausted.
- Key resolution: authenticated user id; separately, PAT token id when PAT-authenticated (so one
  noisy token cannot exhaust its owning user's whole budget). Composes around/ahead of
  `optionalAuthenticate`, not only after `authenticate`. **Split during delivery (see design.md's
  "Scope split" section): client IP fallback for unauthenticated/invalid-credential requests was
  deferred to HEL-837** after three rounds of adversarial review found repeated, real defects in
  IP-based keying with none in the authenticated path — this change ships authenticated keying
  only, and a request it cannot key on a session/PAT passes through unconditionally, not throttled.
- Config-driven limits via new env vars (`RATE_LIMIT_REQUESTS_PER_WINDOW`, `RATE_LIMIT_WINDOW_SECONDS`),
  documented in CLAUDE.md's prod env table, with sane defaults and per-route override support.
- Wire the directive into `ApiRoutes` at the `/api` boundary as the default limiter.
- Document the per-instance caveat: Cloud Run runs up to `max-instances=3`, so the in-process store
  makes the effective limit roughly N x configured under multi-instance — this is a real correctness
  caveat, not a footnote.

## Capabilities

### New Capabilities
- `rate-limiting-directive`: reusable per-user/per-PAT request rate-limiting Pekko HTTP directive
  with 429 responses, config-driven limits, and an in-process store behind a trait boundary for
  future distributed backends. (Per-IP keying for unauthenticated/invalid-credential requests split
  to HEL-837 during delivery — see design.md.)

### Modified Capabilities
(none — `ApiRoutes` wiring is an implementation detail of the new capability, not a change to an
existing capability's requirements)

## Impact

- New: `RateLimiter` trait + in-process implementation, `RateLimitDirective`, config case class,
  route-testkit tests.
- Modified: `ApiRoutes.scala` (wires the directive at the `/api` boundary), `CLAUDE.md` (env var
  table).

## Non-goals

- Auth brute-force lockout (separate ticket).
- Expensive-op guards / LLM cost guardrails (separate ticket).
- Public-endpoint-specific tuning (separate ticket).
- A distributed/shared limiter backend implementation (trait boundary only).
