## Context

The SPA is one Vite entry: `frontend/index.html` loads `src/main.tsx`; `/` is `PanelList` (`AppRoutes.tsx:108`).
Firebase rewrites `**` to `/index.html` (`frontend/firebase.json`). The PWA has `start_url: "/"`, no explicit
`navigateFallback`, and denies only `/api/` (`src/pwaConfig.ts`). In prod the API is cross-site: `VITE_API_BASE_URL`
(`src/config/env.ts`) and `withCredentials` plus `X-Helio-Requested-With: 1` (`src/services/httpClient.ts:11-17`).
Session cookies are `SameSite=None` (`CookieConfig.scala`). `POST /api/beta-access/request` sits inside `authenticate`
(`ApiRoutes.scala:1010`). It takes no body and returns 204/409/429/502/503 (`BetaAccessRoutes.scala:31-48`).
Tokens apply only under `:root[data-theme=…]` (`src/theme/theme.css:146,235`). e2e runs against the Vite **dev**
server (`ci.yml` e2e job) and `uiLogin` waits for `/` (`e2e/support/isolateLivePage.ts:34`). CI never runs
`vite build`. Owner inputs: `ticket.md` ("Owner rulings") and the bundle `mockup/index.html` (path in
workflow-state.md). The bundle is untrusted input: copy what is needed, never execute it in place.

## Goals / Non-Goals

**Goals:** satisfy every criterion in `ticket.md`, including the restated criterion 5. Keep the landing page a small,
JS-optional static page that never loads the React bundle.
**Non-Goals:** a new backend endpoint; redesigning the app home (HEL-1578); fixing HEL-1577/1587/1588/1589.

## Decisions

