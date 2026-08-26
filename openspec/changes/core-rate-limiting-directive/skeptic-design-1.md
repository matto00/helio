## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read all five artifacts under `openspec/changes/core-rate-limiting-directive/`
  (`ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/rate-limiting-directive/spec.md`) in full.
- Read ground truth `backend/src/main/scala/com/helio/api/http/AuthDirectives.scala`:
  `resolveIdentity` precedence is **session cookie first, bearer PAT only when the
  cookie is absent**; `confineScopedToken` already calls
  `repo.findPrincipalByTokenHash(hash)` returning `(AuthenticatedUser, ApiTokenId,
  Option[Set[String]])` — design.md's claim that no new repo method is needed is
  correct.
- Read `ApiRoutes.scala` (lines ~505–548): the `/api` block is
  `pathPrefix("api") { requireCsrfHeader { confineScopedToken { concat(auth,
  optionalAuthenticate, authenticate) } } }`. Design's described insertion point
  is real; its exact relation to `requireCsrfHeader` is not pinned (see CR5).
- Read `UserSessionRepository.findValidSession` — a live Slick DB query on the hot
  auth path (its own scaladoc says so). Confirms the directive's independent
  resolution issues a *second* DB round-trip per request (CR4).
- `grep -rn "remote-address|extractClientIP|X-Forwarded-For" backend/src` → **no
  matches**: the server does not enable Pekko's remote-address attribute and
  nothing handles `X-Forwarded-For` today (CR3).
- Scope check: no artifact contains brute-force lockout, LLM/expensive-op cost
  guards, public-endpoint tuning, or a distributed backend implementation. Ticket's
  out-of-scope list is respected. Trait boundary (D2) and the per-instance
  Cloud Run caveat are both present in proposal, design Risks, spec requirement,
  and tasks 2.2 — plainly stated, not buried. Env-var approach (D6) and the
  CLAUDE.md prod-table update (task 2.2) are planned. Directive-style /
  no-inline-FQN requirement is carried in task 3.1.

### Verdict: REFUTE

The shape is right, but key resolution — the ticket's single highest-risk area —
has an internal contradiction and two undefined cases, and the perf cost of the
chosen "resolve independently" approach is unacknowledged.

### Change Requests

1. **design.md contradicts itself on key priority.** Goals bullet 2 says
   "PAT token id > session user id > client IP, in that priority"; D3 says the
   directive "checks `helio_session` cookie -> resolve session user id; else checks
   `Authorization: Bearer helio_pat_`". These are opposite orders. `AuthDirectives.resolveIdentity`
   is unambiguously **session-over-header**, and D3's own stated purpose is to
   mirror it. Fix the Goals bullet to `session user id > PAT token id > client IP`
   (or state the divergence and justify it) so the implementer cannot pick the
   wrong one.

2. **Undefined key for a present-but-invalid credential.** Every artifact
   describes only two authenticated cases (valid session, valid PAT) plus
   "unauthenticated -> IP". But `AuthDirectives` 401s on *present but
   invalid/expired/revoked/unknown* credentials, and that is precisely the flood
   an abuse-protection ticket must cover. Design must state explicitly what key a
   request with an invalid cookie or an unresolvable/non-`helio_pat_` bearer gets.
   Specify **fall back to the client-IP key** (and explicitly forbid a single
   shared literal such as `"anon"`/`"unknown"`, which would let one attacker
   throttle every other failing caller globally). Add a spec scenario and a
   route-testkit case in tasks 3.3 for "credential present but invalid is limited
   by IP, not exempt".

3. **`extractClientIP` will reject, not fall back.** D3 says the IP branch uses
   `extractClientIP`. Pekko's `extractClientIP` requires `X-Forwarded-For` /
   `X-Real-Ip` / `Remote-Address` or the remote-address attribute; I confirmed
   none of those are enabled or handled anywhere in `backend/src`. As written, an
   unauthenticated request with no such header (including every route-testkit
   request in task 3.3) would produce a rejection from a directive wrapping the
   entire `/api` tree. Design must specify optional extraction with a defined
   fallback key, and state which header the deployed Cloud Run path actually
   supplies.

4. **Second DB round-trip per request is unacknowledged.** D3's "resolve
   independently" means the directive calls `findValidSession` /
   `findPrincipalByTokenHash` itself, and then `confineScopedToken` and
   `authenticate` resolve the same credential again downstream — 2 session lookups
   per cookie request, 3 token lookups per PAT request, on every `/api` call. A
   directive whose purpose is protecting backend capacity must not silently raise
   per-request DB load; CLAUDE.md also mandates optimizing hot paths by default.
   Add a decision that either (a) accepts this with explicit rationale and a
   measured/bounded justification, or (b) resolves once and shares the result
   downstream (e.g. stash the resolved principal/token id in a request attribute
   that `AuthDirectives` reads, or provide the key from a directive the auth
   directives consume). Also state whether the extra lookup happens for requests
   that are about to be rejected anyway.

5. **Insertion point is ambiguous w.r.t. `requireCsrfHeader`.** design.md D4 says
   "wrapping the existing `pathPrefix("api")` body, ahead of `confineScopedToken`";
   task 4.2 says the same. But the `/api` body's outermost directive today is
   `requireCsrfHeader`, so "the body" and "ahead of `confineScopedToken`" name two
   different slots. Pin one: state whether rate limiting runs **outside**
   `requireCsrfHeader` (so CSRF-rejected floods are also counted — likely what you
   want) or between it and `confineScopedToken`, and say why.

### Non-blocking notes

- D5 defers the typed-vs-`RawHeader` `Retry-After` choice to implementation time.
  Acceptable (trivially checkable), but nothing specifies the `ErrorResponse`
  message string; pick one so the test asserts a fixed body.
- Tasks 2.1 does not say which file/package `RateLimitConfig` lives in, unlike
  task 1.1 which names `com.helio.services.ratelimit`. Name it.
- No plan to reflect the new 429 response in `schemas/`/OpenAPI. If those documents
  enumerate per-endpoint responses, a 429 now applies to every `/api` route; worth
  a deliberate "not updating, because…" line rather than silence.
- Unbounded map growth (design Risks) is accepted with no ceiling. Consider noting
  that an IP-keyed entry is attacker-creatable, which makes it a memory-growth
  vector distinct from the user-keyed case.
