## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `2c1ab0326fe6c171152bc59ff2918f433558296f`. The change dir is untracked (planning only, no code yet).
I read ticket.md, proposal.md, all four spec deltas, design.md, tasks.md, workflow-state.md and skeptic-design-1.md.
I checked each round-1 item against the repo source and installed node_modules myself.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/static-marketing-landing-page/HEL-1562`.
- **`openspec validate static-marketing-landing-page --strict`:** returned `Change 'static-marketing-landing-page' is valid`.
  The MODIFIED requirement headers exist verbatim in the base specs: `App routes wrapped with ProtectedRoute`,
  `Login page`, `Registration page`, `Web app manifest`, `App-shell precache with auto-update`, and the others.
- **Constraints:** tasks.md `## Standing Constraints` C1–C9 mirror workflow-state CONSTRAINTS, with C6 marked retired.
  The owner rulings appear in D5 (C1), D7 (C4, C5, C7, C8, C9) and D8 (C2, C3).
  The mockup has `example data.` (lines 156/204/319), the news sources line (255), `.ask` (170) and `.tier` (221–223).

#### Round-1 change requests

- **CR1 (denylist with a query string): CLOSED.**
  - `workbox-routing/NavigationRoute.js` `_match` tests `url.pathname + url.search`.
  - `generateURLVariations.js` strips only `utm_*`/`fbclid` and then appends `directoryIndex`.
  - I ran the D9 patterns in node: `/` → denied, `/?ref=x` → denied, `/index.html?x` → denied, `/home` → allowed,
    `/home?x=/` → allowed.
  - D9 now states the real mechanism: a bare `/` hits the precache, and a query string falls through to the network.
    The delta now says the precache covers "the landing and app-shell HTML" and adds a `/?ref=x` scenario.
  - Task 3.2 now has the unit cases, and 3.9 has the old-SW → new-SW run on `/` and `/?ref=x`.
- **CR2 (axios in the landing graph): CLOSED.**
  - The CSRF constant moves to a dependency-free `src/services/csrfHeader.ts` (task 1.6a). D5 forbids importing
    `httpClient.ts`.
  - `env.ts` imports nothing.
  - D10 asserts that no chunk reachable from the landing page contains axios or React. Its selftest has an
    "axios in a landing chunk" red fixture.
- **CR3 (Vite Accept predicate): CLOSED.**
  - D2 now gates on Accept missing, empty, `text/html` or `*/*`.
  - It excludes `/api/`, `/health` (the only two proxy keys in `vite.config.ts:62-64`), `/@`, `/src/`, `/node_modules/`
    and any path with a file extension.
  - Task 3.1 covers `*/*` and a missing Accept header.
- **CR4 (D3 completeness probe): CLOSED.**
  - The new probe `grep -rnE '"/"' frontend/src … | grep -v '\.test\.'` returns 61 hits today. That includes every
    form round 1 named: `LoginPage.tsx:56`, `OAuthCallbackPage.tsx:43`, `sections.ts:159`, `resourceNavigation.ts:69`,
    `navGlyph("/")`, and the review-page `navigate("/")` calls.
  - I separately grepped `'/'` and `` `/` `` in non-comment code and found zero app-home sites outside the probe.
  - It is noisy (comment text like `"loading"/"failed"`), but the per-hit allowlist with a reason handles that.
- **CR5 (substitution guard): CLOSED.**
  - D10 asserts the built `index.html` has no `%…%` placeholder and does contain the number parsed from
    `planNumbers.ts`. The selftest has a "placeholder left in" red fixture.
  - D6's regex matches `UserTierConfig.scala:23` (`val DefaultBetaDailyMessageLimit: Int = 50`).
- **CR6 (e2e fan-out): CLOSED.**
  - D11 names all three route tables and states that cookie/API-login specs never set the hint.
  - I ran the probe: 94 hits, which are the `goto/waitForURL("/")` sites plus `hel666:49`,
    `focus-presence-guard:130,193` and `state-surface-contrast-guard:525`.
  - Forms it does not catch: the `"/$"` regex at `state-surface-contrast-guard:866` (inside a named table, so dead
    after the move) and `auth-cookie-migration.spec.ts:73` `toBe("/")` (a cookie path, not caught and not app home).
    Neither weakens the signal.
- **CR7 (re-runnable pipeline): CLOSED.** D8 covers each round-1 point:
  - (a) It builds helio-mcp repo-relatively. `helio-mcp/package.json` has `build: tsc`, and a lockfile exists.
  - (b) Ids are passed in memory.
  - (c) The session is created in-process, with no cookie jar.
  - (d) The user is deleted by exact id via `userCleanupCore.cjs`.
  - (e) Teardown runs in a `finally`.
  - The bundle scripts confirm the old dependencies that D8 replaces: hard-coded `localhost:8080`, `HELIO_PAT` from
    env, absolute `${MCP}/dist/index.js`, and `.cj-demo` in `shoot-usecases.mjs:10`.
  - `/api/tokens` is not tier-gated (`ApiTokenRoutes.scala`), so a fresh free account can mint the PAT.
