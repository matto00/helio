- `backend/src/main/scala/com/helio/services/ratelimit/RateLimiter.scala` — `RateLimiter` trait + `RateLimitResult` (design.md D2), opaque-key storage abstraction.
- `backend/src/main/scala/com/helio/services/ratelimit/InMemoryRateLimiter.scala` — fixed-window `ConcurrentHashMap`-backed implementation (design.md D1/D2).
- `backend/src/main/scala/com/helio/services/ratelimit/RateLimitConfig.scala` — env-sourced config: `requestsPerWindow` (`RATE_LIMIT_REQUESTS_PER_WINDOW`, default 120), `windowSeconds` (`RATE_LIMIT_WINDOW_SECONDS`, default 60). (`trustedProxyHops` was added and then removed during delivery — see the scope-split note below.)
- `backend/src/main/scala/com/helio/api/http/RateLimitDirective.scala` — the directive itself (design.md D3/D3a/D4): resolves a bucket key with priority session user id > PAT token id, matching `AuthDirectives.resolveIdentity`'s session-over-header precedence exactly; a request that resolves to no key (no credential, or an invalid/unresolvable one) passes through unconditionally rather than falling back to any shared or IP-based key. On exceed: 429 + `Retry-After` header + JSON `ErrorResponse` body (D5).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `rateLimitDirective.rateLimit()` immediately inside `authDirectives.requireCsrfHeader { ... }`, outermost, wrapping `authDirectives.confineScopedToken { ... }` and the entire three-way auth branch in its entirety (design.md D4).
- `CLAUDE.md` — adds the `RATE_LIMIT_REQUESTS_PER_WINDOW` and `RATE_LIMIT_WINDOW_SECONDS` rows to the prod env var table, including the per-instance Cloud Run caveat and an explicit statement that unauthenticated/invalid-credential requests are not currently rate-limited by this directive (deferred to HEL-837).
- `backend/src/test/scala/com/helio/api/http/RateLimitDirectiveSpec.scala` — route-testkit coverage: under/over-limit, 429+Retry-After+body, two-users-independent, same-key-throttled, two-PATs-same-user-independent (the property flagged as most likely to be silently wrong), route-specific override, and three tests confirming an unauthenticated request / an invalid session cookie / an unresolvable PAT bearer token are each NOT rate-limited (deliberate, per the scope split below).
- `backend/src/test/scala/com/helio/services/ratelimit/InMemoryRateLimiterSpec.scala` — unit coverage for the fixed-window limiter itself (under/over-limit, window reset, independent keys, window-boundary burst).
- `openspec/changes/core-rate-limiting-directive/design.md` — full design writeup including a "Scope split" section explaining the IP-keying deferral to HEL-837.
- `openspec/changes/core-rate-limiting-directive/tasks.md` — all tasks marked complete, reflecting the shipped (authenticated-keying-only) scope.
- `openspec/changes/core-rate-limiting-directive/specs/rate-limiting-directive/spec.md` — capability spec revised to describe authenticated-only keying and the deliberate pass-through behavior for everything else.
- `openspec/changes/core-rate-limiting-directive/ip-keying-followup-for-hel837.md` — new: preserves the full working IP-keying implementation, tests, and all six adversarial findings from delivery, verbatim, for HEL-837 to pick up from.

## Scope split (product-owner decision)

Across four delivery cycles and three final-gate REFUTEs, all six findings were in IP-based
keying for unauthenticated/invalid-credential requests (header spoofing, port-inclusive keys, two
weak-test defects, header-instance truncation, a stale doc comment); the authenticated (session/PAT)
keying path had zero findings. The product owner decided to split IP-based keying out to HEL-837
entirely rather than ship a fourth patch under delivery pressure. As part of this split, two files
that were touched during cycles 2-4 to support IP-based keying were **reverted to their base state,
with zero net change from `c915b100`**:

- `backend/src/main/resources/application.conf` — the `pekko.http.server.remote-address-attribute = on`
  setting (needed only for the now-removed IP-keying path) was reverted.
- `infra/deploy-backend.sh` — the `RATE_LIMIT_TRUSTED_PROXY_HOPS` env var and its comment block
  (needed only for the now-removed IP-keying path) were reverted.

Neither file appears in the file list above because neither carries any net change in the shipped
diff — this is deliberate, not an omission.
