## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `2c1ab0326fe6c171152bc59ff2918f433558296f`. The change dir is untracked (planning only, no code yet).
Installed versions checked in `frontend/node_modules`: vite 8.0.16, vite-plugin-pwa 1.3.0, workbox-build and workbox-precaching 7.4.1.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/static-marketing-landing-page/HEL-1562`.
- **Ticket and owner rulings vs. artifacts:** C1–C9 in tasks.md match workflow-state CONSTRAINTS. C6 is marked retired. The four
  owner rulings (beta CTA with credentials and 401→/register, 24 hints verbatim, `.ask` in the UI sans, tier folded into
  h3) are all reflected in D5/D7 and the spec deltas.
- **Mockup facts (bundle read only, nothing executed):** `mockup/index.html` has 6 cases × 4 hints = 24 (lines 244–261).
  `.tier` labels are at lines 221–223. Its media queries are 700/760/800/900, which D7 correctly says to remap.
  The only plan number quoted is "50 messages a day" (line 222). The "30 days"/"90-day" strings are hint and alt text,
  not plan numbers, so D6's single-number scope is right.
- **D6 can fail:** `UserTierConfig.scala:23` is literally `val DefaultBetaDailyMessageLimit: Int = 50`. The planned
  regex matches it, and the precedent `crossFilterTrigger.sourceScan.test.ts` exists. Vite 8's `htmlEnvHook`
  (`vite/dist/node/chunks/node.js:22769-22794`) leaves an unknown non-`VITE_` `%X%` placeholder untouched, so a
  custom transform is needed and does not collide. **Gap:** nothing checks that the built HTML actually got the
  number substituted. See CR5.
- **D4 choke point:** every `auth.status` write in `authSlice.ts` goes through `authenticated`/`unauthenticated`/`loading`.
  That covers login, register, OAuth, MFA, `setAuth`/`clearAuth` from rehydrate, and the 401 interceptor dispatching
  `auth/clearAuth` (`httpClient.ts:41`). A status-transition listener on the existing `listenerMiddleware`
  (`store/listenerMiddleware.ts`, prepended in `store.ts:66`) covers all of them. Sound.
- **D5 cross-site:** the backend checks `X-Helio-Requested-With` (`AuthDirectives.scala`). CORS allowed origins come from
  `CORS_ALLOWED_ORIGINS` (`Main.scala:232`). The landing page runs on the same origin as the app, and the app already
  makes credentialed cross-site POSTs with this header, so preflight, CORS and the SameSite=None cookie behave the same.
  Status mapping matches `BetaAccessRoutes.scala:31-48`: 204/409/429/502/503, with 502 falling into the generic error.
  **Defect:** see CR2 about where the header constant lives.
- **D9 / workbox semantics (read from source):**
  - `NavigationRoute._match` tests `url.pathname + url.search` against the denylist (`workbox-routing/NavigationRoute.js:85-87`).
  - Precache lookup uses `directoryIndex = 'index.html'` and strips only `utm_*`/`fbclid` params
    (`workbox-precaching/utils/generateURLVariations.js:20-28`).
  - `globPatterns` includes `html` (`vite.config.ts`), so the new SW precaches the landing `index.html`, and a bare
    `/` is answered by the **precache route**, not the denylist.
  - `node -e '/^\/$/.test("/?ref=hn")'` → `false`. See CR1.
- **D2 / Vite dev and preview fallback:** Vite 8's `viteHtmlFallbackMiddleware` (`node.js:25303`) treats a request as
  HTML when Accept is **missing, empty, contains `text/html` or contains `*/*`**, and its SPA fallback rewrites to
  `/index.html`, which becomes the landing page. D2's middleware only fires for requests that "accept `text/html`".
  See CR3.
- **D9 registration:** with `injectRegister: "auto"` and no import-register, vite-plugin-pwa injects
  `registerSW.js` into **every** HTML entry (`vite-plugin-pwa/dist/index.js:387-392`, `253-254`). D9's
  `injectRegister: false` plus an explicit app-shell register is the correct fix. The manifest `<link>` is still
  injected into every entry, including the landing page. That is harmless, but D10 should not assert its absence.
- **D3 enumeration:** the planned zero-hit grep returned 29 hits in my run. It **misses** real app-home sites that
  D3's prose names but the probe cannot see:
  - `LoginPage.tsx:56` (`: "/",`)
  - `RegisterPage.tsx:77` (`: "/"`)
  - `OAuthCallbackPage.tsx:43` (`?? "/"`)
  - `sections.ts:159` (`pathname === "/"`)
  - `resourceNavigation.ts:69` (`!== "/"`)
  - `postLoginReturnTo.ts:23` (`!== "/"`)
  - `OnboardingChecklist.tsx:41` (`navGlyph("/")`)

  See CR4.
- **D11 e2e fan-out:** there are 90 `goto("/")`/`waitForURL("/")` sites across e2e, including `uiLogin` at
  `support/isolateLivePage.ts:34` and 8 in `auth-cookie-migration.spec.ts`. There are also route-key tables that use `"/"`
  as app home: `focus-presence-guard.spec.ts:129-234`, `hel666-single-assistant-entry.spec.ts:49`, and
  `state-surface-contrast-guard.spec.ts:512-875` (including a `/$` URL regex at 866). Only the last one is named in D11.
  Specs that log in through the API cookie never run the app, so the hint is never set: a leftover `goto("/")` will
  land on the landing page, not be rescued by the hint redirect. See CR6.
- **D8 re-runnability, against the bundle scripts (read only):**
  - Every build script imports the MCP SDK from, and spawns, `/home/matt/Development/helio/helio-mcp/dist/index.js`
    (an absolute main-checkout path).
  - `dist/` is gitignored (`helio-mcp/.gitignore:2`) and **does not exist in this worktree** (`ls helio-mcp/dist`
    → No such file).
  - `shoot-usecases.mjs` hardcodes the launch dashboard id `2734f7ca-…` and reads a curl cookie jar `.cj-demo` from disk.
  - D8 says nothing about how helio-mcp is built or located, or how the capture step gets its session.
  - Teardown: `POST /api/workspace/teardown` takes `{tag, dryRun}` (`WorkspaceProtocol.scala:11`). It deletes
    resources, **not the throwaway user**. The repo already has an exact-id user-deletion helper
    (`e2e/support/userCleanup.ts` and `userCleanupCore.cjs`, HEL-1301).

  See CR7.
- **D8 credential and PII hazards:**
  - `prod-share-data/` holds no email addresses and no `ownerId`/`userId` fields.
  - No `helio_pat_`, `sk-ant-` or bcrypt strings appear in the fixtures or scripts (grep, zero hits).
  - The `check:no-credential-leak` fixture surface is `backend/src/test/resources`, so `scripts/landing-captures/fixtures` is not
    scanned. The data is clean, so that is not a blocker.
- **Firebase headers:** `firebase.json` matches header `source` globs against the **request** path. D10 asserts
  no-cache rules for `/`, `/index.html` and `/app.html`. But the app shell is now served almost only through the `**`
  rewrite (`/home`, `/dashboards/:id`, …), and those request paths match none of those rules. The spec says
  "The app shell HTML … SHALL be served with Cache-Control: no-cache". See CR8.
- **D7 vs DESIGN.md:**
  - Breakpoints 1440/1100/768/430 match DESIGN.md §4.
  - Fraunces scope matches §Typography and the owner rulings. Mono `.call` tool-name chips are code, not
    uppercase eyebrows, so they are acceptable.
  - Accent defaults exist in theme.css (`:193`, `:273`), so the landing page renders the accent without
    ThemeProvider.
  - `--landing-*` display sizes declared in landing.css resolve under `check:tokens`, which scans `frontend/src` CSS
    for declarations.
  - Sound.
- **e2e beta 503 "real":** locally `backend/.env` has `HELIO_OWNER_EMAILS` and no `RESEND_*` key (checked by key name
  only). `BetaAccessService.requestAccess` returns 503 before any send (`:44-48`), so the real 503 is stable here
  and in CI. See the non-blocking note.
- **AC traceability:**
  - AC1 → 2.4 / 3.8 / 3.9 / D10
  - AC2 → 1.6 / 2.4 / 3.8
  - AC3 → 1.2 / 1.3 / 3.1 / 3.8
  - AC4 → 1.4 / 3.2 / 3.9, blocked on CR1
  - AC5 → 2.7 / 3.4 / 3.8
  - AC6 → 2.5 / 3.8
  - AC7 → 2.8 / 3.5, gap CR5
  - AC8 → 2.2 / 2.3, blocked on CR7

### Verdict: REFUTE

The architecture is sound. I found no placeholders, and the owner rulings are carried through faithfully. Five of the
specific checks I was asked to make found defects or unverifiable signals in the plan as written (CR1–CR4, CR7), and
three more gaps would let a broken result pass its own acceptance signal (CR5, CR6, CR8). All are artifact edits, not
re-architecture.

### Change Requests

1. **D9 / pwa-installability delta: the `/` exclusion breaks with any query string, and the stated mechanism is
   wrong.**
   - Workbox matches `navigateFallbackDenylist` against `pathname + search` (`NavigationRoute.js:85`), and
     `/^\/$/.test("/?ref=hn") === false`.
   - The precache route matches `/` only after stripping `utm_*`/`fbclid`. So `/?ref=…`, `/?gclid=…` or `/?source=…`
     (a typical marketing link) falls through to the navigation fallback and is answered with `app.html` in every
     SW-controlled browser.
   - The app then client-redirects `/` → `/home` → `/login`, and the crawler/link-preview visitor never sees the landing page.
   - Revise D9 to:
     - use query-tolerant patterns, e.g. `/^\/(\?.*)?$/` and `/^\/index\.html(\?.*)?$/`;
     - state the actual mechanism. A bare `/` is served by the **precache route** (directoryIndex → precached
       landing `index.html`, because `globPatterns` includes html). The denylist covers only the query-string case.
       Alternatively, deliberately `globIgnores` the landing HTML and say so.
   - Reconcile the delta's "precache manifest SHALL cover only built app-shell assets" with the landing page being
     precached.
   - Add to 3.2 a unit assertion that the denylist matches `/?ref=x`. Add to 3.9's evidence an SW-controlled
     navigation to `/?ref=x` showing the landing page.
2. **D5: do not import the CSRF header constant from `src/services/httpClient.ts`.** That module does
   `import axios` and runs a top-level `axios.create(...)` (`httpClient.ts:1,11`), which Rollup must keep.
   Importing from it puts axios (and the interceptor code) into the landing page's chunk graph. That contradicts
   "the landing page never loads the app's JS" (D1 / spec), and D10's "no app entry script" check would not catch it.
   - Put the constant in a leaf module (e.g. `src/config/csrf.ts`, next to `env.ts`) imported by both files.
   - Extend D10 to assert that no JS chunk reachable from `dist/index.html` contains axios, React or
     `react-router` code. Any concrete, failable marker check works.
3. **D2: mirror Vite's HTML-request test exactly.** Vite 8's fallback (`node.js:25303`) treats a request as HTML when
   Accept is absent, empty, contains `text/html`, **or contains `*/*`**, and then rewrites to `/index.html`, which is
   now the landing page.
   - With D2's "accepts `text/html`" gate, `curl /dashboards/x` or Playwright `request.get("/home")` (both `*/*`) get
     the **landing page** from the dev and preview servers. That contradicts the spec's "identically for the
     production hosting config, the dev server and the preview server".
   - Use the same Accept predicate as Vite.
   - Add a 3.1 or 3.8 case that a `*/*` request for a deep link returns `app.html` (contains `#root`).
