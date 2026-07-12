## Dependency bumps (closes Dependabot #52, #50, #47, #53, #54, #55)

- `package.json` — root `overrides`: `@babel/core` (`^7.29.6`, blanket), `js-yaml` nested under
  `@eslint/eslintrc` (`^4.2.0`) and `@istanbuljs/load-nyc-config` (`^3.15.0`); `@playwright/test`
  devDependency + `e2e` script added for the live verification suite (section 7)
- `package-lock.json` — regenerated for the above
- `frontend/package.json` — `echarts` bumped to `^6.1.0`; `overrides` extended with `@babel/core`
  (`^7.29.6`) and `js-yaml` nested under `@istanbuljs/load-nyc-config` (`^3.15.0`)
- `frontend/package-lock.json` — regenerated for the above

## CodeQL #7 — regex-escape fix

- `scripts/check-scala-quality.mjs` — proper regex-metacharacter escape (all of
  `. * + ? ^ $ { } ( ) | [ ] \`), not just `.`

## httpOnly-cookie session migration — Backend (closes CodeQL #8)

- `backend/src/main/scala/com/helio/api/CookieConfig.scala` (new) — `CookieConfig` (secure →
  derived `SameSite`) + `SessionCookies` (issue/expire `HttpCookie` builders)
- `backend/src/main/scala/com/helio/api/AuthDirectives.scala` — `resolveIdentity` reads the
  `helio_session` cookie first (session lookup), falls back to `Authorization` header restricted to
  `helio_pat_`-prefixed tokens only (hard cutover); new `requireCsrfHeader` directive
- `backend/src/main/scala/com/helio/api/protocols/AuthProtocol.scala` — `AuthResponse` drops `token`
  (`jsonFormat3` → `jsonFormat2`)
- `backend/src/main/scala/com/helio/api/routes/AuthRoutes.scala` — register/login set the session
  cookie via `setCookie`; new `logoutRoute` (cookie-derived identity via `authenticate`, expires the
  cookie)
- `backend/src/main/scala/com/helio/api/routes/OAuthRoutes.scala` — OAuth-callback success sets the
  session cookie instead of echoing the token in the body
- `backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala` — new `runWith` helper (lets a
  success path attach `setCookie` around the completed response)
- `backend/src/main/scala/com/helio/app/Main.scala` — reads `COOKIE_SECURE`, builds `CookieConfig`,
  passes it into `ApiRoutes`
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `authDirectives.requireCsrfHeader`
  around the whole `/api` tree; moves `logout` into the authenticated route tree
- `backend/src/main/scala/com/helio/services/AuthService.scala` — new `AuthResult(token, response)`
  carrier so the route layer gets the raw token (for the cookie) without widening the wire-facing
  `AuthResponse`

## httpOnly-cookie session migration — Frontend

- `frontend/src/services/httpClient.ts` — `withCredentials: true` + default
  `X-Helio-Requested-With: 1` header; removed `setAuthToken`
- `frontend/src/features/auth/state/authSlice.ts` — `AuthState` drops `token`; `rehydrateAuth` calls
  `GET /api/auth/me` unconditionally and dispatches `setAuth`/`clearAuth`; `logout` no longer reads a
  token from state
- `frontend/src/features/auth/services/authService.ts` — `logoutRequest()` takes no token/header
- `frontend/src/features/auth/types/user.ts` — `AuthResponse` drops `token`
- `frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts` — SSE `fetch()` uses
  `credentials: "include"` instead of a manual `Authorization` header read from `sessionStorage`
  (design.md D7)

## Backend tests

- `backend/src/main/scala/com/helio/api/AuthDirectivesSpec.scala` (new) — session-cookie
  resolution, header hard-cutover, PAT-unchanged, CSRF directive coverage (5.2, 5.3)
- `backend/src/main/scala/com/helio/api/CookieConfigSpec.scala` (new) — exact `Set-Cookie` attribute
  strings for both dev (`secure=false`) and prod (`secure=true`) shapes
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — shared `routes()`/`otherUserRoutes()`
  helper switched from `Authorization` header injection to cookie + CSRF header injection;
  register/login/logout/`auth/me` blocks updated for the new wire shape and cookie mechanics; new
  `Set-Cookie` attribute assertion test
- `backend/src/test/scala/com/helio/api/ApiTokenAuthSpec.scala` — session bootstrap calls
  (register/login/logout-adjacent dashboard/token creation) switched to cookie + CSRF header; PAT
  calls unchanged
- `backend/src/test/scala/com/helio/api/ComputedFieldsRoutesSpec.scala`,
  `DashboardApplyProposalSpec.scala`, `DataSourceRoutesSpec.scala`,
  `routes/DashboardPanelAclSpec.scala`, `UploadRoutesSpec.scala` — same shared-helper mechanical
  switch (header → cookie + CSRF)
- `backend/src/test/scala/com/helio/api/GoogleOAuthRoutesSpec.scala` — asserts `Set-Cookie` presence
  instead of `AuthResponse.token`
- `backend/src/test/scala/com/helio/api/protocols/AggregatorRegressionSpec.scala` — `AuthResponse`
  round-trip fixture drops `token`

## Frontend tests

- `frontend/src/features/auth/state/authSlice.test.ts` — rewritten for the new state shape and
  cookie-based rehydrate/logout flow
- `frontend/src/features/auth/ui/{LoginPage,OAuthCallbackPage}.test.tsx` — drop the
  `setAuthToken`/httpClient mock (no longer imported by authSlice)
- `frontend/src/features/auth/ui/ProtectedRoute.test.tsx`,
  `frontend/src/features/panels/ui/PanelList.test.tsx`, `frontend/src/test/renderWithStore.tsx` —
  drop the now-nonexistent `token` field from `AuthState` test fixtures
- `frontend/src/app/App.test.tsx` — `rehydrateAuth` now fires unconditionally on every mount;
  `getMeRequestMock` rejected for the "unauthenticated" fixture test instead of gating on
  sessionStorage
- `frontend/src/features/pipelines/hooks/usePipelineRunEvents.test.ts` — asserts
  `credentials: "include"` instead of a sessionStorage-sourced `Authorization` header
- `frontend/src/services/httpClient.test.ts` — new coverage for `withCredentials` + default CSRF
  header

## Live verification (Playwright)

- `playwright.config.ts` (new)
- `e2e/auth-cookie-migration.spec.ts` (new) — 8 tests against real dev servers: register, login,
  OAuth callback (network-intercepted), authenticated GET via cookie, CSRF 403/201, logout clears
  cookie + subsequent 401, PAT bearer auth unchanged, pipeline run-events SSE auth
- `jest.config.cjs` — excludes `/e2e/` from Jest's test discovery (Playwright-only directory)

## Misc

- `.gitignore` — `playwright-report/`, `test-results/`

## Cycle 2 — prod deploy wiring for `COOKIE_SECURE` (evaluation-1.md Change Request 1)

- `infra/deploy-backend.sh` — hardcodes `COOKIE_SECURE=true` in the `--set-env-vars` list (not
  sourced from `.env.deploy`); comment explains why it's fixed rather than operator-configurable
- `infra/.env.deploy.example` — comment documenting that `COOKIE_SECURE` is intentionally absent
  from operator-supplied vars because the script hardcodes it
- `CLAUDE.md` — new `COOKIE_SECURE` row in the "Production environment variables" table
- `docs/deployment.md` — new section documenting the required one-time
  `gcloud run services update --update-env-vars=COOKIE_SECURE=true` backfill for the case where the
  live Cloud Run service's first HEL-287 deploy reaches prod via `cd-backend.yml` alone (which sets
  no env vars) before an `infra/deploy-backend.sh` run has set the variable
- `openspec/changes/dependabot-codeql-security-fixes/design.md` — Migration Plan closes the
  deploy-wiring gap, cross-references `tasks.md` section 9
- `openspec/changes/dependabot-codeql-security-fixes/tasks.md` — new section 9 (9.1-9.4) covering
  the above
- `openspec/changes/dependabot-codeql-security-fixes/evaluation-1.md` — evaluator's cycle-1 report,
  now tracked for the record
