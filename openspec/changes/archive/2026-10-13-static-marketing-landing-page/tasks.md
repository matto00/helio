## Standing Constraints

- [C1] Beta CTA calls POST /api/beta-access/request with credentials; 401 -> 'create a free account first' + /register link; signed-in shows 204/409/429/503; no validation-error state
- [C2] News photos blurred and the news frame lists its sources
- [C3] Every product image is a real Helio capture from the checked-in script; no hand-drawn dashboard markup
- [C4] RETIRED (superseded by C10; do not apply): Fraunces only for wordmark, headlines and tagline
- [C5] No eyebrows (small labels above headings)
- [C6] RETIRED (superseded by C7; do not apply): each panel-hint prompt describes what that panel actually shows
- [C7] Panel-hint prompts are things Helio can act on today: what the panel shows, or a realistic next step (alert, chart-type switch, comparison). Keep all 24 mockup hints verbatim.
- [C8] The build section's opening quoted prompt is set in the UI sans font, not Fraunces
- [C9] Plan cards have no label above the heading; the tier is folded into the heading text (e.g. 'Free: Helio's API and MCP server')
- [C10] Wordmark, headlines and tagline use `--font-heading` (v3 sans), matching the app; landing CSS reads no `var(--font-display)`; italic style on the tagline ending/closing line is kept
- [C11] Ship the current pre-v3 captures; no recapture in this ticket (driver files the follow-up); the capture pipeline stays

## 1. Frontend: entries, routing, PWA, hosting

- [x] 1.1 Move the app shell `frontend/index.html` to `frontend/app.html` unchanged; set `build.rollupOptions.input` {index, app} (D1)
- [x] 1.2 Add `src/landing/shellRouting.ts` (`shellHtmlFor`) and a Vite plugin applying it in dev + preview servers (D2)
- [x] 1.3 Rewrite `frontend/firebase.json`: `**` -> `/app.html`; no-cache regex `^[^.]*$` + `/index.html` + `/app.html`; `/assets/**` immutable (D2)
- [x] 1.4 PWA: `start_url` `/home`, `navigateFallback` `/app.html`, query-tolerant denylist for `/` and `/index.html`; SW registered from app shell only (D9)
- [x] 1.5 Move app home to `/home`, add the `/` -> `/home` client redirect, and retarget every app-home site listed in D3 (D3 probe + allowlist recorded)
- [x] 1.6a Move the CSRF header name/value to dependency-free `src/services/csrfHeader.ts`; `httpClient.ts` imports it (D5)
- [x] 1.6 Add the `helio.signedIn` hint listener on `auth.status` (set on authenticated, clear on unauthenticated) (D4)

## 2. Frontend: landing page

- [x] 2.1 Copy share-data fixtures from the bundle into `scripts/landing-captures/fixtures/` (data only)
- [x] 2.2 Write the `scripts/landing-captures/` pipeline (helio-mcp build, in-memory ids, in-process login, finally teardown + user delete by id) (D8)
- [x] 2.3 Run the pipeline against this worktree's servers; commit its shots, `rects.json` and `public/landing/og.jpg`
- [x] 2.4 New `frontend/index.html`: static hero/reel first frame, sections, meta/canonical/OG/Twitter, head inline hint+theme script (D4, D7)
- [x] 2.5 `src/landing/landing.css` on theme tokens + `--landing-*` display sizes; canonical breakpoints only; Fraunces scope per C4/C8 (D7)
- [x] 2.6 `src/landing/landing.ts`: reel, progress, pills, hotspots + verbatim hints, build-section pin, reduced motion (D7)
- [x] 2.7 `src/landing/betaRequest.ts` + wiring of both CTAs with live status regions; share the CSRF header constant (D5)
- [x] 2.8 `src/landing/planNumbers.ts` + `transformIndexHtml` placeholder substitution for the landing entry (D6)
- [x] 2.9 Add `scripts/check-landing-build.mjs` + selftest; run it after `vite build` in ci.yml's `frontend` job (CI only) (D10)
- [x] 2.10 Update `pwa-installability`/auth/route docs that name `/` as app home (e.g. `frontend/README.md`, `e2e/README.md`) where present
- [x] 2.11 Run the literal D12 probe over `openspec/specs` (after a local archive dry-run); record output + per-hit reasons in `files-modified.md`

## 3. Tests

- [x] 3.1 `shellRouting.test.ts`: `/`, `/index.html`, deep links, assets, `/api`, `/health`, Vite internals, Accept `*/*`/missing
- [x] 3.2 Update `pwaConfig.test.ts`: `/`, `/?ref=x`, `/index.html?x` denied, `/home` allowed + start_url, fallback `/app.html`
- [x] 3.3 Hint listener tests: set on each authenticated path, cleared on logout/401/failed rehydrate; key matches landing script
- [x] 3.4 `betaRequest.test.ts`: every status mapping + network error + in-flight disable
- [x] 3.5 `planNumbers.sourceScan.test.ts` (D6), with a recorded mutation run proving it goes red
- [x] 3.6 Update unit tests asserting `/` as home (LoginPage, MfaVerify, OAuthCallback, ProtectedRoute, sections, BottomNav, CommandBar, review pages, ...)
- [x] 3.7 e2e: `uiLogin` -> `/home`; retarget app-home `goto`/`waitForURL("/")` across specs and route tables (contrast-guard, focus-presence, hel666); D11 probe recorded
- [x] 3.8 e2e: `hel1562-landing-page.spec.ts` (raw HTML + OG, hint redirect, logout, deep links, beta states (401 real, rest mocked), 375/1440 light+dark no h-scroll)
- [x] 3.9 Evidence: `vite build` + preview -> curl `/` transcript; old-SW (base build) -> new build preview run showing landing at `/` and `/?ref=x`; PWA start_url `/home`
