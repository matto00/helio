## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Re-review of the five round-1 required revisions against ground truth in this worktree.

### What I verified (with evidence)

1. **Key-priority contradiction (round-1 item 1) — RESOLVED.** design.md Goals (line 21)
   now reads "session user id > PAT token id > client IP"; D3 (line 62) states the same
   "priority session > PAT > IP". No remaining statement of a different order anywhere in
   design.md (read in full).
   Ground truth: `AuthDirectives.resolveIdentity` (AuthDirectives.scala:50-58) matches
   exactly — `case (Some(token), _) => findValidSession(...)` (cookie of any validity wins
   and short-circuits), `case (None, Some(Bearer(t))) => resolveApiToken(t)`. D3's
   step-by-step (1/2/3) is a faithful mirror, including the "do not fall through to the
   header when the cookie fails to resolve" short-circuit.

2. **Present-but-invalid credential key (item 2) — RESOLVED.** New D3a (lines 81-87)
   requires an unresolvable cookie or unresolvable bearer to key as `"ip:<addr>"` and
   explicitly bans a shared literal (`"invalid"`/`"anonymous"`). This is consistent with
   D3, not merely appended: D3 step 1's `None` branch and step 2's non-resolving branch
   both say "fall to the IP key, D3a", and D3 step 3 restates it. No path in D3 is left
   without a defined key. tasks.md 3.3 adds two explicit test cases (invalid session
   cookie, invalid PAT bearer) asserting IP-key fallback and isolation.

3. **extractClientIP / remote-address attribute (item 3) — RESOLVED and grounded.** New
   D3b (lines 89-103) requires adding `pekko.http.server.remote-address-attribute = on`
   to `application.conf`. I verified against the real file
   (`backend/src/main/resources/application.conf`): its `pekko { ... }` block contains
   only `loggers`/`logging-filter`/`loglevel`, and `grep -n "remote-address"` finds
   nothing anywhere in the file — the design's claim that it is "not currently enabled"
   is factually correct, and the added key does not conflict with any existing setting.
   The residual-`Unknown` case has a defined behavior (`"ip:unknown"`, availability over
   precision) rather than an undefined reject.

4. **Double auth resolution (item 4) — RESOLVED.** New Risks/Trade-offs bullet
   (lines 166-174) names the exact extra cost (`findValidSession`/
   `findPrincipalByTokenHash` per `/api` request), states it is accepted, and names the
   rejected alternative and a future path (request attribute). This is a real
   acknowledgement, not a hand-wave.

5. **Insertion point (item 5) — RESOLVED in design.md.** D4 (lines 118-130) now gives an
   exact code shape. I checked it against `ApiRoutes.scala:516-534`: the real nesting is
   `pathPrefix("api") { authDirectives.requireCsrfHeader { authDirectives.confineScopedToken { tokenScope => concat(...) } } }`.
   D4's snippet places `rateLimitDirective.rateLimit()` immediately inside
   `requireCsrfHeader` and wrapping `confineScopedToken` in its entirety — structurally
   correct and unambiguous, and it does sit ahead of all three branches
   (`pathPrefix("auth")` / `optionalAuthenticate` / `authenticate`) as the ticket requires.

**Other adversarial checks:** no TODO/TBD/placeholder in design.md or tasks.md; D2 trait
signature is concrete; D5/D6 leave only mechanical "confirm the typed header exists in this
Pekko version" details, which are implementation-time lookups, not design forks. Every
ticket.md acceptance criterion traces to a tasks.md item (429+Retry-After+JSON → 3.2/3.3;
independent budgets → 3.3; env config + CLAUDE.md → 2.1/2.2; per-instance caveat + trait →
1.1/2.2 + Risks; `sbt compile test` → 4.3). No scope drift into the four out-of-scope
sibling areas.

### Verdict: CONFIRM

Sound enough to implement. Two non-blocking notes below.

### Non-blocking notes

- **tasks.md 4.2 wording lags design.md D4.** It reads "Wrap the `/api` `pathPrefix` body
  with `rateLimitDirective.rateLimit()` ahead of `confineScopedToken`". Read literally,
  "the `/api` pathPrefix body" is the slot *outside* `requireCsrfHeader` — a different slot
  from D4's. It does cite "(design.md D4)", and D4 is now an unambiguous code block, so the
  implementer has an authoritative reference; but restating 4.2 as "immediately inside
  `authDirectives.requireCsrfHeader`, wrapping `confineScopedToken`" would remove the last
  trace of the round-1 ambiguity.
- **spec.md does not carry the D3a requirement.** The invalid-credential-keys-to-IP rule
  exists in design.md and in tasks.md 3.3's test list, but there is no corresponding
  Requirement/Scenario in `specs/rate-limiting-directive/spec.md`. Adding one scenario
  under the "Unauthenticated requests fall back to client IP" requirement would keep the
  spec the source of truth for a behavior the tests will assert.
