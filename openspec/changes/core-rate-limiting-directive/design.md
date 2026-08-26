## Context

See proposal.md - Why. Existing directive style: `AuthDirectives` (`backend/src/main/scala/com/helio/api/http/AuthDirectives.scala`)
resolves identity from a `helio_session` cookie or a `helio_pat_` bearer token via
`ApiTokenRepository.findPrincipalByTokenHash(hash): Future[Option[(AuthenticatedUser, ApiTokenId, Option[Set[String]])]]`
— already returns the PAT's `ApiTokenId`, so rate-limit key resolution can reuse this lookup
without adding a new repository method. `AuthenticatedUser` itself carries only `UserId`, not a
token id, so the rate-limit directive must resolve identity independently from `authenticate`/
`optionalAuthenticate` (its own cookie/header inspection) rather than composing after either — this
also satisfies the ticket's requirement that the directive be usable "around" `optionalAuthenticate`,
not only after `authenticate`. `ApiRoutes.scala` composes directives as nested blocks under
`pathPrefix("api")`, ahead of the `confineScopedToken` / `optionalAuthenticate` / `authenticate` split
(around line 515-548).

## Scope split (delivery decision, not a design change from ambiguity)

**Shipped in this change: authenticated keying only — session user id, and separately PAT token
id.** IP-based keying for unauthenticated/invalid-credential requests, originally in scope, was
split out to HEL-837 ("IP-based rate-limit keying: trusted client-IP extraction behind Cloud Run's
proxy") after four delivery cycles and three final-gate REFUTEs found six distinct, real defects —
all of them in the IP-keying path (header-vs-attribute trust order, port-inclusive keys, two
separate weak-test defects, header-instance truncation, a stale doc comment) — while the
authenticated-keying path below had zero findings across every round. The rate of new findings in
the IP path was not decreasing round over round; that pattern, not any single defect, is what
justified treating trusted-client-IP-behind-a-proxy extraction as its own problem rather than a
fourth patch under this ticket's delivery pressure.

The full working IP-keying implementation reached by the end of cycle 4 (pre-final-gate-round-4),
its tests, and all six findings are preserved verbatim at
`openspec/changes/core-rate-limiting-directive/ip-keying-followup-for-hel837.md` for HEL-837 to
pick up from, rather than re-derive.

**Practical consequence, documented in `CLAUDE.md`'s `RATE_LIMIT_REQUESTS_PER_WINDOW` row:** a
request with no session/PAT credential at all, or with an unresolvable/invalid one, is **not
currently rate-limited by this directive**. This is a deliberate, tracked gap, not a silent one.

## Goals / Non-Goals

**Goals:**
- A directive wired once, near the top of the `/api` block, before the existing auth split, so it
  sees every request regardless of which of the three downstream auth branches ultimately handles it.
- Correct key resolution with priority **session user id > PAT token id**, matching
  `AuthDirectives.resolveIdentity`'s own session-over-header precedence exactly (D3), so a request's
  rate-limit key is never resolved to a different principal than the one `authenticate`/
  `optionalAuthenticate` will use downstream. Resolved independently of `AuthDirectives`'s identity
  directives (see D3 for why).
- A request this directive cannot key on a session or PAT (no credential, or an invalid one) passes
  through unconditionally, undecorated by any fallback key — see D3a. This is the direct
  consequence of the scope split above, not an independent design choice.
- In-process store behind a `RateLimiter` trait; swappable later without touching the directive or
  `ApiRoutes`.

**Non-Goals:**
- Building the distributed backend (trait boundary only — see proposal Non-goals).
- IP-based keying for unauthenticated/invalid-credential requests — split to HEL-837, see above.
- Per-route limit overrides beyond a simple optional tighter-limit parameter (no route-specific
  config file/registry).
- Anything covered by the sibling tickets (brute-force lockout, expensive-op guards, public-endpoint
  tuning, alerting hooks — HEL-515 consumes trip events but is not built here).

## Decisions

**D1 — Fixed-window counter, not a full token bucket.** The ticket text says "token-bucket / fixed-window"
as alternatives; a fixed window (count resets every `windowSeconds`) is simpler to reason about and test
deterministically (no leak-rate math, no fractional token accounting) and is sufficient for "cannot
exhaust the budget" semantics. Alternative considered: sliding-window log (more accurate at window
boundaries) — rejected as unnecessary complexity for a foundational first cut; a burst spanning a
window reset is an accepted, documented limitation (see Risks).

