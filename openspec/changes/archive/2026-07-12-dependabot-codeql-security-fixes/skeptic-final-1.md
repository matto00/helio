## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Cookie attributes (D1) + COOKIE_SECURE deploy wiring**
   - Read `backend/src/main/scala/com/helio/api/CookieConfig.scala`: `HttpOnly=true` always,
     `Path=/`, `Max-Age=AuthService.SessionTtlSeconds` (2592000s), `SameSite=None` iff `secure`,
     else `Lax`; `secure` read once from `COOKIE_SECURE` env var (default `false`).
   - Read `infra/deploy-backend.sh:19`: `COOKIE_SECURE=true` is a genuine new entry inside the
     `^|^`-delimited `--set-env-vars` string passed to `gcloud run deploy`, not a comment.
     `docs/deployment.md` documents the one-time `gcloud run services update
     --update-env-vars=COOKIE_SECURE=true` backfill for the case where `cd-backend.yml` (which sets
     no env vars) reaches prod first. `CLAUDE.md`'s env-var table and
     `infra/.env.deploy.example` both cross-reference this correctly.
   - Live curl against the running dev backend (port 8367, `COOKIE_SECURE` unset):
     `POST /api/auth/register` → `Set-Cookie: helio_session=...; Max-Age=2592000; Path=/; HttpOnly;
     SameSite=Lax` (no `Secure`, correct for dev), response body has no `token` field.
   - `CookieConfigSpec` (5 tests) and `AuthDirectivesSpec`/`ApiTokenAuthSpec` re-run fresh — 31
     tests pass (see below).

2. **CSRF directive (D4)** — read `AuthDirectives.requireCsrfHeader` (checks non-GET + cookie
   presence + `X-Helio-Requested-With: 1`, PAT-only requests exempt) and `ApiRoutes.scala:132`
   (applied once, ahead of the public/authenticated split, so it covers logout uniformly).
   Live-verified: `POST /api/auth/logout` with a valid cookie and no CSRF header → `403 {"message":
   "Missing required CSRF header"}`; same request with the header → `204`, `Set-Cookie:
   helio_session=; Max-Age=0`. Confirmed pekko-http-cors's `CorsSettings.defaultSettings` uses
   `HttpHeaderRange.*` for `allowedHeaders` (read `/tmp/pekko-cors-src/.../CorsSettings.scala`), so
   the custom header survives preflight — the CSRF mechanism is actually reachable, not just
   theoretically present.

3. **Hard cutover (D2)** — read `AuthDirectives.resolveIdentity`: cookie present → session lookup
   only; cookie absent + `Authorization: Bearer <t>` → `resolveApiToken` only accepts
   `helio_pat_`-prefixed tokens, anything else (including a raw former-session token) resolves to
   `None` → 401. Re-ran `AuthDirectivesSpec` fresh (12/12 pass), including tests named exactly for
   this: "should reject a raw session token sent via the Authorization header (hard cutover, design.md
   D2)", "should resolve a PAT bearer token via the Authorization header unchanged", "should prefer
   the session cookie over a simultaneously-present PAT header".

4. **Frontend session-storage removal** — read `httpClient.ts` (`withCredentials: true`, default
   `X-Helio-Requested-With: 1` header, no `setAuthToken`), `authSlice.ts` (no `sessionStorage`
   references; `rehydrateAuth` now calls `GET /api/auth/me` unconditionally), `usePipelineRunEvents.ts`
   (`fetch(..., { credentials: "include" })`, no `sessionStorage.getItem`/manual `Authorization`
   header). `AuthResponse` type (`user.ts`) has no `token` field.

5. **Fresh sweep for missed consumers** — `grep -rn "sessionStorage|helio_auth_token|setAuthToken"`
   across `frontend/src` (excluding tests): zero live hits (only comments/regression-test
   assertions that it must be empty). Repo-wide sweep (excluding `node_modules`) found only e2e/unit
   test files asserting `sessionStorage` stays empty, plus `helio-mcp/` which uses PAT bearer auth
   (an unrelated, unaffected credential type, confirmed by `helio-mcp/src/httpClient.ts` /
   `config.ts` grep).