4. **D3: the zero-hit probe is not a completeness signal.** The specified grep cannot see `?? "/"`, `: "/"`,
   `pathname === "/"`, `!== "/"` or `navGlyph("/")`, and 7 named app-home sites use those forms (list above). A green
   probe would therefore certify an incomplete migration. `sections.ts:159` and `resourceNavigation.ts:69` would
   silently break active-section highlighting and the "already home" check rather than bounce through the redirect.
   - Replace it with a probe over every `"/"` string literal in `frontend/src` non-test code, e.g.
     `grep -rnE "['\"\`]/['\"\`]" frontend/src --include=*.ts --include=*.tsx | grep -v '\.test\.'`.
   - Pair it with an explicit allowlist of the legitimate non-home survivors, e.g. `pwaConfig.ts` `scope: "/"`,
     `ImagePanel.tsx:36`, the `split("/")` calls and the `renderWithStore` default.
   - Zero un-allowlisted hits is the acceptance signal.
5. **D6/D10: guard the build-time substitution, not only the source.** 3.5 proves the constant matches the backend and
   that the source HTML has the placeholder. Nothing fails if the `transformIndexHtml` hook doesn't run (wrong entry
   filter, wrong `order`), in which case the page ships the literal text `%BETA_DAILY_MESSAGE_LIMIT%`.
   - Add to D10: `dist/index.html` contains no `%BETA_DAILY_MESSAGE_LIMIT%` and does contain
     `${BETA_DAILY_MESSAGE_LIMIT} messages`, with the value read from `planNumbers.ts`, not retyped.
   - The selftest should include an unsubstituted fixture that goes red.
