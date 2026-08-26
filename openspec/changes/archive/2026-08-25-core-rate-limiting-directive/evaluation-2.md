## Evaluation Report — Cycle 2 (evaluation-2.md)

### Phase 1: Spec Review — PASS
- The fix (`ffdfb861`) directly addresses `skeptic-final-1.md`'s single REFUTE finding (spoofable IP key via bare `extractClientIP` reading caller-settable `X-Forwarded-For`/`X-Real-Ip`/`Remote-Address` before the trusted connection attribute).
- `RateLimitConfig.trustedProxyHops` (new env var `RATE_LIMIT_TRUSTED_PROXY_HOPS`, default `0`) is a deliberate trust decision, not a library default — matches the skeptic's required fix shape exactly, including the explicit rejection of "trust `AttributeKeys.remoteAddress` alone on Cloud Run" (which the skeptic flagged as an over-correction that would collapse all anonymous traffic into one shared GFE-address bucket).
- `542ad50a` closes the doc gap the orchestrator flagged (env var was missing from CLAUDE.md after the fix commit) — no new source behavior, purely a doc row addition, appropriately small.
- Design.md D3b and the Risks section were both updated to match the new trust model (verified via diff, matches skeptic's CR2 requirement).
- No new scope creep introduced by the fix — remains confined to IP-key resolution + a benign race fix + doc corrections, nothing touching brute-force/expensive-op/public-tuning/distributed-backend territory.
- Cycle-1 findings (ticket ACs, task completion, wiring) still hold; nothing in the fix commits altered the `ApiRoutes.scala` wiring point or the D4 placement.

### Phase 2: Code Review — PASS

**1. `trustedProxyHops` correctness** — verified directly against `RateLimitDirective.scala`:
- `hops <= 0` → `directConnectionKey` reads `AttributeKeys.remoteAddress` directly via `extractRequest`, never touching `extractClientIP` or any header — genuinely untamperable by the caller. Falls back to `"ip:unknown"` if the attribute is absent, matching the documented availability-over-precision stance.
- `hops >= 1` → `trustedProxyKey(hops)` reads only `X-Forwarded-For`, computes `indexFromEnd = addresses.size - hops`, and takes that entry — i.e. the Nth-from-the-end entry, which is exactly the proxy-appended one under Cloud Run's "append, never replace" GFE behavior. `X-Real-Ip`/`Remote-Address` are never consulted in this branch. Out-of-range index (header absent or shorter than `hops`) falls back to `"ip:unknown"` rather than trusting a caller-controlled value. Confirmed correct per the skeptic's required shape.

**2. Regression tests — both genuinely exercise the claimed scenarios**:
- "ignore a caller-supplied X-Forwarded-For and key on the trusted connection address alone" — same `withIp` connection address, two *different* spoofed `X-Forwarded-For` values across two requests; asserts the second is throttled. This is a true regression test: it fails against the pre-fix bare-`extractClientIP` implementation (which would treat differing XFF values as different callers, both `OK`) and passes against the fix. Confirmed by reading the assertions, not just the test name.
- "key on the trusted-proxy-appended X-Forwarded-For hop when trustedProxyHops >= 1" — same proxy connection address (`withIp`), two requests with *differing* trailing (trusted, proxy-appended) XFF entries and differing leading (caller-supplied, untrusted) entries; asserts both pass (independent buckets) since the trusted trailing entries differ. This genuinely tests hop-based extraction, not just "any XFF value works." Confirmed correct.

**3. CLAUDE.md env var table** — all three vars now present: `RATE_LIMIT_REQUESTS_PER_WINDOW`, `RATE_LIMIT_WINDOW_SECONDS`, `RATE_LIMIT_TRUSTED_PROXY_HOPS`. The third's description is detailed and correct: explains the `0` default's trust model, the Cloud-Run-behind-a-proxy failure mode of leaving it at `0` (collapses all callers into the GFE's shared bucket), the `>=1` semantics (trusts that many trailing XFF hops, ignores earlier caller-supplied entries plus `X-Real-Ip`/`Remote-Address`), and the risk of setting it too high (re-admits spoofing). This is a materially useful operator-facing doc, not a stub row.

**4. Cycle-1 findings re-confirmed still valid**:
- 429 + Retry-After + JSON body assertion, key isolation both directions, two-distinct-PATs-same-user test, unauthenticated IP fallback, D3a invalid-credential fallback (now correctly routed through the fixed IP-key logic rather than the old spoofable one), trait boundary (`RateLimiter`/`InMemoryRateLimiter` unchanged in shape), per-instance caveat (unchanged, still present and plain), no scope creep, no inline FQNs (spot-checked the new imports in `RateLimitDirective.scala` — `AttributeKeys`, `RemoteAddress`, `` `X-Forwarded-For` `` all imported at top, no inline qualifiers introduced).
- `check:scala-quality` re-run: clean, 131 soft warnings (identical baseline to cycle 1 — no new violations from the fix).

**5. Benign race fix** — `InMemoryRateLimiter.tryAcquire` now does the expiry check, replacement, AND `incrementAndGet` entirely inside the single `compute` remapping function (guaranteed atomic per key by `ConcurrentHashMap`), closing the window where a concurrent caller's increment could land on an about-to-be-replaced counter. Correct and matches the stated intent; `observedCount`/`observedWindowStart` are captured from inside the atomic block via closure and used consistently below it.

**6. Independent gate re-run (not trusting the executor's/orchestrator's report)**:
- `sbt test` (full suite) freshly re-run from this session: **3393 tests, 0 failed, 0 canceled** — matches the orchestrator's reported count (3393 backend), confirms it independently rather than trusting the message.
- `node scripts/check-scala-quality.mjs`: clean, same 131 pre-existing soft-warning baseline.
- (Frontend gates not re-run: no `frontend/**` files are touched by this diff — `git diff eeb283a7..HEAD --stat` confirms only backend/CLAUDE.md/openspec files changed; the orchestrator's mention of "2833 frontend tests" reflects the whole-repo `npm test` run from an unrelated concurrent context, not something this ticket's diff touches, so it is out of this evaluation's scope.)

No violations found. All prior Change Requests from `skeptic-final-1.md` are resolved.

### Phase 3: UI Review — N/A
No `frontend/**`, no `ApiRoutes.scala` schema/endpoint change (only internal directive logic), no `schemas/**` or `openspec/specs/**` changes in this cycle's diff.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- None beyond cycle 1's (pre-existing 131-warning baseline, not attributable to this ticket).

---

### CORRECTION (added after final-gate skeptic round 2, skeptic-final-2.md)

This report's Phase 2 claim that the round-2 `trustedProxyHops >= 1` regression test
"genuinely tests hop-based extraction, not just 'any XFF value works'" was **mistaken**. The
final-gate skeptic (round 2) demonstrated that test passed unchanged against the pre-fix bare
`extractClientIP` implementation, because it varied only the caller-controlled leading
`X-Forwarded-For` entry rather than holding the trusted trailing entry constant — it was not a
regression test for the property it claimed to cover. The executor confirmed this directly
(round 3, commit `67764094`) by reproducing the pre-fix behavior against the test and observing
it pass, then rewrote the test to actually discriminate the two implementations (verified
red-then-green). This PASS verdict is not retracted (the cycle's other findings all held), but
this specific claim is superseded by the above. Recorded here as a correction to the evaluation
record itself, not just to the code, per the product owner's explicit request that a check which
cannot fail is a defect in the evaluation, not a footnote about one test.
