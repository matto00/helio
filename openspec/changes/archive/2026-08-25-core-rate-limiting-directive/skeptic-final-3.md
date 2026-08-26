## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Cold review. Every conclusion below is derived from files/commands I read myself in
`/home/matt/Development/helio/.claude/worktrees/feature/core-rate-limiting-directive/HEL-495`,
not from the executor's or evaluator's narrative.

Branch commits reviewed: `eeb283a7`, `ffdfb861`, `542ad50a`, `67764094`, `de3236c1`.

### What I verified (with evidence)

**1. `sbt compile test` — GREEN (re-run by me).**
Ran `sbt -batch compile test` from `backend/`. Exit code 0.
```
[info] Total number of tests run: 3397
[info] Tests: succeeded 3397, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```
`InMemoryRateLimiterSpec` and `RateLimitDirectiveSpec` both appear in the run log
(lines 13584 / 14251), so the new suites genuinely executed, not silently skipped.

**2. CR1 (port-inclusive IP key) — FIXED, verified by reading.**
`RateLimitDirective.scala:79-83`:
```scala
private def keyForAddress(addr: RemoteAddress): String =
  addr.toOption.map(_.getHostAddress) match {
    case Some(host) => s"ip:$host"
    case None        => "ip:unknown"
  }
```
`RemoteAddress.toOption` yields `Option[InetAddress]` — the port is structurally
unreachable from that value, so no code path can reintroduce it. The `None` arm
(`RemoteAddress.Unknown`) yields the fixed `"ip:unknown"`, also port-free. Both
callers (`directConnectionKey`, `trustedProxyKey`) go through this one function; no
other key construction exists in the file. Regression test at spec line ~231 uses
the same host on ports 51000/52000 and asserts 200→429 — correct discrimination
(under the pre-fix `.value` key those are two distinct keys → 200/200).

**3. CR2 (weak `trustedProxyHops >= 1` test) — GENUINELY FIXED. I re-derived this rather than trusting the claim.**
I extracted Pekko's own source to establish the pre-fix behavior as ground truth
(`pekko-http_2.13-1.1.0-sources.jar`, `MiscDirectives.scala:119-125`):
```scala
private val _extractClientIP: Directive1[RemoteAddress] =
  headerValuePF { case `X-Forwarded-For`(Seq(address, _*)) => address } | ...
```
i.e. pre-fix keyed on the **leading** XFF entry. Tracing the corrected test
(`RateLimitDirectiveSpec.scala:~239-247`): request 1 XFF `[1.1.1.1, 203.0.113.60]`,
request 2 XFF `[2.2.2.2, 203.0.113.60]`, limit 1, asserts 200 then **429**.
- Pre-fix: keys `ip:1.1.1.1` and `ip:2.2.2.2` → 200/200 → **the test fails.** Genuinely RED.
- Post-fix (`indexFromEnd = 2 - 1 = 1`): both key `ip:203.0.113.60` → 200/429 → passes.
The test now discriminates the two implementations. The companion "two different real
clients" test additionally pins independence. CR2 is satisfied.

**4. CR3 (prod `hops=0`) — FIXED, and the topology reasoning holds under my own check.**
`infra/deploy-backend.sh:110` `--set-env-vars` now ends with `|RATE_LIMIT_TRUSTED_PROXY_HOPS=1`.
I independently searched for anything that would contradict "exactly one trusted hop":
`grep -rniE "load.?balanc|cloud.?armor|CDN|backend-service|url-map|serverless-neg|network-endpoint" infra/ docs/`
returns only this ticket's own new comment lines plus two unrelated Playwright-CDN
lines in `docs/cloud-dev-setup.md`. `infra/` contains only `deploy-backend.sh`,
`docker-compose.spark.yml`, `README.md`. I also checked `frontend/firebase.json`
myself for a hosting→Cloud Run rewrite that would add a hop: there is none (the only
rewrite is the SPA `** → /index.html`), consistent with the cross-site
`COOKIE_SECURE`/`CORS_ALLOWED_ORIGINS` story in CLAUDE.md. So the browser reaches the
`*.run.app` URL directly: GFE is the single hop. Reasoning sound.
The "re-derive if a proxy is added" warning is present in **both** required places:
`infra/deploy-backend.sh:59-61` and the CLAUDE.md `RATE_LIMIT_TRUSTED_PROXY_HOPS` row
(line 63, "re-derive this value (never assume `1`)…").

**5. `evaluation-2.md` correction — present and explicit.**
Appended `### CORRECTION` section states the prior claim was "**mistaken**", names the
specific test and why it could not fail, and does so as a correction to the evaluation
record rather than a footnote. Satisfies round 2's requirement.

**6. Previously-CONFIRMed properties re-checked, all still hold.**
- Key priority (session > PAT > IP, with session-miss short-circuiting to IP rather than
  falling through to the header): `RateLimitDirective.scala:110-127`, matches the documented D3.
- Two PATs / same user independently budgeted: spec test present, keys on `tokenId`, not `userId`.
- 429 + `Retry-After` + JSON `ErrorResponse`: `rateLimit()` at :131-139, asserted in spec.
- D3a invalid-credential → IP fallback (isolated per IP): two spec tests present.
- Trait boundary + per-instance caveat: `RateLimiter.scala` scaladoc + CLAUDE.md row 61.
- D4 wiring location: `ApiRoutes.scala`, outermost inside `requireCsrfHeader`, wrapping the whole
  three-way auth branch — as designed.
- No inline FQNs: the only fully-qualified names added are inside `[[...]]` scaladoc links, which
  is the existing convention.
