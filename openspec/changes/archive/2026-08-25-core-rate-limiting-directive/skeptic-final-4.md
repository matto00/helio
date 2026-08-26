## Skeptic Report — final gate (round post-split, skeptic-final-4.md)

Fresh, cold assessment of the reduced-scope change as if it were a brand-new, smaller change.
Diff base: `c915b100`. Head: `ec99205a`. Backend-only change — no UI gate (no `frontend/**` files
in `git diff --stat c915b100...HEAD`).

### What I verified (with evidence)

**1. `sbt compile test` green — verified twice.**
Ran from `backend/` myself (not relying on the evaluator's paste). Two independent full runs, both:
`Tests: succeeded 3391, failed 0, canceled 0, ignored 0, pending 0` / `All tests passed.` /
`[success] Total time: 163 s`. A targeted third run
(`testOnly com.helio.api.http.RateLimitDirectiveSpec com.helio.services.ratelimit.InMemoryRateLimiterSpec`)
printed all 14 test names and `succeeded 14, failed 0` — confirming the rate-limit suites actually
execute rather than being silently skipped.

**2. `RateLimitDirective.scala` read in full.**
- (a) **Key priority is genuinely session > PAT.** `resolveKey` is
  `optionalCookie(SessionCookies.Name).flatMap { case Some(cookie) => ...session only...; case None => ...header... }`.
  The header branch is reachable *only* when no cookie is present. I checked this against ground
  truth rather than the scaladoc's claim: `AuthDirectives.resolveIdentity` (line 50-58) is
  `case (Some(token), _) => findValidSession(token)` / `case (None, Some(Authorization(...))) => resolveApiToken(token)`.
  Identical short-circuit — a present-but-invalid cookie does **not** fall through to the bearer
  header in either. Precedence matches exactly.
- (b) **No IP-keying path left.** `grep -rniE "remoteaddress|x-forwarded|trustedproxy|TRUSTED_PROXY|extractClientIP|keyForAddress|directConnectionKey|ip:"`
  across `backend/src/main`, `backend/src/test`, `backend/src/main/resources`, and `infra/` returns
  zero rate-limiting hits (the four hits are unrelated: `tooltip`/`ChartTooltip` in `model.scala`
  and `Design.md` in two prompt files, both incidental `ip:` / `.` regex matches). The
  `trustedProxyHops` constructor param, `directConnectionKey`, `trustedProxyKey`, and
  `keyForAddress` are all gone from the file and from the repo.
- (c) **`None` is an unconditional pass-through, not a fallback key.** `rateLimit` is
  `resolveKey.flatMap { case None => pass; case Some(key) => limiter.tryAcquire(key, ...) }`.
  The `None` arm never touches `limiter` at all — there is no sentinel/shared/`"anonymous"` key
  constructed anywhere in the file. `resolveKey` itself produces `Some(...)` in exactly two places
  (`s"user:${user.id.value}"`, `s"pat:${tokenId.value}"`), both distinctly prefixed so a user id
  and a token id can never collide.

**3. Previously-confirmed tests still hold under the new `Option[String]` shape.**
I re-read each rather than assuming the reshape was inert:
- Two-PATs-same-user: both `patTokenA1`/`patTokenA2` map to `userA` but distinct `ApiTokenId`s in
  the stub; PAT1 exhausted at limit 1 → 429, PAT2 → 200. Still keyed on `tokenId`, not user, so the
  property the orchestrator flagged as "most likely to be silently wrong" is genuinely held.
- 429 + `Retry-After` + body: asserts all three (`TooManyRequests`, `header("Retry-After") should not be empty`,
  `responseAs[ErrorResponse].message should not be empty`).
- Same-key-throttled (limit 2 → OK/OK/429) and different-users-independent (A exhausted → 429,
  B → 200) both still pass. Per-route override test (global 100, route 1) also intact.
All six share one directive/limiter instance per test, so throttling is genuinely cumulative.

**4. The three new "not rate-limited" tests prove what they claim.**
Each binds `val route = routeFor(newDirective(limit = 1))` **once** and reuses it, so all requests
in a test hit the same `InMemoryRateLimiter`. With `limit = 1`, any fallback key — shared or
per-request — would 429 on the second request. Unauthenticated: 3 requests, all 200. Invalid
session cookie: 2 requests, both 200. Unresolvable PAT bearer: 2 requests, both 200 (and the bearer
uses the real `helio_pat_` prefix, so it enters the `findPrincipalByTokenHash` arm and exercises the
intended `Success(None)` path rather than falling out at the prefix guard). These are red-capable,
not vacuous.

**5. `application.conf` and `infra/deploy-backend.sh` are clean.**
`git diff c915b100...HEAD -- backend/src/main/resources/application.conf infra/deploy-backend.sh | wc -l` → **0**.
Zero net change from base for both files. Confirmed.

**6. `CLAUDE.md` documents the gap plainly.**
The `RATE_LIMIT_REQUESTS_PER_WINDOW` row states the key is session user id or PAT token id, then:
"**Deliberate, tracked gap:** a request with no credential at all, or an unresolvable/invalid
session cookie or PAT bearer token, is **not currently rate-limited by this directive**". Bolded,
in the row's second sentence, with the HEL-837 pointer and the per-instance Cloud Run caveat. Not
buried, not softened.

**7. `ApiRoutes.scala` wiring unchanged.**
`git diff c915b100...HEAD -- backend/src/main/scala/com/helio/api/ApiRoutes.scala` shows the same
previously-confirmed shape: `rateLimitDirective.rateLimit() { ... }` opened immediately inside
`authDirectives.requireCsrfHeader {`, outermost, wrapping `confineScopedToken` and the entire
three-way auth branch. Construction is a single instance alongside `authDirectives`/`aclDirective`
with `RateLimitConfig.fromEnv()` read once. The scope reduction did not touch it.

**8. No scope creep.** The diff touches only the four `ratelimit`/`http` source files, `ApiRoutes`,
`CLAUDE.md`, two test files, and change docs. No brute-force lockout, no expensive-op guard, no
public-endpoint tuning, no distributed limiter backend — the trait boundary (`RateLimiter` /
`RateLimitResult`) is present for a future swap but only `InMemoryRateLimiter` is implemented.

**9. No inline fully-qualified names.** Regex scan for `(com|org|scala|java)(\.[a-z0-9_]+)+\.[A-Z]`
outside `import` lines and scaladoc across all five new/changed Scala files: none.

**10. `ip-keying-followup-for-hel837.md` is a usable handoff.** 526 lines, coherent section
structure (`Why this was deferred` / `The six findings, in order` / `The working implementation at
the end of cycle 4 (commit dc3ab524)` / `Tests` / `Config` / `Recommendation for HEL-837`). Head and
tail both read as complete prose, not truncated or garbled; the closing recommendation enumerates
three concrete options and correctly flags that the hop-count reasoning must be re-verified against
Google's docs before production trust. Whoever picks up HEL-837 could work from this.

### Verdict: REFUTE

The **code and tests are fully confirmed** — every one of the ten items above passes on the
implementation side, and I found no defect in the shipped authenticated-keying surface. The refusal
is narrow and documentation-only: two committed change artifacts now state, as fact, things the
shipped diff contradicts. This repo has a recorded history of confidently-false documentation
surviving review, and `files-modified.md` is specifically the artifact a future reader consults to
learn what shipped. Fixing both is a docs-only pass with no code, test, or re-verification cost.

### Change Requests

1. **`openspec/changes/core-rate-limiting-directive/files-modified.md` is entirely stale and now
   factually false about the shipped diff.** Every substantive line describes cycle-4 IP-keying work
   that `ec99205a` removed. Specifically:
   - Line 3 claims `RateLimitConfig.scala` is "env-sourced config incl. `trustedProxyHops`" — the
     field and its env var no longer exist; the file has exactly two fields
     (`requestsPerWindow`, `windowSeconds`).
   - Line 4 describes `RateLimitDirective.scala`'s change as the `trustedProxyKey` /
     `X-Forwarded-For` multi-instance fix — none of that code exists in the file any more.
   - Line 5 claims `application.conf` carries a corrected `remote-address-attribute` comment — that
     file has **zero net change from base** (verified in item 5 above).
   - Line 6 claims `infra/deploy-backend.sh` carries `RATE_LIMIT_TRUSTED_PROXY_HOPS=1` "already
     landed cycle 3" — that file also has **zero net change from base**.
   - Lines 8-9 describe XFF/`hops` tests that were deleted from `RateLimitDirectiveSpec.scala`.
   - It also claims "`CLAUDE.md` (worktree copy) — unchanged this cycle", but `CLAUDE.md` *is*
     changed in the shipped diff.
   Rewrite it to describe what `c915b100...HEAD` actually contains: the four new `ratelimit`/`http`
   source files, the `ApiRoutes.scala` wiring, the `CLAUDE.md` env-table row, the two test files,
   and the change docs including `ip-keying-followup-for-hel837.md` — with `application.conf` and
   `infra/deploy-backend.sh` either omitted or explicitly listed as net-zero.

2. **`openspec/changes/core-rate-limiting-directive/proposal.md` still presents IP keying as the
   shipped design, with no pointer to the split.** Line 17 reads "client IP fallback when
   unauthenticated", and the `New Capabilities` entry (lines ~28-30) names the capability
   "reusable per-user/per-PAT/**per-IP** request rate-limiting Pekko HTTP directive". `design.md`
   (its "Scope split" section and the D6 parenthetical), `tasks.md`, `specs/rate-limiting-directive/spec.md`,
   and `CLAUDE.md` were all correctly revised — `proposal.md` was missed. Either revise these two
   spots to authenticated-only, or add the same one-line "split to HEL-837, see design.md's Scope
   split" pointer the other artifacts carry, so the proposal does not read as describing shipped
   behavior that does not exist.

### Non-blocking notes

- The ticket body's own Scope bullet ("Fall back to client IP for unauthenticated requests") and the
  orchestrator note ("Test unauthenticated IP fallback path") are likewise superseded by the
  product-owner split. I did not treat these as defects — `ticket.md` is an input record, not a
  delivery artifact, and the split is documented in `design.md`. Worth a line in HEL-495's Linear
  description if the ticket is meant to stay self-describing after archive.
- The worktree's branch predates `scripts/concertino/next-report-number.sh`, `persist-evidence.sh`,
  and `emit-event.sh` (its `scripts/concertino/` has only `assert-phase.sh`, `cleanup.sh`,
  `setup-worktree.sh`, `start-servers.sh`). I ran the main-repo copies against the worktree path;
  this is not a blocker, just a note that in-worktree relative invocations of those scripts will
  fail on this branch.
- `InMemoryRateLimiter`'s fixed-window boundary burst (up to 2x limit straddling a reset) is
  documented in the class scaladoc, in `design.md` Risks, and pinned by an explicit test. Accepted,
  not a defect.
