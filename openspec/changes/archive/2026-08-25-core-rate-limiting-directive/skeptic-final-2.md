## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold re-derivation from ground truth. The orchestrator's summary and `evaluation-2.md` were
read as claims only; every conclusion below is grounded in the actual diff, the actual
pekko-http-1.1.0 source, or a command I ran myself.

### What I verified (with evidence)

**1. `sbt compile test` — GREEN (re-run by me).**
`cd backend && sbt -batch compile test` (full log:
`/tmp/claude-1000/.../scratchpad/sbt-run1.log`):
```
[info] Total number of tests run: 3393
[info] Tests: succeeded 3393, failed 0, canceled 0, ignored 0, pending 0
EXIT=0
```
All 11 `RateLimitDirectiveSpec` cases and all 5 `InMemoryRateLimiterSpec` cases listed as
passing. AC "sbt compile test green" is met.

**2. Round-1 REFUTE (spoofable header trust) — the header half is genuinely fixed.**
Read `backend/src/main/scala/com/helio/api/http/RateLimitDirective.scala` in full.
`ipKey` is `if (trustedProxyHops > 0) trustedProxyKey(...) else directConnectionKey`.
`directConnectionKey` is `extractRequest.map(_.attribute(AttributeKeys.remoteAddress))` with
no header consulted anywhere — I grepped the file: `X-Real-Ip` and `Remote-Address` do not
appear at all, and `extractClientIP` is gone. `trustedProxyKey` reads only
`optionalHeaderValueByType(X-Forwarded-For)`, indexes `addresses.size - hops`, and returns
`"ip:unknown"` when the header is absent or `indexFromEnd < 0` (header shorter than the hop
count). The absent/short fallbacks are correct and never trust a caller value.
I independently confirmed the round-1 diagnosis against the library source
(`pekko-http_2.13-1.1.0-sources.jar`, `MiscDirectives.scala:119-125`):
`_extractClientIP = headerValuePF { X-Forwarded-For(Seq(address, _*)) } | X-Real-Ip |
Remote-Address | attribute` — first-XFF-element first, attribute last. D3b describes this
accurately.

**3. `pekko.http.server.remote-address-attribute = on` is actually set** —
`backend/src/main/resources/application.conf` diff adds it under `pekko.http.server`. Without
it `directConnectionKey` would be permanently `"ip:unknown"`. Correctly present.

**4. Race fix in `InMemoryRateLimiter` is real.** `observedCount = counter.count.incrementAndGet()`
now happens inside the `ConcurrentHashMap.compute` remapping function, which CHM guarantees is
atomic per key. Correct.

**5. Doc corrections (round-1 CR2) landed.** `application.conf` comment, `RateLimitDirective`
scaladoc, `RateLimitConfig` scaladoc, and design.md D3b + Risks all now describe
header-before-attribute as the *bug* and the trusted-hop model as the fix. Design.md Risks
para at lines 185-194 explicitly reframes the unbounded-cardinality acceptance as
"conditioned on D3b's fix". No stale wrong-trust-model text remains (grepped for
`extractClientIP` across the change dir and backend main).

**6. Round-1 CONFIRMed items re-verified and still holding.**
- Key priority (session > PAT > IP, invalid credential falls to IP, no cookie→header
  fall-through): read `resolveKey`; matches D3/D3a and mirrors `AuthDirectives.resolveIdentity`.
- Two PATs, same user, independent budgets: keyed `pat:<tokenId>`, not `user:<id>`; test
  "keep two PATs belonging to the SAME user independently budgeted" present and passing.
- 429 + `Retry-After` + JSON `ErrorResponse`: `respondWithHeader(Retry-After(...)) & complete(
  StatusCodes.TooManyRequests, ErrorResponse(...))`; asserted by a passing test.
- Trait boundary: `RateLimiter.tryAcquire(key, limit, windowSeconds)` takes limit/window
  per-call, so a distributed impl is a drop-in. Confirmed.
- Per-instance caveat: documented in the `RateLimiter` scaladoc, design.md Risks, and the
  `RATE_LIMIT_REQUESTS_PER_WINDOW` CLAUDE.md row ("roughly 3x this value, not a hard global cap").
