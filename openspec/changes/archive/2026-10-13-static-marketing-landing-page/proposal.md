## Why

helioapp.dev has no marketing page: `/` is the app's protected home, so a first-time visitor (or a crawler or link
preview) only ever sees a login redirect. The owner wants a landing page on the same domain, built from the approved
"reel" mockup, with every product image a real Helio capture.

## What Changes

- New static landing page as a second Vite HTML entry. It takes `index.html` (served at `/`), with meta/OG/Twitter
  tags, the reel, build section, proof points, plans and closing tagline. It needs no JS to read.
- The app shell moves to `app.html`. **BREAKING (URL):** the app home moves from `/` to `/home`. Every other app
  route is unchanged. In-app "home" links/redirects move to `/home`. The dev/preview servers and `firebase.json`
  rewrite every non-file path except `/` to `app.html`.
- PWA: `start_url` becomes `/home`, the SW navigation fallback is `app.html`, and `/` is excluded from it.
- A non-sensitive "signed in" hint in `localStorage` (set when auth becomes authenticated, cleared when it becomes
  unauthenticated). The landing page redirects to `/home` when the hint is present.
- "Request beta access" on the landing page calls the existing `POST /api/beta-access/request` with credentials.
  It shows success, the signed-out (401) "create a free account first" state, and the 409/429/503 states.
- Quoted plan numbers come from one module, guarded by a test that parses the backend default.
- A checked-in, re-runnable capture pipeline (build demo dashboards, rebuild the owner's two boards, capture light
  and dark, measure panel rectangles, write the OG image) and its output images.

## Capabilities

### New Capabilities
- `marketing-landing-page`: the static landing page, its routing, returning-user redirect, beta CTA, plan-number
  sourcing, and the capture pipeline.

### Modified Capabilities
- `pwa-installability`: `start_url` `/home`, fallback `app.html`, `/` excluded from the fallback.
- `frontend-protected-routes`: home route `/home`, and already-authenticated redirects go to `/home`.
- `frontend-auth-ui`: post-login/register redirects go to `/home`.
- `google-oauth-callback-page`, `mfa-login-verification-ui`, `oauth-error-display`, `pipeline-proposal-review-ui`,
  `frontend-pipelines-page`, `mobile-dashboard-sheet`, `mobile-bottom-nav`, `frontend-data-sources-page`,
  `first-run-onboarding`: app home named `/` becomes `/home` (design D12).

## Non-goals

- No new backend endpoint (no anonymous waitlist). No change to `BetaAccessService`.
- Not redesigning the app home itself (HEL-1578).
- Not fixing HEL-1587/1588/1589/1577. The capture scripts keep their workarounds.

## Impact

- Frontend: `index.html` → `app.html`, new `index.html` + `src/landing/**`, `vite.config.ts`, `pwaConfig.ts`,
  `firebase.json`, routing/auth/chrome files that treat `/` as home, and their tests.
- e2e: `uiLogin` and the specs that navigate to `/` as app home.
- CI: the frontend job builds and checks the two-entry output.
- New `scripts/landing-captures/`.
