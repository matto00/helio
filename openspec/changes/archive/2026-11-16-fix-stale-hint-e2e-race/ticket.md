# HEL-1623: e2e flakes: hel1562 stale-hint fails when the font stylesheet is intercepted; hel813 Connectors one-off at 768px

## Description

origin_kind: followup
origin_ticket: HEL-1613

Two low-value flakes HEL-1613 recorded but did not fix:

1. **hel1562 stale-hint test:** it fails when the font stylesheet route is intercepted (as a font-delay probe does). The spec likely depends on font-dependent geometry or timing. Find what it actually waits on, and make it independent of stylesheet timing.
2. **hel813 Connectors at 768px:** it failed once and is still unexplained. HEL-1613 refuted font-swap: box heights never change, only widths move by about 1.6px, and a re-probe passed 68/68 in sans and mono. Collect the CI trace if it recurs; close this part if it doesn't recur within a release.

Evidence: `.concertino/runs/HEL-1613/evidence/` (probes.md, probe-813-*, v8-probe813-*).

## Driver context (2026-11-17, claims verified at Setup where noted)

- Now urgent: `e2e/hel1562-landing-page.spec.ts:81` "a stale hint bounces once through /home to /login and clears itself" is red on main CI (runs 43993159078 at 0c699d263, 43991455792, 43973417369), timing out in `page.waitForURL("/login")` at :85. Every observed main failure is after the axios 1.20.0 -> 1.21.1 bump (154528a95, #1114). Verified at Setup.
- Driver hypothesis (unverified; to be proven by a forced repro): the test boots the app at `/login`, then sets the hint, then navigates to `/`. The booting `/login` app's `GET /api/auth/me` returns 401, `auth.status` becomes `unauthenticated`, and `registerSignedInHintListener` (`frontend/src/features/auth/state/signedInHint.ts`) removes `helio.signedIn`. When that removal lands after the test's `setItem` and before `frontend/index.html`'s inline head script reads the key, `/` renders the landing page and never bounces. axios 1.21's async XSRF cookie read delays the XHR into that window.
- hel813 item: no hel813 failure in any failed main CI run since 2026-10-16 (27 runs scanned; releases v0.9.7..v0.9.11 since). Verified at Setup.

## Acceptance Criteria

1. hel1562 stale-hint test no longer depends on the booting app or on stylesheet timing: the stale hint is seeded with no Helio app code running in the page.
2. Red first: a deterministic forced repro of the race (e.g. holding `/api/auth/me` so the hint clear lands after the seed) fails the UNMODIFIED test; the same forced condition passes the fixed test.
3. The fixed test also passes with the font stylesheet route held (the ticket's original trigger).
4. The fixed test passes 40/40 with `--repeat-each=40` on axios 1.21.1 (current main), Playwright workers <= 2.
5. Green in CI.
6. No product code change. If a real user-facing defect is found in the hint listener, escalate it as a product call instead of changing it.
7. hel813 item: closed with no code per the ticket's own rule (did not recur within a release); the CI-history evidence is recorded.