- No scope creep: diff touches only the four new `ratelimit`/`http` files, their specs,
  `ApiRoutes` wiring, `application.conf`, `CLAUDE.md`, `infra/deploy-backend.sh`.
- Unbounded map growth is an explicitly reasoned, accepted risk in `design.md:215-231`, and the
  CR1 host-only fix genuinely restores the cardinality bound that acceptance depends on.
- All five ticket acceptance criteria trace to concrete code/tests.

### Verdict: REFUTE

Rounds 1 and 2 each found a different way a caller-influenceable value reached the
bucket key. Looking hard for a fourth (as asked), I found one more instance of exactly
that class, plus two smaller defects that are direct residue of round 2's own
requirements. All three fixes are small and strictly in-area.

### Change Requests

**1. `trustedProxyKey` reads only the FIRST `X-Forwarded-For` header instance, so a repeated header defeats the trusted-hop derivation entirely.**
`backend/src/main/scala/com/helio/api/http/RateLimitDirective.scala:98-105` uses
`optionalHeaderValueByType(`X-Forwarded-For`)`. I confirmed from Pekko's source that
this resolves via `request.headers.collectFirst`
(`HeaderDirectives.scala:62`) — it returns the **first** matching header instance and
silently discards every later one. Pekko's parser does not merge repeated field lines
into one header object (`HttpRequest.headers` is a `Seq`), so under RFC 7230 §3.2.2
semantics the directive is reading a *prefix* of the real forwarded-for list, not the
list.

Concrete break: a caller sends `X-Forwarded-For: 9.9.9.9` and the proxy contributes its
value as a **separate** header line rather than appending to the caller's. `headers`
becomes `[XFF(9.9.9.9), XFF(<realClientIP>)]`; `collectFirst` yields the first;
`addresses.size = 1`, `hops = 1`, `indexFromEnd = 0` → key `ip:9.9.9.9`, fully
caller-chosen. That is precisely the round-1 vulnerability, reinstated — and it now
lands in **production**, because CR3 just shipped `hops=1`.

I could not determine from anything in this repo whether Cloud Run's GFE ever emits a
second header line versus appending to the existing one, and neither could the executor
— the design's safety currently rests on that unverified assumption. It should not have
to. Fix: collect **all** `X-Forwarded-For` header instances in request order and flatten
their `addresses` before indexing from the end, e.g.

```scala
extractRequest.map { request =>
  val addresses = request.headers.collect { case xff: `X-Forwarded-For` => xff.addresses }.flatten
  val indexFromEnd = addresses.size - hops
  if (indexFromEnd >= 0) keyForAddress(addresses(indexFromEnd)) else "ip:unknown"
}
```
Add a regression test with two separate `X-Forwarded-For` header instances
(`[XFF("1.1.1.1"), XFF("203.0.113.60")]` then `[XFF("2.2.2.2"), XFF("203.0.113.60")]`,
`hops = 1`, limit 1, expecting 200→429) and verify it RED against the current
`optionalHeaderValueByType` implementation before applying the fix. Update
`RateLimitDirective`'s scaladoc, which currently says the header participates as a
single list.

**2. `backend/src/main/resources/application.conf:14-17` states behavior the code does not have.**
The comment says `remote-address-attribute` is "Still required even when
`RateLimitConfig.trustedProxyHops > 0` … this attribute remains the fallback whenever
that header is absent or shorter than the configured hop count." That is false:
`trustedProxyKey` (`RateLimitDirective.scala:99-105`) falls back to the literal
`"ip:unknown"` in both of those cases and never reads `AttributeKeys.remoteAddress`.
`design.md` D3b and the directive's own scaladoc both correctly describe the
`"ip:unknown"` fallback, so this config comment is the outlier. Given rounds 1–3 all
turned on exactly which value is trusted when, a config file asserting a
non-existent trust fallback is a live hazard for the next reader. Correct the comment
to state the actual behavior (the attribute is read only on the `trustedProxyHops <= 0`
path, and is kept `on` so that path stays correct if the hop count is ever set back to 0).

**3. The two `ip:unknown` fallback tests cannot fail against the behavior they claim to exclude — the same defect class as round 2's CR2.**
`RateLimitDirectiveSpec.scala:249` (hops=1, no XFF) issues the *same* request twice from
the *same* connection IP and asserts 200→429. `:259` (hops=2, one XFF entry) issues the
*same* header twice and asserts 200→429. In both cases any deterministic keying — including
keying on the connection attribute, or (at :259) trusting the single caller-supplied
entry `203.0.113.60`, the exact thing the test title says must never happen — produces
identical 200→429. Neither test establishes that the key is `"ip:unknown"`.

Make them discriminating by **varying** the value that must not be trusted across the
two requests while still asserting the second is throttled:
- `:249` — vary the connection address (`198.51.100.100` then `198.51.100.101`), still expect
  200→429. Fails if the code fell back to the connection attribute.
- `:259` — vary the single XFF entry (`203.0.113.60` then `203.0.113.61`), still expect
  200→429. Fails if the code trusted the too-short header's caller-supplied entry.

Round 2 established the standard that a check which cannot fail is a defect, not a
footnote; these two are the remaining instances of it in this suite.

### Non-blocking notes
- `scripts/concertino/next-report-number.sh` (and several sibling scripts) do not exist in
  this worktree's `scripts/concertino/`, only in the main checkout — the worktree was created
  from an older tree. Not a defect in this change; I ran the script from the main repo.
- The fixed-window 2x-boundary burst and the per-instance (`max-instances=3`) multiplier are
  both correctly documented as accepted limitations; no action.
