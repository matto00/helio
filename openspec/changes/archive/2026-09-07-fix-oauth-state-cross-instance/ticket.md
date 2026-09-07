# HEL-1019: Google login fails in production: OAuth CSRF state is stored in process memory across 2 Cloud Run instances

## Description

Google sign-in is unreliable-to-broken in production. This is a live production incident (Urgent). The owner is locked out of their primary login method; password login and PAT auth are unaffected and remain a working fallback.

`object AuthService` holds the OAuth CSRF state in a JVM-wide in-process `ConcurrentHashMap` (`AuthService.scala:295`), keyed state -> expiry epochSecond, with `CsrfStateTtlSeconds = 300L`. `generateCsrfState()` puts (`:303`); `validateCsrfState` removes-and-checks (`:309`), which is what makes state single-use today. `OAuthRoutes.scala:115` rejects with `400 "Invalid or missing OAuth state parameter"` when validation fails.

Production runs `--max-instances=2`, `--min-instances=0`. The store is per-process, so:

1. `GET /api/auth/google` generates the state on instance A.
2. The user spends 30-60s on Google's consent screen.
3. The callback arrives at instance B, or at a cold-booted instance because A was reclaimed by scale-to-zero during the wait.
4. `validateCsrfState` finds nothing -> 400.

With two warm instances this is roughly a coin flip; with scale-to-zero during the consent wait it approaches certain.

The rest of the serving path was measured healthy in prod on 2026-09-07 (login page 0.30s, `GET /api/auth/google` 0.37s with a correct 302, `/api/auth/me` 0.10s, `/health` 0.10s, assets ~0.3s). The failure is state loss between two requests, not latency. `min-instances=0` is an aggravating factor tracked separately — a config change is NOT the fix, because the two-instance race survives it.

### Verified refinement beyond the ticket text

The store is in the **companion object**, not the class. The instance methods (`:214`, `:218`) are thin forwarders. Therefore two `new AuthService(...)` instances share one store, and a test that constructs two AuthService instances is a **vacuous false-green** that cannot reproduce this defect. The load-bearing test must establish two genuinely independent state stores.

### The constraint most likely to be missed

The frontend and backend are cross-site: `helioapp.dev` vs `helio-backend-*.run.app`. That is exactly why `COOKIE_SECURE=true` exists (HEL-287) — it marks the session cookie `Secure` and derives `SameSite=None`, because `SameSite=Lax` never attaches a cookie on that cross-site path.

Any double-submit-cookie design inherits that constraint. A state cookie set `SameSite=Lax` will NOT be sent on the callback exchange and reproduces this exact bug through a different mechanism, while passing every local test because dev is same-origin. If a cookie is chosen, its attributes must be verified against the deployed cross-site topology, not localhost, and the verification method must be stated.

### Options (decide deliberately; argue the choice in design.md)

1. **Signed stateless cookie** — state travels in an HttpOnly/Secure cookie, compared to the `state` query parameter on callback. No shared store. Must resolve the SameSite constraint above.
2. **Database-backed state** — a short-lived row keyed by state value. Works across instances, survives scale-to-zero. Costs a table and a migration. No cookie-attribute subtleties. If chosen, its RLS policy is in scope and must be proven with two genuinely distinct pools.
3. **Signed, self-contained HMAC state** — expiry inside the parameter, validation needs no lookup. No storage, no cookie; needs a signing key and careful replay handling. Smallest surface, but shifts the security argument onto replay.

## Acceptance Criteria

- [ ] An OAuth round trip succeeds when initiation and callback are served by different processes — proven by test, not by reasoning. A test that cannot distinguish two independent stores does not cover this defect.
- [ ] An invalid, expired, or replayed state is still rejected with the existing `400`. CSRF protection must not be weakened to fix availability — a forged/tampered state must fail.
- [ ] If a cookie is used: its attributes are correct for the cross-site production topology, verified against `COOKIE_SECURE=true` behaviour, not localhost, and the verification is stated.
- [ ] Mutation-proven, red arm confirmed reachable first: reintroduce the per-process store (or drop the new mechanism) and show the cross-process test goes red. Confirm the failure isolates to the intended step.
- [ ] The 5-minute TTL (`CsrfStateTtlSeconds = 300L`) is preserved, or its change is deliberate and recorded with the reason.
- [ ] Replay is addressed explicitly: either state remains single-use, or design.md states why single-use is not required.
- [ ] No state value, authorization code, or token is ever logged.
- [ ] Assert content, not just status codes.
