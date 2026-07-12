## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS (with one operational-completeness note carried to Phase 2)

- [x] All ticket acceptance criteria addressed explicitly: echarts `^6.1.0`; `@babel/core`/`js-yaml`
  overrides in both `package.json`s (verified via `npm audit` = 0 vulnerabilities in both
  root and `frontend/`); CodeQL #7 regex-escape fixed and `check:scala-quality` still passes;
  CodeQL #8 gets the full httpOnly-cookie migration (Option 3, per the explicit user decision) across
  all three call sites (register/login/OAuth).
- [x] No AC silently reinterpreted — the scope-update section's decisions (D1-D7) are followed
  precisely by the shipped code (verified directly against source, see Phase 2).
- [x] All `tasks.md` items (1.1-8.5) marked done and match what was actually implemented — spot-checked
  the non-obvious ones (1.2 brace-expansion revert, 4.5/4.6 SSE hook fix, 7.1-7.8 Playwright coverage)
  against source and all check out.
- [x] No scope creep — diff is confined to the dependency bumps, the regex-escape fix, and the auth/cookie
  migration + its test fallout. `.gitignore` additions (`playwright-report/`, `test-results/`) are
  directly required by the new Playwright suite.
- [x] No regressions to existing behavior: full backend suite (1308 tests) and full frontend suite (922
  tests) pass fresh (re-run by me, not trusting the executor's report — see Phase 2).
- [x] API contracts: `AuthResponse` schema/protocol changes flow through `check:schemas` (still passes:
  "10 checked across 18 protocol files"); the five spec deltas (`csrf-protection`,
  `email-password-auth`, `frontend-auth-state`, `google-oauth-login`, `request-authentication`) match
  the shipped cookie name (`helio_session`), CSRF header (`X-Helio-Requested-With: 1`), and response
  shape (`{ expiresAt, user }`) exactly — verified by grep against the actual spec files and source.
- [ ] **Migration Plan completeness gap** (carried forward as a Phase 2 finding, not re-listed here):
  design.md's Migration Plan says "Deploy backend + frontend together" but neither `design.md`,
  `tasks.md`, nor the shipped diff touches the actual production deploy wiring (`infra/deploy-backend.sh`,
  `infra/.env.deploy.example`) to activate `COOKIE_SECURE=true` for prod. See Phase 2 for the concrete
  consequence.

### Phase 2: Code Review — FAIL

Fresh verification performed (not just re-running the executor's claims):

- `node scripts/check-scala-quality.mjs` — passes, exit 0 (42 soft file-size warnings only, same as
  before the regex-escape fix, confirming no new hard errors).
- `npm audit` (root and `frontend/`) — 0 vulnerabilities in both, confirming the dependency-bump ACs.
- `npm run lint` (root + `frontend/`), `npm run format:check` (root + `frontend/`), `npm run check:schemas`
  — all clean.
- `npm test` (`frontend/`) — 84 suites / 922 tests, all pass.
- `sbt test` (`backend/`) — 72 suites / 1308 tests, all pass.
- `frontend/npm run build` — succeeds.
- Read `AuthDirectives.scala`, `CookieConfig.scala`, `AuthRoutes.scala`, `OAuthRoutes.scala`,
  `ApiRoutes.scala`, `AuthProtocol.scala`, `AuthService.scala`, `ServiceResponse.scala`, `Main.scala`
  in full and confirmed, directly against source (not just tests): the cookie attribute set
  (`HttpOnly`; `Path=/`; `Max-Age=2592000`; `SameSite` derived from `secure`, never independently set;
  `Secure` only when `COOKIE_SECURE=true`) exactly matches design.md D1; the CSRF directive
  (`requireCsrfHeader`) requires `X-Helio-Requested-With: 1` on non-`GET` requests only when the
  session cookie is present, and is bypassed for PAT-only requests, exactly matching D4; the hard
  cutover in `AuthDirectives.resolveIdentity`/`resolveApiToken` accepts a raw (non-`helio_pat_`-prefixed)
  token via `Authorization` **nowhere** — `resolveApiToken` returns `None` for any non-PAT-prefixed
  token, and there is no other code path that reads a bearer token as a session credential — exactly
  matching D2, with no accidental raw-session-token-via-header path left open.
- Live-verified all of the above against the actual running dev servers (not just unit tests), since the
  packaged Playwright suite could not be executed in this sandbox (see Phase 3): register via curl shows
  `Set-Cookie: helio_session=...; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax` (dev shape, matches
  `CookieConfigSpec`'s prod/dev assertions exactly); a mutating fetch with `credentials:"include"` and no
  CSRF header gets `403 {"message":"Missing required CSRF header"}`, with the header gets `201`; a
  freshly-minted PAT (`helio_pat_...`) authenticates a `GET` (`200`) and a mutating `POST` with **no**
  CSRF header (`201`, confirming the PAT exemption) via `curl` with no cookie at all; a raw
  non-PAT-prefixed bearer token is rejected (`401`), confirming the hard cutover live.
- `usePipelineRunEvents.ts` (D7): confirmed the `sessionStorage.getItem("helio_auth_token")` read and
  manual `Authorization` header are gone; `fetch()` now passes `credentials: "include"` only. Matches
  design.md D7 precisely.
- `brace-expansion` override: confirmed genuinely reverted, not half-applied. `git diff main...HEAD --
  package.json frontend/package.json` shows only the required `@babel/core`/`js-yaml` overrides in both
  files — no `brace-expansion` entry in either `overrides` block. `npm audit` independently confirms 0
  vulnerabilities for `brace-expansion` in both lockfiles without any override, consistent with the
  executor's claim in tasks.md 1.2.

**Blocking issue found (not previously flagged by either skeptic-design round, and not covered by any
task in tasks.md):**

`CookieConfig.fromEnv()` defaults `secure = false` whenever `COOKIE_SECURE` is unset
(`backend/src/main/scala/com/helio/api/CookieConfig.scala:21`). The actual production deploy path is:

- `infra/deploy-backend.sh:14` — the operator-facing script that configures the Cloud Run service's env
  vars via `--set-env-vars`. It sets `DATABASE_URL`, `DB_USER`, `GOOGLE_REDIRECT_URI`,
  `CORS_ALLOWED_ORIGINS` — **`COOKIE_SECURE` is absent from this list.**
- `.github/workflows/cd-backend.yml` — the actual automated CD pipeline that runs on push to
  `release/**`. It calls `google-github-actions/deploy-cloudrun@v2` with only `service`/`region`/`image`
  — it does **not** set any env vars at all, meaning it relies entirely on whatever was last configured
  on the Cloud Run service (i.e., whatever `infra/deploy-backend.sh` or a manual `gcloud` command set).
- `infra/.env.deploy.example`, `infra/README.md`, `docs/deployment.md`, and the "Production environment
  variables" table in `CLAUDE.md` — none mention `COOKIE_SECURE`.

Net effect: if this change is deployed via the existing, unmodified deploy path, `COOKIE_SECURE` will be
unset on the Cloud Run service, so `CookieConfig.fromEnv()` will silently produce `secure=false` →
`SameSite=Lax` in the genuinely cross-site production topology that design.md D1 itself identifies as
fatal for this exact scenario: *"`SameSite=Lax` would prevent the cookie from ever being set or sent on
the cross-site XHR calls this app makes in production ... login would appear to succeed but the cookie
would silently never attach, breaking every subsequent request."* This is not a hypothetical — I
independently traced both the manual script and the automated CD workflow and confirmed neither sets or
has ever set this variable. Shipping this change as-is would silently break all browser-session
authentication in production (registration/login "succeed" per the 200/201 response, but every
subsequent authenticated request 401s) — a production regression directly contradicting the ticket's
own explicit requirement that `Secure`/`SameSite` be "chosen via config (environment-conditioned, not
hardcoded)" for exactly this purpose. Neither `design.md`'s Migration Plan nor `tasks.md` names this
deploy-wiring step, so this is a genuine planning gap, not just an execution slip — but it must be
closed before this change is safe to merge and deploy.

DRY / readability / modularity / type safety / error handling / dead code / over-engineering: no issues
found. `ServiceResponse.runWith` is a clean, minimal addition; `CookieConfig`/`SessionCookies` centralize
the attribute set in one place as intended; no inline FQNs introduced (spot-checked new files against
`CONTRIBUTING.md`'s Imports & Qualifiers rule, and `check:scala-quality` — which mechanically enforces
this — passes clean).

### Phase 3: UI Review — PASS (via substitute live verification; packaged e2e suite environmentally blocked)

The packaged `@playwright/test` suite (`e2e/auth-cookie-migration.spec.ts`) could not be executed in
this sandbox: `npx playwright install chromium` could not download the required `chromium_headless_shell`
binary (network to `cdn.playwright.dev`/`playwright.download.prss.microsoft.com` measured 0 bytes/sec
for this specific asset in this environment) — an environmental constraint, not a code issue. Per the
guardrails, dev-server startup itself was healthy (`scripts/concertino/start-servers.sh` /
`assert-phase.sh servers` both reported servers already healthy and reused), so this is not a `BLOCKER`
for the servers; it only prevented running the packaged test *runner*.

To get fresh, first-party evidence despite this, I drove the already-installed MCP browser tool
(`mcp__playwright__browser_*`, backed by a separately-cached Chrome binary) directly against the running
dev servers (port 5460/8367) and independently re-verified 7 of the 8 scenarios the packaged suite
covers:

- [x] Register via the real UI form: 201, cookie set (confirmed both via curl's `Set-Cookie` header
  inspection and via the browser's `sessionStorage` staying empty), redirected to `/`.
- [x] Session persists across a full page reload with zero JS-side token handling (0 console errors on
  reload, dashboard UI rendered) — proves cookie-only auth works end-to-end, live.
- [x] Authenticated mutating request (create dashboard via the real UI) succeeds (`201`) using
  `httpClient`'s default CSRF header — no manual wiring needed.
- [x] CSRF: a raw `fetch()` with `credentials:"include"` and no `X-Helio-Requested-With` header gets
  `403`; with the header, `201`.
- [x] Logout: `204`, cookie cleared (confirmed by a subsequent `GET /api/dashboards` returning `401` and
  redirect to `/login`).
- [x] PAT bearer auth: minted a real PAT through the authenticated UI session, then used it via `curl`
  with **no cookie at all** — `GET` `200`, mutating `POST` with **no CSRF header** `201` (confirms the
  PAT exemption live), and a non-PAT raw token via `Authorization` rejected `401` (confirms the hard
  cutover live).
- [x] No console errors during the happy-path flows (the two `401`s logged to console during
  unauthenticated `/api/auth/me` probes and at post-logout are expected — they're the interceptor's own
  rehydration/redirect signal, not unhandled exceptions).

Not independently re-verified live (no live-browser equivalent attempted, but confirmed by direct source
read + the existing unit/integration test coverage, which is passing): the OAuth-callback cookie path
(identical `SessionCookies.issue` call site to login/register, which *was* live-verified) and the
pipeline run-events SSE flow (D7's `credentials:"include"` fix confirmed by source read; existing
`usePipelineRunEvents.test.ts` and the packaged Playwright test 7.8 provide the intended coverage, which
this environmental constraint prevented me from re-running directly).

- [x] Breakpoint spot-check (768px) — login/dashboard views render without layout breakage; this change
  has no new UI components/styling, only an auth-mechanism swap, so a full four-breakpoint design pass
  is low-value here and was kept light intentionally.

### Overall: FAIL

### Change Requests

1. **Wire `COOKIE_SECURE=true` into the actual production deploy path**, not just the code's env-var
   read. Concretely:
   - Add `COOKIE_SECURE=true` to `infra/deploy-backend.sh:14`'s `--set-env-vars` list (alongside
     `CORS_ALLOWED_ORIGINS`).
   - Document `COOKIE_SECURE` in `infra/.env.deploy.example` (it's a fixed `true` for prod, not an
     operator-supplied value like the others — a comment noting this suffices) and in the "Production
     environment variables" table in `CLAUDE.md`.
   - Note in `docs/deployment.md` or the PR description that this is a **required one-time (or
     re-applied) `gcloud run services update --set-env-vars COOKIE_SECURE=true` action** if the existing
     Cloud Run revision is updated only via `cd-backend.yml` (which does not set env vars at all and
     relies on whatever was last configured) — otherwise the deploy silently ships with
     `SameSite=Lax`/`Secure=false` in a topology design.md D1 already proved that value cannot function
     in.
   - Add a note to `design.md`'s Migration Plan (or a new task in `tasks.md`) closing this gap so a
     future re-read of the design doesn't miss it again.

### Non-blocking Suggestions

- None beyond what's already folded into the Change Request above — the code, tests, and live-verified
  runtime behavior are otherwise solid and match design.md D1/D2/D4/D7 precisely.