**D2 — `RateLimiter` trait with an in-process `InMemoryRateLimiter` impl.**
```
trait RateLimiter {
  // Returns Right(()) if the request may proceed (and counts it), or
  // Left(RateLimitExceeded(retryAfterSeconds)) if the bucket is exhausted.
  def tryAcquire(key: String, limit: Int, windowSeconds: Int): RateLimitResult
}
```
`InMemoryRateLimiter` uses a `java.util.concurrent.ConcurrentHashMap[String, WindowCounter]` where
`WindowCounter` holds `windowStart: Instant` + an `AtomicInteger` count, replacing/reset atomically
via `compute` when the window has elapsed. No new library dependency (no Caffeine) — a
`ConcurrentHashMap` is sufficient for a fixed-window counter and keeps this change dependency-free.

**D3 — Key resolution lives in the directive, not in `RateLimiter`.** `RateLimiter` only ever sees an
opaque `String` key (e.g. `"user:<id>"`, `"pat:<tokenId>"`) — it has no knowledge of auth. The
directive (`RateLimitDirective.rateLimit(...)`) does its own cookie/header inspection, **priority
session > PAT**, matching `AuthDirectives.resolveIdentity`'s session-over-header precedence exactly
(cookie present, of any validity, always wins over the header):
1. `helio_session` cookie present -> resolve via `userSessionRepo.findValidSession(token)`.
   - Resolves to a user -> key `"user:<userId>"`.
   - Resolves to `None` (expired/unknown session) -> **do not fall through to the header** (mirrors
     `resolveIdentity`'s own short-circuit) -> no key, D3a.
2. No cookie, `Authorization: Bearer helio_pat_...` present -> resolve via
   `apiTokenRepo.findPrincipalByTokenHash(hash)`.
   - Resolves -> key `"pat:<tokenId>"` (the triple's `ApiTokenId`, regardless of whether the token is
     scoped — scoping is orthogonal to rate-limit keying).
   - Does not resolve (invalid/expired/revoked) -> no key, D3a.
3. Neither credential present, or either resolved to invalid per above -> **D3a: no key.**

This resolves independently of `AuthDirectives` (no dependency on `authenticate`/`optionalAuthenticate`
having already run), which is exactly why it can wrap the CSRF/auth split rather than sit inside it —
but it deliberately reimplements the same two-step precedence so the two never disagree about which
principal a given request belongs to.

**D3a — a request this directive cannot key is not rate-limited by it.** Neither an anonymous
request nor one carrying an invalid/expired session cookie or an unresolvable PAT bearer token
resolves to a key; `resolveKey` returns `None` in all three cases and `rateLimit()` passes the
request through unconditionally. This is the scope split's direct consequence (see above), not an
independent choice made here — the original design keyed these cases by client IP, and that path
is what moved to HEL-837. Do not read `None` as "falls back to some default key" — there is no
fallback key in this shipped version; enforcement for these cases simply does not exist yet.

**D4 — Directive signature.**
```
class RateLimitDirective(
    limiter: RateLimiter,
    userSessionRepo: UserSessionRepository,
    apiTokenRepo: Option[ApiTokenRepository],
    defaultLimit: Int,
    windowSeconds: Int
)(implicit ec: ExecutionContext) {
  def rateLimit(limit: Int = defaultLimit): Directive0 = ...
}
```
Constructed once in `ApiRoutes`'s wiring (same place `AuthDirectives`/`AclDirective` are constructed).
**Exact insertion point** (see `ApiRoutes.scala` ~line 508-534): wrap immediately **inside**
`authDirectives.requireCsrfHeader { ... }` and **outermost within it** — i.e. the very first thing
inside that block, wrapping `authDirectives.confineScopedToken { ... }` in its entirety:

```
authDirectives.requireCsrfHeader {
  rateLimitDirective.rateLimit() {
    authDirectives.confineScopedToken { tokenScope =>
      concat( ... existing pathPrefix("auth") / optionalAuthenticate / authenticate branches ... )
    }
  }
}
```

This is deliberately *inside* `requireCsrfHeader` (not outside it, and not outside `pathPrefix("api")`)
so `health.routes` and anything mounted outside `/api` remain unaffected, while still sitting ahead of
every auth-resolution branch — `confineScopedToken`, `optionalAuthenticate`, and `authenticate` alike —
exactly as the ticket requires ("usable around `optionalAuthenticate`, not only after `authenticate`").
A route wanting a tighter limit calls `rateLimitDirective.rateLimit(50)` locally (not exercised by this
change's `ApiRoutes` wiring beyond the default — per-route overrides are proven by a route-testkit
test, not necessarily wired to a real route yet, since no sibling ticket has specified a tighter route
today).

**D5 — 429 response shape.** Reuses `ErrorResponse` (from `com.helio.api.ErrorResponse`, same as
every other directive) and adds `` `Retry-After` `` via Pekko's typed `headers.\`Retry-After\``
header, set to the remaining window seconds.

**D6 — Config.** `RateLimitConfig` case class read from env vars in the same style as other
`backend-env-config` reads (`sys.env.get(...).flatMap(_.toIntOption).getOrElse(default)`):
`RATE_LIMIT_REQUESTS_PER_WINDOW` (default `120`), `RATE_LIMIT_WINDOW_SECONDS` (default `60`). Both
documented in CLAUDE.md's prod env table as optional with defaults. (`RATE_LIMIT_TRUSTED_PROXY_HOPS`
was introduced during delivery for the now-deferred IP-keying path and removed along with it —
see the scope split above and `ip-keying-followup-for-hel837.md`.)

