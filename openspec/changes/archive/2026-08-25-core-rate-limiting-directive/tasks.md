## 1. Limiter core

- [x] 1.1 Define `RateLimiter` trait + `RateLimitResult` (design.md D2) in a new package, e.g.
      `com.helio.services.ratelimit`.
- [x] 1.2 Implement `InMemoryRateLimiter` (fixed-window, `ConcurrentHashMap`, no new dependency).
- [x] 1.3 Unit tests: under-limit passes, over-limit rejects, window reset allows further requests,
      two different keys have independent counters, window-boundary burst behaves as documented
      (up to ~2x limit is accepted/expected, not a bug).

## 2. Config

- [x] 2.1 Add `RateLimitConfig` case class reading `RATE_LIMIT_REQUESTS_PER_WINDOW` (default 120) and
      `RATE_LIMIT_WINDOW_SECONDS` (default 60) from env, following the existing `backend-env-config`
      style.
- [x] 2.2 Document both env vars in `/home/matt/Development/helio/CLAUDE.md`'s prod env var table
      (Required = No, with defaults), including the per-instance caveat under Cloud Run
      `max-instances=3`.

## 3. Directive

- [x] 3.1 Implement `RateLimitDirective` (design.md D3/D3a/D4) resolving key priority session user
      id > PAT token id (matching `AuthDirectives.resolveIdentity`'s session-over-header precedence
      exactly), independent of `AuthDirectives`'s identity directives, following the
      `AuthDirectives`/`AclDirective` code style (no inline fully-qualified names). Present-but-invalid
      credentials, and requests with no credential at all, resolve to no key at all (D3a) — the
      request is not rate-limited by this directive (IP-based keying for these cases split to
      HEL-837; see design.md's Scope split section).
- [x] 3.2 On exceed: complete 429 with `Retry-After` header + JSON `ErrorResponse` body (design.md D5).
- [x] 3.3 Route-testkit tests (this is the ticket's verification bar, not just "tests pass"):
      - under-limit request passes through
      - over-limit request returns 429 with `Retry-After` header and `ErrorResponse` JSON body
      - two different users have independent budgets (exhausting one does not throttle the other)
      - the same key IS throttled across repeated requests
      - two PATs belonging to the SAME user have independent budgets (the property most likely to be
        silently wrong)
      - a route-specific tighter limit overrides the global default
      - unauthenticated requests are NOT rate-limited by this directive (deliberate, per D3a/HEL-837)
      - a present-but-invalid session cookie is NOT rate-limited by this directive
      - a present-but-invalid PAT bearer token is NOT rate-limited by this directive

## 4. Wiring

- [x] 4.1 Construct `RateLimiter`/`RateLimitDirective` in `ApiRoutes`'s existing wiring block (same
      place `AuthDirectives`/`AclDirective` are constructed).
- [x] 4.2 Wrap `authDirectives.requireCsrfHeader { ... }`'s body — outermost within it, around
      `authDirectives.confineScopedToken { ... }` in its entirety — with `rateLimitDirective.rateLimit()`
      (exact code shape in design.md D4).
- [x] 4.3 `sbt compile test` green.

## 5. Verification

- [x] 5.1 Confirm every acceptance criterion in ticket.md is covered by a named test from group 3.
- [x] 5.2 Confirm no scope creep into brute-force lockout, expensive-op guards, public-endpoint
      tuning, or a distributed backend (ticket.md Out of scope).