- No inline FQNs: `ApiRoutes.scala` imports `com.helio.services.ratelimit.{InMemoryRateLimiter,
  RateLimitConfig}` and uses short names; FQNs appear only inside `[[...]]` scaladoc links,
  which is the existing repo convention.
- Wiring location: `rateLimitDirective.rateLimit()` sits inside `requireCsrfHeader`, wrapping
  the entire `confineScopedToken` three-way branch. Matches D4.
- No scope creep: `git diff --stat main...HEAD` touches only CLAUDE.md, application.conf,
  ApiRoutes.scala, 3 new ratelimit sources, 2 new specs, and change artifacts.
- No UI changes in the diff, so section 4 (design-standard/visual judgment) does not apply.

**7. Three NEW defects found — see Change Requests.** Two of them (CR1, CR3) mean the
IP-based limiting this ticket ships is still ineffective in production, in the same
outcome class as the round-1 REFUTE, and CR2 means the round-2 regression suite does not
actually prove the trusted-hop branch works.

### Verdict: REFUTE

### Change Requests

**1. (Blocking, correctness) The IP bucket key includes the client's ephemeral TCP source
port, so `trustedProxyHops = 0` keys per-connection, not per-IP — the IP limiter is still
trivially evaded in production.**

`RateLimitDirective.scala` (`keyForAddress`):
```scala
private def keyForAddress(addr: RemoteAddress): String =
  if (addr.isUnknown) "ip:unknown" else s"ip:${addr.value}"
```
Ground truth from `pekko-http-core_2.13-1.1.0-sources.jar`:
- `HttpAttributes.scala:32` — `private[pekko] final case class RemoteAddress(address: InetSocketAddress)`
- `HttpServerBluePrint.scala:174` — `httpRequest.addAttribute(AttributeKeys.remoteAddress, RemoteAddress(remoteAddress))`
  where `remoteAddress` is that `InetSocketAddress`
- `RemoteAddress.scala` — `def apply(a: InetSocketAddress): IP = IP(a.getAddress, Some(a.getPort))`
  and `IP.render` = `r ~~ ip.getHostAddress; if (port.isDefined) r ~~ ":" ~~ port.get`

So the attribute Pekko's server attaches always carries `Some(port)`, and `addr.value`
renders `"203.0.113.10:53422"`, not `"203.0.113.10"`. Every new TCP connection from the same
attacker yields a brand-new bucket. A client that does not reuse a keep-alive connection —
or simply opens a new socket per request — is never throttled. This is the same practical
outcome as the round-1 REFUTE (fresh never-throttled bucket per request), reached by a
different route, and it also re-opens the memory-growth risk design.md Risks (lines 185-194)
claims is closed ("cardinality is bounded again by real distinct TCP peers" — it is bounded
by distinct *peer sockets*, which is unbounded).

The existing tests do not catch this because `withIp` builds
`RemoteAddress(new InetSocketAddress(addr, 0))` — port is the constant `0` in every request,
so the port component never varies within a test.

Required: key on the address only (e.g. `addr.toOption.map(_.getHostAddress)`, or
`RemoteAddress.renderWithoutPort`, or `addr.toIP.map(_.ip.getHostAddress)`), and add a
regression test that sends two requests from the SAME IP with DIFFERENT ports and asserts the
second is `429`. That test must fail against the current `addr.value` implementation.

**2. (Blocking, evidence) The new `trustedProxyHops >= 1` regression test proves nothing — it
passes unchanged against the round-1 pre-fix code.**

`RateLimitDirectiveSpec.scala`, test "key on the trusted-proxy-appended X-Forwarded-For hop
when trustedProxyHops >= 1, isolating distinct proxied clients":
```scala
withForwardedFor(viaProxy, "1.1.1.1", "203.0.113.60") ~> route ~> check { status shouldBe StatusCodes.OK }
withForwardedFor(viaProxy, "2.2.2.2", "203.0.113.61") ~> route ~> check { status shouldBe StatusCodes.OK }
```
Both assertions are `OK`. Under the pre-fix bare `extractClientIP`, the key would come from
the FIRST XFF element (`1.1.1.1`, then `2.2.2.2`) — also two distinct keys, also two `OK`s.
The test is satisfied by the buggy implementation, so it is not regression coverage; it only
demonstrates that two different requests can both succeed. (By contrast, the `hops = 0` test
IS genuine: pre-fix it would key on `1.2.3.4` then `9.9.9.9` and return `OK` where the test
demands `429`. That one I accept.)