- **CR8 (no-cache on rewritten paths): CLOSED.**
  - D2 uses a `regex` header rule `^[^.]*$`, which matches request paths `/`, `/home`, `/dashboards/x` and not
    `/assets/x.js`.
  - D10 asserts those four cases.
  - The current `firebase.json` has only `/index.html` no-cache and `/assets/**` immutable, which confirms the gap was
    real.

#### New checks

- **Auth choke point (D4):** every `status =` write in `authSlice.ts` (lines 172–259) is `authenticated`,
  `unauthenticated` or `loading`. The 401 interceptor dispatches `auth/clearAuth` (`httpClient.ts:40`). The listener
  design holds.
- **Backend redirects to `/`:** none. `OAuthRoutes.scala` redirects only to Google. The `redirect_uri` is the
  backend, and the frontend `/auth/callback` route is unchanged.
- **No CSP** anywhere in `frontend/` or `firebase.json`, so the D4 inline head script is not blocked.
- **CD:** `cd-frontend.yml` runs `npm --prefix frontend run build` (`vite build`) and deploys `dist` with
  `firebase.json`, so a two-entry build ships as designed. There is no post-deploy smoke check that assumes `/` is
  the app.
- **Living specs that define `/` as app home, outside the three modified capabilities (DEFECT, see CR1 below).**
  `grep -rnE '`/`' openspec/specs` found these, each restating behaviour that D3 explicitly changes:
  - `google-oauth-callback-page/spec.md:18,25`: OAuthCallbackPage "navigates to `/`" (D3 retargets
    `OAuthCallbackPage.tsx:43`).
  - `mfa-login-verification-ui/spec.md:28,38`: "on success the user SHALL be redirected to `/`" (D3 retargets
    `MfaVerifyPage`).
  - `oauth-error-display/spec.md:20`: "they are redirected to `/`".
  - `pipeline-proposal-review-ui/spec.md:108`: "navigates to `/` with the created dashboard selected" (D3 retargets
    the review-page CTAs).
  - `frontend-pipelines-page/spec.md:44`: "Breadcrumb shows Dashboards on /".
  - `mobile-dashboard-sheet/spec.md:14,166`: the title "on `/`".
  - `mobile-bottom-nav/spec.md:12`: the destinations list `/`.
  - `frontend-data-sources-page/spec.md:7`: "The existing `/` route continues to render the dashboard panel view".

  No delta and no task covers these. Task 2.10 names only README docs. After archive, the living specs would
  contradict the shipped code in eight capabilities. Round 1 did not catch this.

### Verdict: REFUTE

All eight round-1 change requests are genuinely closed, and I re-derived each from source rather than from the
artifacts' claims. One new defect blocks: the change alters the app-home contract in eight capabilities but plans
deltas for only three. This is a small artifact edit, not a redesign.

### Change Requests

1. **Add spec deltas for every capability whose requirements name `/` as app home, and make that enumeration
   probe-backed.**
   - Add `## MODIFIED Requirements` deltas under `specs/` for the requirements at the sites listed above:
     - `google-oauth-callback-page` "OAuthCallbackPage exchanges code with backend"
     - `mfa-login-verification-ui` "Verification step after password login"
     - `oauth-error-display` "Login page reads error query parameter"
     - `pipeline-proposal-review-ui` (the requirement containing line 108)
     - `frontend-pipelines-page` (the breadcrumb requirement, line 44)
     - `mobile-dashboard-sheet` "Tappable command-bar title on phone" (plus the requirement at line 166)
     - `mobile-bottom-nav` "Bottom tab bar provides section navigation on phone"
     - `frontend-data-sources-page` (line 7)
   - In each delta, `/` → `/home` where it means app home.
   - Add a task for this, and record a zero-hit probe as its acceptance signal, for example
     `grep -rnE '(navigat|redirect|route|on|destinations?)[^.]{0,40}`/`' openspec/specs` reviewed against the deltas,
     with any surviving hit allowlisted with a reason.
   - If the planner judges a capability's text already obsolete (for example `mobile-bottom-nav` still lists
     `/registry`/`/metrics`), say so explicitly in design.md rather than silently skipping it.

### Non-blocking notes

- D7's line "No stored theme: landing follows the system scheme." reads ambiguously next to D4 and the spec
  ("stored Helio theme when present, otherwise system"). It should be reworded to "With no stored theme, …".
  - The app's own default when unset is `dark` (`theme.ts:69`), so a never-toggled user can see a light landing page
    and then a dark app. That is acceptable per the spec.
  - The inline script should accept only `"dark"`/`"light"` (`isTheme`).
- `userCleanupCore.cjs` refuses any email outside `example.test`/`example.com`. D8's throwaway account must use one of
  those domains, or teardown throws.
- `^[^.]*$` leaves a dotted, non-file deep link (none exist today, since ids are UUIDs) rewritten to `app.html`
  without no-cache. Acceptable.
- `globPatterns` excludes `jpg`, so the captures are not precached. That is good; do not add `jpg`.
- The D3 probe also matches prose in comments (`"a"/"b"`). The allowlist may group those as "comment text" rather
  than justify each one.
