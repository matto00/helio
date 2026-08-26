## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**1. `sbt compile test` — re-run by me, green.**
Ran `sbt compile test` from `backend/` at `eeb283a7`. Exit 0.
`[info] Tests: succeeded 3391, failed 0, canceled 0, ignored 0, pending 0` / `[info] All tests passed.` / `[success] Total time: 161 s`.
I confirmed both new suites *actually executed* (not silently skipped) by locating them in the full log, not the summary:
`InMemoryRateLimiterSpec:` (5 cases) and `RateLimitDirectiveSpec:` (9 cases), all listed as passing.

**2. Key resolution priority — matches `AuthDirectives.resolveIdentity`.**
`RateLimitDirective.scala:53-71` resolves cookie first; on a cookie that does not resolve it goes to `ipKey` and **does not** fall through to the `Authorization` header — mirroring `AuthDirectives.scala:54-58`'s `case (Some(token), _) => ...` session-over-header short-circuit. PAT branch only runs when no cookie is present. Priority session > PAT > IP confirmed against both sources.

**3. Present-but-invalid credential does not collapse to a shared constant key.**
Both invalid branches (`case _ => ipKey`, lines 58 and 67) route to the per-IP key, and this is covered by two dedicated tests that assert a *second, different* IP presenting the *same* invalid credential is still allowed (`RateLimitDirectiveSpec.scala:146-170`). Correct in principle — but see Change Request 1: the IP key itself is not trustworthy.

**4. Two PATs, SAME user — genuinely distinct token ids for one user.**
`RateLimitDirectiveSpec.scala:55-60` maps both `patTokenA1` and `patTokenA2` to `userA` (the same `AuthenticatedUser`) with distinct `ApiTokenId("token-a1")` / `ApiTokenId("token-a2")`. The key is `s"pat:${tokenId.value}"` (directive line 66), not the user id. The test at lines 120-134 is the real property, not a two-different-users lookalike. This is the failure mode the ticket flagged as most likely to be silently wrong; it is correct.

**5. 429 + Retry-After + JSON body asserted together in one test.**
`RateLimitDirectiveSpec.scala:83-94` asserts, in a single `check` block: `status shouldBe StatusCodes.TooManyRequests`, `header("Retry-After") should not be empty`, and `responseAs[ErrorResponse].message should not be empty` (the last forces a real JSON unmarshal of the body). Satisfied.

**6. Trait boundary real; per-instance caveat documented plainly.**
`RateLimiter.scala:21-26` is a genuine seam: `tryAcquire(key, limit, windowSeconds)` takes limit/window per call rather than baking them in, so one instance serves both the global default and a tighter per-route limit — and `ApiRoutes.scala:184` injects `new InMemoryRateLimiter()` as a `RateLimiter`, so a swap touches one line. The per-instance caveat is in the CLAUDE.md prod env table in the `RATE_LIMIT_REQUESTS_PER_WINDOW` row itself ("in-process/per-instance — under Cloud Run's `max-instances=3`, the effective limit is roughly 3x this value, not a hard global cap"), i.e. in the row a reader configuring the value reads. Not buried.

**7. No scope creep.** Grepped the new sources for lockout/brute-force/LLM/Redis/distributed: only a single scaladoc mention of Redis as a *future* possibility in `RateLimiter.scala:16`. No auth lockout, no expensive-op guard, no public-endpoint tuning, no distributed backend implemented.

**8. No inline fully-qualified names.** The only `com.helio.*` occurrences outside `package`/`import` lines in the new files are two scaladoc `[[...]]` cross-package links in `RateLimiter.scala:5,14`. CONTRIBUTING.md:29 governs code qualifiers, not doc links. Clean.

**9. Wiring location — verified against the live diff, not design.md's claim.**
`git diff c915b100...HEAD -- backend/src/main/scala/com/helio/api/ApiRoutes.scala` shows `rateLimitDirective.rateLimit() {` opening immediately inside `authDirectives.requireCsrfHeader {` at line ~534, above the `confineScopedToken` comment block, with the matching `}` added at the outer level alongside `confineScopedToken`'s existing closing brace. It genuinely wraps `confineScopedToken` and all three downstream auth branches in their entirety. Claim confirmed by the diff.

**10. Window-boundary burst — documented; test is weak but the underlying property is covered.**
Documented in `design.md:153-154` (Risks, accepted) and restated in `InMemoryRateLimiter.scala:14-16`. See Non-blocking note 1 on the test itself.

**11. New finding — client IP is attacker-controlled (Change Request 1).**
`RateLimitDirective.scala:51` uses bare `extractClientIP`. I read the resolved library's own source rather than assuming: `backend/build.sbt:86` pins `pekko-http 1.1.0`; unpacking `pekko-http_2.13-1.1.0-sources.jar`, `MiscDirectives.scala:119-125` defines it as:

```scala
private val _extractClientIP: Directive1[RemoteAddress] =
  headerValuePF { case `X-Forwarded-For`(Seq(address, _*)) => address } |
  headerValuePF { case `X-Real-Ip`(address) => address } |
  headerValuePF { case `Remote-Address`(address) => address } |
  extractRequest.map { request =>
    request.attribute(AttributeKeys.remoteAddress).getOrElse(RemoteAddress.Unknown)
  }
```