Required: replace/augment it with a test that discriminates the two implementations — e.g.
two requests with DIFFERENT leading (caller-supplied) entries but the SAME trailing
proxy-appended entry:
```scala
withForwardedFor(viaProxy, "1.1.1.1", "203.0.113.60") -> expect 200
withForwardedFor(viaProxy, "2.2.2.2", "203.0.113.60") -> expect 429
```
Pre-fix this yields two distinct first-element keys and two `200`s → fails. Post-fix both
resolve to `203.0.113.60` → `429`. Also add a case asserting the documented safe fallbacks:
`hops = 1` with no `X-Forwarded-For` header at all, and `hops = 2` with a single-entry header,
both collapsing to `"ip:unknown"` rather than trusting a caller value.

**3. (Blocking, operational) The shipped production configuration leaves
`RATE_LIMIT_TRUSTED_PROXY_HOPS` at `0` on a deployment that is definitively behind a proxy,
which this change's own docs describe as a self-DoS.**

`infra/deploy-backend.sh:95` sets `--set-env-vars="^|^DATABASE_URL=...|COOKIE_SECURE=true|
LOG_FORMAT=json|..."` — no `RATE_LIMIT_*` entry — and that file's own header comment (line 33)
states `--set-env-vars`/`--set-secrets` **fully REPLACE** the Cloud Run env. So prod runs at
`trustedProxyHops = 0`.

Design.md D3b (lines 98-100) itself asserts "on Cloud Run: the GFE always attaches an
`X-Forwarded-For`", i.e. there IS a trusted proxy hop in front of this backend, and the new
CLAUDE.md row for this variable spells out the consequence: "if the backend actually sits
behind a proxy, leaving this at `0` keys every request on the proxy's own address, collapsing
all callers into one shared bucket (a trivial DoS: one bad caller throttles everyone)". That
is exactly what shipping this as-is does to every unauthenticated `/api` request in
production — login, signup, `/api/auth/*`, public dashboards, beta-access — behind one shared
120/min bucket.

Note the CLAUDE.md `COOKIE_SECURE` row's "no reverse proxy" phrasing refers to there being no
*self-managed* reverse proxy between the Firebase-hosted frontend and Cloud Run; it does not
mean requests reach the container without a Google front end. It is not a justification for
`hops = 0` in prod, and D3b already contradicts that reading.

Required: either (a) set `RATE_LIMIT_TRUSTED_PROXY_HOPS=1` in `infra/deploy-backend.sh`'s
`--set-env-vars` (alongside `COOKIE_SECURE=true`/`LOG_FORMAT=json`, which are hardcoded there
for the same "correct for this deploy target" reason) and note it in the CLAUDE.md row as
"set by `infra/deploy-backend.sh`", matching the `COOKIE_SECURE` precedent; or (b) if the
executor believes hops=0 is genuinely correct for Cloud Run, produce evidence for that (it
would contradict the change's own design.md) and correct D3b accordingly. Silently shipping a
default the change's own documentation calls a trivial DoS for the only known deployment is
not acceptable.

### Non-blocking notes

- CR1 and CR3 compound: with both unfixed, the prod IP key is
  `ip:<GFE-address>:<GFE-ephemeral-port>` — simultaneously collapsing distinct real clients
  together AND splitting a single client across connections. Fixing only one of the two still
  leaves IP limiting incorrect in production.
- `RateLimitDirective` performs its own `findValidSession`/`findPrincipalByTokenHash` lookup,
  duplicating the one `AuthDirectives` does moments later. Design.md Risks accepts this
  explicitly for this cut, and I agree it is out of scope — flagging only so the follow-up
  ticket it names does not get lost.
- `ApiRoutesCorsErrorHandlingSpec`'s simulated DB failure now surfaces through
  `RateLimitDirective.scala:96` rather than `AuthDirectives` (visible in the test log). Same
  500 behavior, test still green; no action needed, just noting the stack-trace shift for
  whoever reads that log next.
