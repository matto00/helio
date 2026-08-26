## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
- All ticket acceptance criteria addressed explicitly: 429 + Retry-After + JSON body (both directions tested), key isolation (user/user, PAT/PAT-same-user, IP/IP), configurable limits via env vars documented in CLAUDE.md, per-instance limitation documented, trait boundary present, `sbt compile test` green.
- No AC silently reinterpreted.
- All `tasks.md` items marked done and match the diff (verified 1.1-5.2).
- No scope creep: no brute-force lockout, no expensive-op/LLM cost guard, no public-endpoint-specific tuning, no distributed backend implementation — confirmed by reading the diff stat (only rate-limit files + CLAUDE.md + ApiRoutes wiring + application.conf touched).
- No regressions to existing behavior: `rateLimit()` placement is additive (wraps `confineScopedToken`), doesn't alter existing auth/CSRF/CORS logic; full suite still green (see Phase 2).
- No schema/API-contract changes needed (429 shape is `ErrorResponse`, already the standard shape) — none touched, correctly.
- Planning artifacts (design.md D1-D6) match the implemented behavior exactly, including the exact `ApiRoutes.scala` wiring quoted in D4.

### Phase 2: Code Review — PASS
- Fresh gate re-run (not trusting executor's report):
  - `sbt compile` — success.
  - `sbt testOnly com.helio.api.http.RateLimitDirectiveSpec com.helio.services.ratelimit.InMemoryRateLimiterSpec` — 14/14 passed.
  - `sbt test` (full suite) — 3391 tests, 0 failed, 0 canceled — matches executor's reported count; independently re-verified.
  - `node scripts/check-scala-quality.mjs` — clean (0 hard violations, 131 soft warnings, pre-existing baseline not attributable to this diff).
- Canonical code-quality compliance: no inline fully-qualified names found in the new/changed files (`RateLimitDirective.scala`, `RateLimiter.scala`, `InMemoryRateLimiter.scala`, `RateLimitConfig.scala`) — imports are all at the top; confirmed via `check:scala-quality` (mechanical check) passing clean.
- DRY: reuses `ApiTokenRepository.findPrincipalByTokenHash` (no new repo method), reuses `ErrorResponse`, reuses `SessionCookies.Name` — no duplication introduced.
- Readable: key format (`user:<id>` / `pat:<id>` / `ip:<addr>`) is self-documenting; no magic values beyond the documented `"ip:unknown"` sentinel, which is explicitly commented.
- Modular: `RateLimiter` trait cleanly separates storage from key-resolution (in `RateLimitDirective`), matching design.md D3's explicit intent.
- Type safety: no untyped escape hatches; `RateLimitResult` is a sealed trait pattern-matched exhaustively.
- Security: this is the security-relevant change itself — reviewed key-resolution logic line-by-line (see Phase 1); D3a fallback prevents credential-stuffing/invalid-token flood from hiding behind one shared bucket; IP extraction gated on `remote-address-attribute = on`, confirmed present in `application.conf:12`.
- Error handling: `onComplete` + pattern match on `Success`/otherwise (implicitly falls to IP on `Failure` too, since only `Success(Some(...))` is matched) — a DB failure during key resolution degrades to IP-keyed limiting rather than crashing the request in an unhandled way; reasonable failure mode, no silent swallow (the DB failure isn't logged here, but that's consistent with the "not maximally-precise foundational cut" design already documented in D3b, not a functional escape).
- Tests meaningful: each new code path (allow, exceed, per-key isolation both directions, two-PATs-same-user, IP fallback, both D3a invalid-credential branches, per-route override, window reset, window-boundary burst) has a dedicated named test that would fail if the underlying logic regressed — verified by reading assertions, not just test names.
- No dead code: no unused imports/TODOs found in the diff.
- No over-engineering: fixed-window instead of token-bucket, no Caffeine dependency, no premature distributed-backend scaffolding — appropriately minimal per design.md's explicit self-approved simplifications.
- Behavior-preserving where structural: `ApiRoutes.scala` change is purely additive (new nested directive), not a refactor — no drive-by behavior change detected.

Specific verification of the audit's five callouts:
1. **429 response shape** — `RateLimitDirectiveSpec.scala:83-94` asserts `status shouldBe StatusCodes.TooManyRequests`, `header("Retry-After") should not be empty`, and `responseAs[ErrorResponse].message should not be empty` — all three assert together in one test. Confirmed.
2. **Key isolation both directions** — "keep two different users' budgets independent" (exhaust A, confirm B unaffected) and "throttle the SAME key across repeated requests" (same key exhausts) are both present as distinct named tests (lines 96-118). Confirmed.
3. **Two-PATs-same-user test genuinely distinct tokens** — `patTokenA1`/`patTokenA2` are two different literal token strings (`"1"*64` vs `"2"*64`), mapped to two different `ApiTokenId`s (`token-a1`/`token-a2`), both attributed to the same `userA` in the stub repo (`RateLimitDirectiveSpec.scala:55-59`). The test exhausts PAT1 and confirms PAT2 (same user) is unaffected — this genuinely tests token-id keying, not user-id keying. Confirmed, not a same-user/different-user false positive.
4. **Unauthenticated IP fallback** — "fall back to and limit by client IP for unauthenticated requests" (lines 136-144) uses `withIp` helper with `AttributeKeys.remoteAddress`, no credentials attached. Confirmed.
5. **D3a invalid-credential fallback, no collapse to shared literal key** — both "invalid session cookie" and "invalid PAT bearer" tests explicitly use two *different* IPs presenting the *same* invalid credential and assert the second IP is NOT throttled by the first's exhaustion (lines 146-170) — this directly proves the key is IP-derived, not a shared literal constant. Confirmed.

Per-instance caveat and trait boundary:
- CLAUDE.md documents `RATE_LIMIT_REQUESTS_PER_WINDOW` / `RATE_LIMIT_WINDOW_SECONDS` in the prod env var table, explicitly stating "the effective limit is roughly 3x this value, not a hard global cap" under Cloud Run `max-instances=3`. Confirmed present and plain-language.
- `RateLimiter` (trait) and `InMemoryRateLimiter` (impl) are genuinely separate files/types — `RateLimitDirective` depends only on the trait type. Confirmed real boundary, not a nominal one.

ApiRoutes wiring vs design.md D4:
- `ApiRoutes.scala` shows `rateLimitDirective.rateLimit()` as the first thing inside `authDirectives.requireCsrfHeader { ... }`, wrapping `authDirectives.confineScopedToken { ... }` in its entirety — matches D4's quoted code shape exactly, including the explanatory comment referencing design.md D4.

No violations found.

### Phase 3: UI Review — N/A
No `frontend/**` files changed; no `backend/src/main/scala/routes/ApiRoutes.scala`-schema-affecting change (this touches `ApiRoutes.scala` but only adds a rate-limit directive wrapper, not an endpoint/schema); no `schemas/**` or `openspec/specs/**` changes to API contracts. Phase 3 correctly not applicable.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- Consider logging (at debug/warn) when key resolution falls back to IP due to a `Future` failure (as opposed to a clean `None` result) during `findValidSession`/`findPrincipalByTokenHash`, purely for future observability — not required by this ticket's acceptance criteria.
- The `check:scala-quality` script reports 131 pre-existing soft warnings baseline-wide; none attributable to this change, but worth a future cleanup ticket if not already tracked.
