## 1. Dependency bumps (closes Dependabot #52, #50, #47, #53, #54, #55)

### Backend

- [x] 1.1 Add root `package.json` `overrides`: `@babel/core` (`^7.29.6`, blanket), `js-yaml` nested
      under `@eslint/eslintrc` (`^4.2.0`) and under `@istanbuljs/load-nyc-config` (`^3.15.0`)
- [x] 1.2 Attempt scoped `brace-expansion` overrides nested per parent (`eslint-plugin-react`,
      jest's `glob`, `typescript-eslint`) at their first-patched floors; keep only if `npm install`
      resolves cleanly with no forced/major bumps, otherwise revert and note in PR (not a required fix
      — npm-audit-only, no open GitHub alert)
      **Decision: reverted, not needed.** The scoped override triggered an npm-resolver artifact
      (`npm ls` reports `ELSPROBLEMS`/`invalid` on `minimatch`'s nested `brace-expansion`) — but this
      artifact appears identically even with NO brace-expansion override at all, purely from adding
      the required `@babel/core`/`js-yaml` overrides above (confirmed via a clean-repo bisection:
      pristine `main` → `npm ls` exits 0; add only the required overrides → same `ELSPROBLEMS`
      appears). It's an orthogonal npm-resolver quirk, not something the brace-expansion override
      introduces. Functionally harmless (verified `require()`-ing the mismatched nested copy directly
      works identically) and, more importantly, `npm audit` already shows 0 vulnerabilities for
      `brace-expansion` without any explicit override — normal semver resolution (once the lockfile is
      regenerated for the required overrides) already lands on patched versions
      (1.1.16 / 2.1.2 / 5.0.7, all ≥ the fixed floors). No override needed or added.
- [x] 1.3 Run root `npm install`, confirm `package-lock.json` picks up the overridden versions and
      `npm audit` no longer flags `@babel/core`/`js-yaml`

### Frontend

- [x] 1.4 Bump `frontend/package.json` `"echarts"` to `"^6.1.0"`
- [x] 1.5 Extend `frontend/package.json` existing `overrides` block: `@babel/core` (`^7.29.6`),
      `js-yaml` nested under `@istanbuljs/load-nyc-config` (`^3.15.0`)
- [x] 1.6 Run `frontend/npm install`, confirm `frontend/package-lock.json` updates and
      `npm audit` no longer flags `echarts`/`@babel/core`/`js-yaml`

## 2. CodeQL #7 — regex-escape fix

### Backend (tooling script)

- [x] 2.1 In `scripts/check-scala-quality.mjs`, replace the `p.replace(/\./g, "\\.")` line with a
      proper regex-metacharacter escape (escape `. * + ? ^ $ { } ( ) | [ ] \`, not just `.`)
- [x] 2.2 Run `node scripts/check-scala-quality.mjs` against the existing codebase and confirm it
      still passes (no new hard errors introduced by the escape change)

## 3. httpOnly-cookie session migration — Backend (closes CodeQL #8)

- [x] 3.1 Add `COOKIE_SECURE` env var (default `false`); derive `SameSite` from it
      (`None` iff secure, else `Lax`) in a small config object read once at startup
      (`backend/src/main/scala/com/helio/app/Main.scala` + a shared config holder)
- [x] 3.2 `AuthDirectives`: add `resolveSessionCookie` reading the `helio_session` cookie via
      `optionalCookie`, hashing + looking up via `UserSessionRepository` exactly as `resolveBearer`
      does today; keep the `Authorization: Bearer` path but restrict it to `helio_pat_`-prefixed
      tokens only (raw session tokens no longer accepted via header)
- [x] 3.3 `AuthRoutes`/`OAuthRoutes`: on successful login/register/OAuth-callback, set
      `Set-Cookie: helio_session=<token>; HttpOnly; Path=/; Max-Age=2592000; SameSite=<cfg>;
      [Secure]` instead of/alongside minting the response; `AuthResponse` drops the `token` field
      (`AuthProtocol.scala` case class + `jsonFormat`)
- [x] 3.4 `AuthRoutes.logout`: change from manual `Authorization` header parsing to
      `authDirectives.authenticate` (cookie-derived identity), delete the resolved session, and
      respond with an expired `Set-Cookie: helio_session=; Max-Age=0; ...` header + `204`
- [x] 3.5 Add the CSRF directive: require header `X-Helio-Requested-With: 1` on all non-`GET`
      `/api/*` requests whose identity resolved from the session cookie (not PAT); reject with `403`
      if absent
- [x] 3.6 Verify CORS: `corsAllowedOrigins` covers the configured frontend origin in every
      environment; confirm `allowCredentials` stays `true` (pekko-http-cors default, already relied
      upon) and no route ever sets `Access-Control-Allow-Origin: *` alongside credentials
      (unchanged — `ApiRoutes.scala`'s `CorsSettings.defaultSettings.withAllowedOrigins(...)` already
      satisfies this; verified by reading, no code change needed per design.md D5)

## 4. httpOnly-cookie session migration — Frontend

- [x] 4.1 `httpClient.ts`: set `withCredentials: true` on the shared Axios instance and add
      `X-Helio-Requested-With: 1` as a default header; remove `setAuthToken`/manual
      `Authorization`-header plumbing for session auth
- [x] 4.2 `authSlice.ts`: remove `token` from `AuthState`; update `setAuth`/`clearAuth` and all
      `extraReducers` cases (`login`, `register`, `handleOAuthCallback`, `rehydrateAuth`) to stop
      reading/writing `sessionStorage` and stop assigning `state.token`
  - [x] 4.2.1 Remove `SESSION_STORAGE_KEY` sessionStorage read in `rehydrateAuth` — rehydration now
        just calls `GET /api/auth/me` unconditionally (cookie attaches automatically) and dispatches
        `setAuth`/`clearAuth` based on the response
  - [x] 4.2.2 `logout` thunk: drop the `token` read from state and the manual `Authorization` header
        on `logoutRequest`; call it with no token argument
- [x] 4.3 `authService.ts`: `logoutRequest()` drops its `token` parameter and the manual
      `Authorization` header
- [x] 4.4 `types/user.ts`: remove `token` from the `AuthResponse` interface
- [x] 4.5 `features/pipelines/hooks/usePipelineRunEvents.ts` (per design.md D7): delete the
      `sessionStorage.getItem("helio_auth_token")` read and manual `Authorization` header; pass
      `credentials: "include"` on the `fetch()` call instead so the session cookie attaches
- [x] 4.6 Update `usePipelineRunEvents.test.ts` to assert `credentials: "include"` is passed to
      `fetch` instead of asserting an `Authorization` header built from `sessionStorage`

## 5. Tests (backend)

- [x] 5.1 Update/extend `AuthRoutesSpec`/`OAuthRoutesSpec` (or equivalent) for: `Set-Cookie` present
      with correct attributes on login/register/OAuth-callback, `token` absent from JSON body,
      logout requires a valid cookie and clears it
      (covered in `ApiRoutesSpec.scala`'s register/login/logout blocks + new `CookieConfigSpec.scala`
      for the full dev/prod attribute-string assertions, + `GoogleOAuthRoutesSpec.scala` for the
      OAuth-callback body/cookie shape)
- [x] 5.2 Add `AuthDirectivesSpec` coverage: session-cookie resolution succeeds; raw session token via
      `Authorization` header is rejected; PAT bearer auth (`helio_pat_...`) still resolves unchanged
- [x] 5.3 Add CSRF directive coverage: mutating request with cookie + missing header → `403`; with
      header → passes; PAT-authenticated mutating request without the header → passes; `GET` without
      the header → passes
      (5.2 and 5.3 both covered in new `AuthDirectivesSpec.scala`)
- [x] 5.4 `sbt test` full suite green

## 6. Tests (frontend)

- [x] 6.1 Update `authSlice.test.ts` for the new state shape (no `token`), `withCredentials`
      expectations, and removal of `sessionStorage` assertions
- [x] 6.2 Update any component tests relying on `auth.token` or manual `Authorization` header mocking
      (`ProtectedRoute.test.tsx`, `PanelList.test.tsx`, `OAuthCallbackPage.test.tsx`,
      `LoginPage.test.tsx`, `App.test.tsx`, `renderWithStore.tsx` test helper)
- [x] 6.3 `npm test` full suite green (root and `frontend/`)

## 7. Live verification (Playwright, per design.md Migration Plan)

- [x] 7.1 Login: cookie set (`HttpOnly`, correct `SameSite`/`Secure` for dev config), response body
      has no `token`, `sessionStorage` never contains the session token
- [x] 7.2 Register: same checks as login
- [x] 7.3 OAuth callback (mocked/stubbed Google exchange as existing tests do): same checks
- [x] 7.4 An authenticated `GET` (e.g. `/api/dashboards`) succeeds via cookie alone, no manual header
- [x] 7.5 A mutating request (e.g. create panel) succeeds with the CSRF header present
- [x] 7.6 Logout clears the cookie; subsequent authenticated request returns `401`
- [x] 7.7 PAT-based request (existing `helio-mcp` fixture/flow) still authenticates via
      `Authorization: Bearer helio_pat_...` unchanged
- [x] 7.8 Pipeline run-events SSE flow (`usePipelineRunEvents` / `PipelineDetailPage`): with a valid
      session cookie and no `sessionStorage` token, the live-status stream authenticates and streams
      events (dev, via the Vite proxy — same-origin)

      All 8 covered by a new `@playwright/test` suite (`e2e/auth-cookie-migration.spec.ts`,
      `playwright.config.ts`), run live against real `sbt run` + `vite dev` servers
      (`scripts/concertino/start-servers.sh $(pwd) 5460 8367`). 8/8 passed. The pipeline run-events
      check (7.8) verifies auth via a cookie-only GET returning 404 (business logic, not 401 — proving
      the request passed authentication) since standing up a full pipeline execution was out of scope;
      the fetch-level `credentials: "include"` mechanism itself is covered by task 4.5/4.6's unit test.

## 8. Verification gates

- [x] 8.1 `npm run lint` (root + `frontend/`) — zero warnings
- [x] 8.2 `npm run format:check` (root + `frontend/`)
- [x] 8.3 `npm run build` (`frontend/`)
- [x] 8.4 `sbt compile` / full backend build
- [x] 8.5 Re-run `gh api repos/matto00/helio/dependabot/alerts` / `code-scanning/alerts` mentally
      cross-checked against the change (actual GitHub state only updates post-merge) — document in PR
      exactly which alert numbers (#52, #50, #47, #53, #54, #55, #8, #7) each commit/file closes

## 9. Prod deploy wiring for `COOKIE_SECURE` (closes cycle-1 evaluation gap)

- [x] 9.1 Add `COOKIE_SECURE=true` to `infra/deploy-backend.sh`'s `--set-env-vars` list, hardcoded
      (not sourced from `.env.deploy` — this value is fixed by the deploy topology, not
      operator-configurable)
- [x] 9.2 Document `COOKIE_SECURE` in `infra/.env.deploy.example` (note that it's intentionally
      absent from the operator-supplied vars because it's hardcoded in the script) and in the
      "Production environment variables" table in `CLAUDE.md`
- [x] 9.3 Add a `docs/deployment.md` section documenting the required one-time
      `gcloud run services update --update-env-vars=COOKIE_SECURE=true` backfill for the case where
      the live Cloud Run service's first HEL-287 deploy goes through `cd-backend.yml` (which sets no
      env vars) before an `infra/deploy-backend.sh` run has set the variable
- [x] 9.4 Close the gap in `design.md`'s Migration Plan referencing this section