6. **D11: make the e2e fan-out enumerable and name every route table.**
   - Name `focus-presence-guard.spec.ts` (RouteKey `"/"`, `:129-234`), `hel666-single-assistant-entry.spec.ts:49` and
     `state-surface-contrast-guard.spec.ts:512-875`, including the `"/$"` regex at `:866`.
   - Give a probe and its expected result. For example:
     `grep -rnE "(goto|waitForURL|toHaveURL)\(\s*[\"'\`]/[\"'\`]" e2e` → 0 hits, plus a grep of `"/"` route-key
     literals with an allowlist (e.g. `auth-cookie-migration.spec.ts:73`'s cookie `path` is not app home).
   - State explicitly that cookie/API-login specs never set `helio.signedIn`, so no app-home `goto("/")` may rely on
     the hint redirect.
7. **D8: specify a pipeline that is actually re-runnable from a fresh worktree.** As written, D8 inherits the
   bundle's dependencies without saying how they are met. Every bundle build script spawns
   `/home/matt/Development/helio/helio-mcp/dist/index.js` and imports the MCP SDK from that absolute path. `dist/` is
   gitignored and absent in this worktree (memory: the session's helio-mcp dist is routinely stale).
   `shoot-usecases.mjs` also hardcodes dashboard id `2734f7ca-…` and reads a curl cookie jar from disk. D8 must state:
   - (a) helio-mcp and its SDK are resolved **repo-relatively** and **built fresh** as a run.mjs preflight
     (`npm --prefix helio-mcp run build`). The alternative is to state that the REST API is used instead, which
     conflicts with the ticket's "built through helio-mcp" and so needs the owner.
   - (b) Dashboard ids flow from the build step to the capture step in memory or via a non-secret ids file. No
     hardcoded ids.
   - (c) The capture step gets its session in-process (Playwright `request.post('/api/auth/login')` storage state).
     Never a cookie jar on disk.
   - (d) Teardown also deletes the throwaway **user** by exact id, e.g. reusing `e2e/support/userCleanupCore.cjs`'s
     builder / `db.cjs`, because `POST /api/workspace/teardown` (`{tag, dryRun}`) removes resources but leaves a user
     row and PAT per run in the shared dev DB (MISTAKES.md "Every worktree shares one Postgres database").
   - (e) Teardown runs in a `finally`, so a failed capture (the refuse-to-save path) still cleans up.
8. **D2/D10: no-cache must cover the request paths the app shell is actually served at.** Firebase matches header
   `source` globs against the request path, not the rewrite destination. A `/app.html` rule therefore does not apply
   to `/home` or `/dashboards/:id`, the paths where the app shell is now almost always served. Those get Firebase's
   default caching, which contradicts the delta's "app shell HTML … SHALL be served with Cache-Control: no-cache" and
   risks a stale shell pointing at deleted hashed assets after a deploy.
   - Revise 1.3/D10 to add a rule over extensionless request paths (e.g. `"source": "**/!(*.*)"`, or an equivalent
     that Firebase's glob/extglob syntax supports), cited from Firebase docs.
   - D10 should assert that a representative rewritten path (`/home`, `/dashboards/x`) matches a no-cache rule and
     does not match the immutable `/assets/**` rule.

### Non-blocking notes

- Transitional cohort: users signed in before deploy, or whose old SW served them the old shell, have no hint, so
  their first visit to `/` shows the landing page. One "Sign in" click goes through PublicOnlyRoute to `/home` and sets
  the hint. This is acceptable per the ticket's hint design. Worth one line in Risks.
- The landing page falls back to `prefers-color-scheme` when `helio-theme` is unset, while the app falls back to `dark`
  (`theme.ts:69`). A never-toggled user can therefore see a light landing page and then a dark app. This is consistent
  with the spec, but consider matching the app's default. The inline script must accept only `"dark"|"light"`
  (`isTheme`).
- e2e "real 503" depends on the backend having no Resend key. If a developer sets `RESEND_API_KEY` locally, that test
  would send a real owner email on every run. Consider a precondition skip or a `page.route` 503 alongside a real 401
  seam check.
- vite-plugin-pwa will still inject `<link rel="manifest">` into the landing HTML. That is harmless, but D10 must not
  assert its absence.
- Lazy-load the five off-screen reel cases' captures. Twelve 2880×1440 JPEGs loaded eagerly would cost the landing
  page's first load.