## Risks / Trade-offs

- [Fixed-window boundary burst: a caller could send `limit` requests just before a window resets and
  `limit` more just after, i.e. up to 2x `limit` in a short span straddling the boundary] → Documented,
  accepted limitation of the fixed-window approach (D1); noted in the spec/tests as expected behavior,
  not a defect. A sliding-window approach is a candidate future refinement, not required by this
  ticket's acceptance criteria.
- [Per-instance in-process store means the effective limit is ~N x configured under Cloud Run's
  `max-instances=3`] → Documented plainly in CLAUDE.md per the ticket's explicit instruction; the
  trait boundary (D2) is exactly what allows a future distributed store to close this gap without
  touching call sites.
- [Unbounded map growth if many distinct authenticated principals hit the limiter and are never
  evicted] → Acceptable for a first cut at expected traffic levels: key cardinality is bounded by
  real distinct users and PAT tokens (both DB-backed, not caller-mintable at will the way an
  unauthenticated IP-style key could be). Explicitly out of scope to add eviction/TTL sweeping
  beyond the window-based `compute` replacement already in D2 (each key's entry is small and
  overwritten in place, not accumulated).
- [Unauthenticated and invalid-credential requests are not rate-limited at all] → Deliberate,
  documented scope split to HEL-837 (see above), not an oversight. Tracked in `CLAUDE.md`'s
  `RATE_LIMIT_REQUESTS_PER_WINDOW` row and this design doc's Scope split section.
- [Double auth resolution per request: the rate-limit directive resolves session/PAT identity
  independently (D3), then `AuthDirectives.authenticate`/`optionalAuthenticate` resolves it again
  moments later for the same request — an extra `findValidSession`/`findPrincipalByTokenHash` DB
  round-trip on the hot path] → Accepted for this foundational cut; the alternative (threading a
  resolved identity from the rate-limit directive forward into `AuthDirectives` to dedupe the lookup)
  would couple the two directives together and is exactly the kind of cross-cutting refactor this
  ticket's Non-Goals scope this change away from. A future ticket could carry the resolved identity
  forward via a request attribute to eliminate the duplicate lookup without changing either
  directive's external contract.

## Planner Notes

- Self-approved: reusing `findPrincipalByTokenHash` rather than adding a new repository method — it
  already returns exactly the `ApiTokenId` needed and is already used by `confineScopedToken` for a
  similar purpose.
- Self-approved: fixed-window over token-bucket (D1) — ticket text offered both as acceptable
  implementations ("token-bucket / fixed-window limit").
- Self-approved: no new dependency (plain `ConcurrentHashMap`) instead of introducing Caffeine —
  keeps this foundational change dependency-free; a future distributed-backend ticket can introduce
  whatever library it needs behind the `RateLimiter` trait.
- Product-owner decision (not self-approved): the IP-keying scope split to HEL-837, made explicitly
  by the product owner after reviewing the final gate's finding history across four cycles — see
  "Scope split" above.