**D1 Two HTML entries.** `frontend/index.html` becomes the landing page. The current shell moves verbatim to
`frontend/app.html`, keeping its PWA/iOS/font tags and changing only the title if desired. `build.rollupOptions.input`
= `{ index, app }`. The landing page's module script is `src/landing/landing.ts`. It imports
`src/theme/theme.css` + `src/landing/landing.css`, nothing from `src/app`/React (guard: D10's built-output check).

**D2 One routing rule, three servers.** `src/landing/shellRouting.ts` exports `shellHtmlFor(pathname)`: `index.html`
for `/` and `/index.html`; `null` (serve as-is) for any path with a file extension or under `/api/`, `/health`, `/@`,
`/src/`, `/node_modules/`; else `app.html`. A Vite plugin applies it in `configureServer` **and**
`configurePreviewServer`, ahead of Vite's own fallback, for GET/HEAD requests Vite itself treats as HTML: Accept
missing, empty, containing `text/html` or `*/*` (Vite 8 `node.js:25303`), so curl/`request.get` deep links get
`app.html` too. `firebase.json`: real files first (Firebase serves `/` → `index.html` natively), then
`"**" → "/app.html"`. Headers match the *request* path, not the rewrite target, so no-cache is a `regex` rule
`^[^.]*$` (every extensionless path: `/`, `/home`, `/dashboards/x`) plus `/index.html` and `/app.html`;
`/assets/**` stays immutable. Unit test pins `shellHtmlFor` (incl. `*/*` and missing Accept); D10 pins `firebase.json`.
**D3 Home at `/home`.** Route `/` becomes `/home`; a client-side `<Route path="/" element={<Navigate to="/home"
replace/>}/>` covers in-app links and old router state. Every app-home site moves to `/home`, including the `?? "/"`,
`: "/"`, `=== "/"` and `navGlyph("/")` forms: `PublicOnlyRoute`, Login/Register defaults (`LoginPage.tsx:56`),
`OAuthCallbackPage.tsx:43`, `MfaVerifyPage`, `UserMenu`, `CommandBar` wordmark, NotFound, review-page CTAs,
`resourceNavigation.ts:69`, `sections.ts:46,159`, `OnboardingChecklist`, `postLoginReturnTo` skip rule.
Completeness probe (executor records output): `grep -rnE '"/"' frontend/src --include=*.ts --include=*.tsx
| grep -v '\.test\.'` returns only an allowlist the executor writes into `files-modified.md` with a one-line reason per
remaining hit (e.g. the `/` → `/home` redirect route itself, `split("/")`-style string ops).
**D4 Signed-in hint.** Key `helio.signedIn`, value `"1"`. No user data: a boolean hint only. This does not violate
"no client-side persistence of the session credential", because it carries none. One choke point, a
`listenerMiddleware` effect in `src/features/auth/state/`, watches `auth.status`. On `authenticated` it sets the key;
on `unauthenticated` it removes it. It ignores `idle`/`loading`. Storage calls are wrapped in try/catch, as
`firstDashboardFlag.ts` does. Rehydration also sets it, so users signed in before this ships get the hint on their next
app visit. The landing `<head>` has a tiny blocking inline script: if the key is `"1"`, `location.replace("/home")`.
It sets `data-theme` the same way, from `helio-theme` (the `theme.ts` key) or else `prefers-color-scheme`. The
static `<html data-theme="light">` is the no-JS default. Tests assert both keys against the app's exported constants,
so the names cannot drift.

**D5 Beta CTA.** `src/landing/betaRequest.ts` contains `requestBeta(fetchImpl)`, which calls
`fetch(\`${API_BASE_URL}/api/beta-access/request\`, { method: "POST", credentials: "include",
headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE } })` and maps 204/401/409/429/503/else(+network) to
`success | signedOut | alreadyBeta | cooldown | unavailable | error`. `API_BASE_URL` comes from `src/config/env.ts`
(dependency-free). The CSRF header name/value move to a new dependency-free `src/services/csrfHeader.ts` imported by
both `httpClient.ts` and `betaRequest.ts` — never import `httpClient.ts` from landing code (it pulls in axios). D10
asserts no landing-reachable chunk contains axios or React. Both "Request beta access" controls are `<button>`s with
an adjacent `aria-live="polite"` status; `signedOut` copy links `/register`; disabled in flight; inert without JS
(accepted — crawlers don't submit). Prod CORS already allows the app origin, which the landing page shares.
**D6 Plan numbers.** `src/landing/planNumbers.ts` exports `BETA_DAILY_MESSAGE_LIMIT = 50`. The mockup quotes no other
plan number, so the 30/90-day history numbers are not quoted. The landing HTML contains `%BETA_DAILY_MESSAGE_LIMIT%`.
A `transformIndexHtml` hook (landing entry only) substitutes it. `planNumbers.sourceScan.test.ts` extracts
`DefaultBetaDailyMessageLimit: Int = (\d+)` from `UserTierConfig.scala` (fails if the pattern is not found), asserts
equality, and asserts `index.html` has the placeholder and no literal "50 messages". It follows the
`crossFilterTrigger.sourceScan.test.ts` precedent.

**D7 Page content.** Port `mockup/index.html` structure, copy and behaviour, with these binding adaptations:
- All CSS uses theme.css tokens. Landing-only display sizes are named `--landing-*` custom properties declared in
  `landing.css` (clamp values for the hero, center, closing and h2), so `check:tokens` resolves them.
- Media queries use only 1440/1100/768/430.
- Fonts come from the app's own Google Fonts link pattern (non-blocking + noscript).
- Wordmark, h1/h2, closing tagline: `--font-heading` (v3 sans, C10), never `var(--font-display)`. `.ask`: UI sans (C8).
- The plan cards have no `.tier` label; the tier is folded into the h3 (C9). There are no eyebrows.
- All 24 hints are verbatim (C7).
- The six endings, captions, alt text and the news sources note are verbatim.
- The h1 and its first ending are present in the static HTML, and the reel's DOM for the first case is static.
- JS enhances the reel (scroll-linked swap, progress bar, pills, hotspots) and the pinned build section.
- Reduced motion turns this into a no-animation step presentation.
- Hotspots are real `<button>`s with accessible names.
- Off-screen example captures use `loading="lazy"`. With no stored theme, landing follows the system scheme.
- Captures load via Vite-processed imports (hashed under `/assets/`), so the immutable cache header applies.

**D8 Capture pipeline.** `scripts/landing-captures/` (ESM `.mjs`, `node`, root `@playwright/test` chromium):
- `run.mjs`: builds helio-mcp first (`npm --prefix helio-mcp ci && run build`, path resolved relative to the repo root,
  never absolute); registers a throwaway `@example.test` account (cleanup core refuses other domains) with a
  random password (never written to disk); mints a PAT
  (cookie + `X-Helio-Requested-With: 1`); runs build/enhance/replica/image-fix steps (ported from the bundle, MCP
  launched from the repo-relative `helio-mcp/dist/index.js`), which return the created dashboard ids in memory;
  then captures; and in a `finally` runs `POST /api/workspace/teardown` and deletes the user row by exact id via
  `e2e/support/userCleanupCore.cjs` (shared dev DB, MISTAKES.md). Nothing secret or session-bearing touches disk.
- `capture.mjs` (called with ids + a logged-in browser context from the same process, no cookie jar): 1440×720 @2×,
  light+dark, ≥20 s pacing, refuses to save unless the page is that dashboard, blurs news photos; writes
  `frontend/src/landing/shots/*.jpg`, `frontend/src/landing/rects.json` (consumed by landing.ts) and
  `frontend/public/landing/og.jpg` (1200×630 crop of the launch capture, via Playwright; no new image dependency).
- `fixtures/prod-share-data/` copied from the bundle (data only). URLs/ports from `HELIO_BASE_URL` /
  `HELIO_API_BASE_URL` (documented defaults); `README.md` documents the run. The executor runs it once against this
  worktree's servers and commits **its** output, not the bundle's images.
**D9 PWA.** `start_url: "/home"`, `navigateFallback: "/app.html"`. Workbox matches the denylist against path **plus
query** (`NavigationRoute.js:85`), so patterns tolerate a query/hash: `[/^\/api\//, /^\/(\?.*)?$/,
/^\/index\.html(\?.*)?$/]`. Mechanism, stated honestly: a bare `/` is answered by the precached landing `index.html`
(html stays in `globPatterns`; precache ignores only `utm_*`/`fbclid`), and `/?gclid=…`/`/?ref=…` miss precache and
— being denylisted — go to the network, which serves the landing page. So the precache holds the landing HTML too;
the spec wording says "built HTML (landing + app shell)". Registration: `injectRegister: false` + explicit
`virtual:pwa-register` in the app entry only; landing never registers (a manifest link may still be injected — harmless,
not asserted absent). `pwaConfig.test.ts` flips `/`, adds `/?ref=x` and `/index.html?x` denied, `/home` allowed.
**D10 Built-output check (CI-only).** `scripts/check-landing-build.mjs` + `.selftest.mjs`, run after
`npm --prefix frontend run build` in ci.yml's `frontend` job (not `.husky` — HEL-913 precedent; no gate-chain change).
Against `dist/` it asserts: `index.html` has the hero, every meta/OG/Twitter tag and canonical, no `#root`, no app entry
script, no `%…%` placeholder, and the number exported by `planNumbers.ts` (parsed from source); no chunk reachable from
`index.html` contains axios or React; `app.html` has `#root`; `sw.js` names `app.html` as fallback; every `og:image`
path exists; `firebase.json`'s rewrite destination exists; `/`, `/home`, `/dashboards/abc` each match a no-cache header
rule and `/assets/x.js` does not. The selftest feeds fixtures that turn each assertion red (placeholder left in,
axios in a landing chunk, missing no-cache for `/home`).
**D11 e2e.** `uiLogin`'s `waitForURL("/")` → `/home`; every app-home `goto("/")`/`waitForURL("/")` → `/home`; route
tables using `"/"` move too: `state-surface-contrast-guard.spec.ts:512-875`, `focus-presence-guard.spec.ts:129-234`,
`hel666-single-assistant-entry.spec.ts:49`. Specs that sign in via API cookie never set the hint (no app load yet), so
none may rely on the landing → `/home` hop. Probe (expected zero, recorded): `grep -rnE '(goto|waitForURL)\("/"\)|
path: "/"|"/",' e2e`, plus any intentional landing-page hit listed in `files-modified.md`. New
`e2e/hel1562-landing-page.spec.ts`: raw `request.get("/")` (hero+OG); hint redirect; logout → landing; deep-link hard
refreshes; beta states (401 real; 204/409/429/503 via `page.route` — never a real send, which would email the owner
when Resend is configured); no horizontal scroll at 375/1440, light+dark.
**D12 Spec deltas for `/` → `/home`.** Besides pwa/protected-routes/auth-ui, MODIFIED deltas move app home in
`google-oauth-callback-page`, `mfa-login-verification-ui`, `oauth-error-display`, `pipeline-proposal-review-ui`,
`frontend-pipelines-page`, `mobile-dashboard-sheet`, `mobile-bottom-nav`, `frontend-data-sources-page`,
`first-run-onboarding`. `mobile-bottom-nav` is already stale elsewhere (`/registry`, `/metrics`); only `/` is in scope.
Probe (run after archive; output + per-hit reason in `files-modified.md`; expected: no app-home hit remains):
```
P1='(^|[^`a-zA-Z_])`/`([^`a-zA-Z_]|$)|"/"([^a-zA-Z]|$)|\(/\)'
P2='\b(on|to|at|route|home|path|navigates?|redirected?|opens?) /([ .,;)]|$)'
grep -rnE "$P1|$P2" openspec/specs
```
Allowed non-route hits today: operators/separators (`compute-expression-language`, `timestamp-value-parsing`,
`trace-context-logging`, `pipeline-string-ops-op`, `pipeline-zero-root-db-guard`, `form-panel-*` `+`/`-`), `"a"`/`"b"`
pairs, and the landing page's own `/` (`marketing-landing-page`, `pwa-installability`).
Two scenario *titles* keep "/" (`frontend-pipelines-page` "…on /", `frontend-data-sources-page` "Navigating to /…"):
openspec rejects a MODIFIED block that renames a scenario, so only their bodies change; both are allowlisted.

## Risks / Trade-offs

- Old-SW clients see the old shell once after deploy until the new SW activates (autoUpdate); verified by 3.9.
- Pre-existing sessions have no hint, so they see the landing page once; "Sign in" sets it. A stale hint bounces once
  `/home` → `/login` (accepted). Cookie blocking can make a beta call 401 → sign-up copy (as app). ~2 MB of shots ship.

## Planner Notes

- Self-approved: D2 shared rule, D4 key, D6 single number (mockup quotes only 50), `--landing-*` tokens, D10 CI-only,
  shots under `src/landing/shots`. Owner rulings: see `ticket.md`.