Three client-settable headers take priority over the trusted connection attribute, unconditionally, with no trusted-proxy gating. Detail in the Change Request.

### Verdict: REFUTE

Items 1-10 of the brief all check out; the implementation is careful, well-documented, and the two properties most likely to be silently wrong (same-user dual PAT budgets, invalid-credential fallback) are genuinely correct. It fails on one defect that only shows up when you read the library rather than the directive: the IP bucket key is chosen by the caller.

### Change Requests

**1. The per-IP bucket key is trivially spoofable, which voids the rate limit for all unauthenticated traffic — and turns the accepted "unbounded map growth" risk into a remote memory-exhaustion vector.**

`backend/src/main/scala/com/helio/api/http/RateLimitDirective.scala:51` uses bare `extractClientIP`. Per the pekko-http 1.1.0 source quoted above, that reads `X-Forwarded-For` (first element), then `X-Real-Ip`, then `Remote-Address`, and only then the trusted `AttributeKeys.remoteAddress` connection attribute. All three headers are set by the caller on an internet-facing service:

- Any client can send `X-Real-Ip: <random>` (or an `X-Forwarded-For` whose first element it chooses) on every request and receive a brand-new bucket each time. The limiter never trips. Since the IP key is the *only* budget for unauthenticated requests — and, per D3a, for every request bearing an invalid cookie or invalid PAT — this defeats the directive on exactly the anonymous-flood case it exists to stop, including the login and beta-access paths.
- On Cloud Run this is not merely theoretical: the GFE always presents an `X-Forwarded-For`, and a client-supplied value is appended to rather than replaced, so the *first* element — the one this code takes — is caller-chosen in production.
- Compounding: `design.md:162-163` accepts unbounded `ConcurrentHashMap` growth as fine "at expected traffic levels". That acceptance rests on key cardinality being bounded by real users and real IPs. With caller-chosen keys, one client can mint unbounded distinct keys as fast as it can send requests, and nothing evicts them. `InMemoryRateLimiter.scala:9-10`'s "so entries never grow unbounded per key" is true per key and quietly steps around map cardinality. The rate limiter becomes its own DoS surface.

Fix by resolving the IP from a trusted source rather than `extractClientIP`. Please do **not** over-correct into reading `AttributeKeys.remoteAddress` alone: behind Cloud Run that is the Google front-end address, which would collapse all anonymous traffic into a single shared bucket — precisely the shared-constant-key failure D3a was written to prevent. The correct shape is an explicit, configurable trusted-proxy resolution, e.g. a `RateLimitConfig` setting for the number of trusted proxy hops (default 0 = use the connection attribute; on Cloud Run 1 = take the *last* `X-Forwarded-For` entry, the one appended by the trusted proxy), ignoring `X-Real-Ip` / `Remote-Address` entirely. Whatever shape you choose, it must be a deliberate trust decision, not a library default.

Required tests (the current suite passes with the bug present, so it does not constrain this):
- Two requests from the same connection-level address carrying *different* spoofed `X-Forwarded-For` / `X-Real-Ip` values must share one bucket — the second must be throttled at `limit = 1`.
- With the trusted-hops setting configured for a proxy, two requests whose proxy-appended real client IPs differ must land in *different* buckets.

**2. Correct the two doc comments that misdescribe the trust model.**

Both currently state the opposite of the library's behavior and would keep the next reader from noticing CR 1:
- `backend/src/main/resources/application.conf` (HEL-495 comment): says `remote-address-attribute` makes `extractClientIP` resolve "from the underlying connection, or X-Forwarded-For/X-Real-Ip when behind a proxy". Headers are not the behind-a-proxy case — they always win, from any caller. Also re-state whether this setting is still needed under the CR 1 fix.
- `RateLimitDirective.scala:36-40` (the D3b paragraph): describes IP extraction as relying on the attribute and never mentions that headers take priority over it.

Update `design.md`'s D3b and its Risks entry at lines 162-163 to match the chosen fix, and note there whether unbounded map growth remains acceptable once keys are no longer caller-chosen.

### Non-blocking notes

1. `InMemoryRateLimiterSpec.scala:44-52` ("accept up to ~2x limit across a window-boundary burst") does not test what it claims: with `limit = 2` it makes two calls and asserts both `Allowed`, which passes identically if windowing were removed entirely. The real reset property *is* genuinely proven by the test at lines 29-34 (`limit = 1`, `windowSeconds = 0`, second call `Allowed` — would be `Exceeded` without a reset), so nothing is uncovered; the burst test is just non-evidence. Consider strengthening it to `limit = 1` and asserting more than `limit` total calls succeed across the boundary, or fold it into the reset test.
2. `InMemoryRateLimiter.tryAcquire` (lines 25-32) reads the counter via `compute` and then calls `incrementAndGet` outside that atomic block. A concurrent caller can replace the `WindowCounter` in between, so the increment lands on an orphaned counter and that request goes uncounted. Harmless drift for a fixed-window approximation, but worth a comment or an in-`compute` increment.
3. `ApiRoutes.scala`: the block wrapped by the new `rateLimit() {` was not re-indented, so the body now sits one level shallower than its brace nesting. `sbt compile test` and the commit's hooks were green, so this is cosmetic only.