6. **Git hygiene** — `git log e04d5006..HEAD`: exactly 2 commits (`e18976b8` main migration,
   `d1ad7b69` deploy-wiring fix), both `HEL-287`-prefixed. `git status`: only the orchestrator's own
   `workflow-state.md`/`evaluation-2.md` bookkeeping uncommitted (not code drift). `git diff --stat`
   is scoped to auth/cookie/CSRF backend+frontend code, dependency manifests, the regex-escape fix,
   deploy/docs, and change-management artifacts — no unrelated files.

7. **Dependency bumps + regex fix** — `npm audit` (root and `frontend/`) both report **0
   vulnerabilities**. Resolved versions checked directly in both lockfiles: `@babel/core@7.29.7`
   (root+frontend, > 7.29.6 floor), `js-yaml@3.15.0`/`4.3.0` (root), `3.15.0` (frontend) — both above
   the `3.15.0`/`4.2.0` alert floors; `echarts@6.1.0` (frontend). Read
   `scripts/check-scala-quality.mjs:51-55`: `escapeRegExp` now escapes the full
   `[.*+?^${}()|[\]\\]` metacharacter class, not just `.` — correct fix for CodeQL #7. Ran
   `node scripts/check-scala-quality.mjs` fresh — clean, exit 0, same 42 pre-existing soft warnings.

8. **Live verification via dev servers (ports 5460/8367)**
   - Backend/frontend health checks 200/200.
   - `POST /api/auth/register` via curl: cookie set with correct dev attributes, no `token` in body
     (see #1).
   - CSRF reject/accept round-trip via curl (see #2).
   - MCP-browser live session against the real running app: navigated to `/`, was transparently
     authenticated by a persisted `helio_session` cookie from earlier testing; `document.cookie`
     evaluated to `""` (the cookie is genuinely invisible to JS — proves `HttpOnly` in practice, not
     just in the header) while `sessionStorage` was empty; clicked through the real "Sign out" UI
     flow → network tab showed `POST /api/auth/logout → 204` (CSRF header auto-attached by the
     shared `httpClient` instance, no manual wiring) → redirected to `/login`; reloading `/`
     afterward redirected to `/login` again, confirming the cookie was actually cleared server-side,
     not just client-state. Zero app-level console errors (the two "Failed to load resource: 401" log
     lines are the browser's own network-layer logging of the expected unauthenticated `GET
     /api/auth/me` probe, not a thrown exception — same behavior existed pre-migration).
   - The packaged `e2e/auth-cookie-migration.spec.ts` Playwright suite could not execute via the CLI
     in this sandbox (pinned `chromium_headless_shell` revision 1193 has no downloadable build for
     this OS — `npx playwright install` instead resolves a fallback revision the pinned
     `playwright-core@1.55.1` doesn't look for). This is the identical, previously-documented
     environmental gap noted in `evaluation-1.md`'s Phase 3 section, not a new finding. I worked
     around it the same way the evaluator did — via the separately-cached MCP Playwright browser
     against the live app, per items 3/4 above — rather than trusting the suite's file contents as a
     substitute for execution.
   - Full test suites re-run fresh, not trusted from either report: `npm test` (frontend) → 84/84
     suites, 922/922 tests; `sbt test` (backend) → 72/72 suites, 1308/1308 tests; `npm run lint`
     (frontend) → clean; `npm run build` (frontend) → succeeds. All match the evaluator's claimed
     numbers exactly.

### Acceptance criteria traced
- echarts ≥6.1.0: `frontend/package.json`/lockfile → `6.1.0`. ✓
- @babel/core ≥7.29.6 (root+frontend): resolved `7.29.7` both places via `overrides`. ✓
- CodeQL #8 mitigation, all 3 call sites: `authSlice.ts` no longer touches `sessionStorage`/token at
  login, register, or OAuth callback (all three flow through the same cookie-issuing backend
  routes and the same frontend `AuthResponse` shape with no `token`). ✓
- `check-scala-quality.mjs` escapes all metacharacters, script still passes. ✓ (verified above)
- No UI-affecting files touched beyond `authSlice.ts`/`httpClient.ts`/`usePipelineRunEvents.ts`
  (non-visual service/state files) — DESIGN.md judgment is correctly N/A for this change, matching
  the evaluator's Phase 3 assessment.

### Verdict: CONFIRM

### Non-blocking notes
- The pinned Playwright browser revision (1193) is not downloadable on this sandbox's OS; this
  predates and is unrelated to HEL-287, but if CI hits the same gap it's worth a follow-up ticket to
  pin a revision with a working fallback, or document the MCP-browser workaround for local dev.
