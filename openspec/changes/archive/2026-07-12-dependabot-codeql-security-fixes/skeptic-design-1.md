## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **Cross-site prod topology (D1's `SameSite=None` justification)** — CONFIRMED.
   - `frontend/firebase.json` has no `/api/**` rewrite; the only `rewrites` entry is `** -> /index.html`
     (SPA fallback), so Firebase Hosting never proxies to the backend.
   - `frontend/src/config/env.ts`: `API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ""`.
     `.github/workflows/cd-frontend.yml:29` injects `VITE_API_BASE_URL` from a GitHub secret at build
     time — i.e. it's baked in as an absolute Cloud Run origin, not a relative path.
   - `frontend/vite.config.ts` proxies `/api`/`/health` to `localhost:$BACKEND_PORT` — dev-only (Vite
     dev server config, not part of the production build).
   - Conclusion: prod frontend (`helioapp.dev`) and backend (`*.run.app`) are genuinely cross-site with
     no reverse proxy. D1's `SameSite=None` (prod) / `Lax` (dev) deviation from the ticket's suggested
     `Lax` is evidence-backed, not a preference call.

2. **CSRF coherence given `SameSite=None`** — CONFIRMED.
   - Decompiled `pekko-http-cors_2.13-1.1.0` sources/`reference.conf`: defaults are
     `allow-credentials = yes` and `allowed-headers = "*"` (echoes whatever the browser puts in
     `Access-Control-Request-Headers` during preflight). `ApiRoutes.scala:115-117` uses
     `CorsSettings.defaultSettings.withAllowedOrigins(...)` and never overrides `allowedHeaders` or
     `allowCredentials`, and `backend/src/main/resources/application.conf` has no `pekko.http.cors`
     override. So a custom header (`X-Helio-Requested-With`) does trigger a CORS preflight, and an
     unlisted origin is rejected by `corsAllowedOrigins` — D4's mechanism is real, not hand-waved.

3. **PAT carve-out** — CONFIRMED consistent with today's code.
   `AuthDirectives.resolveApiToken` (current `AuthDirectives.scala:38-48`) already gates PAT lookup on
   `token.startsWith(ApiTokenService.TokenPrefix)`, and `ApiTokenService.TokenPrefix = "helio_pat_"`
   (`ApiTokenService.scala:75`). D2's plan ("restrict the `Authorization` header path to
   `helio_pat_`-prefixed tokens only") is a straightforward tightening of an already-prefix-gated path,
   not a new invention — low risk of silently breaking `helio-mcp`.

4. **Hard-cutover safety** — CONFIRMED.
   `backend/src/main/resources/db/migration/V45__hash_session_tokens.sql:13`: `DELETE FROM
   user_sessions;` — every live session is wiped by HEL-288's migration. No orphaned session tokens for
   the header-auth path to strand.

5. **Dependency-override plan** — structurally sound npm syntax and correctly targeted, verified
   against the actual lockfiles (no `node_modules` installed in this worktree, so I read
   `package-lock.json`'s `packages` map directly rather than trusting `npm ls`, which returned empty
   with no `node_modules` present):
   - Root `package.json`: confirmed no `overrides` key exists today (matches D6's claim).
   - Root `package-lock.json`: `@eslint/eslintrc` → `js-yaml: ^4.1.1` (top-level `node_modules/js-yaml`
     resolves 4.1.1) — exact match for D6's `@eslint/eslintrc → ^4.2.0` override target.
   - Both root and frontend `package-lock.json`: `@babel/core` resolves to `7.29.0` everywhere — matches
     the "blanket bump, all consumers already on 7.29.0" claim.
   - Frontend `package-lock.json`: `@istanbuljs/load-nyc-config` depends on `js-yaml: ^3.13.1`
     (resolves to `3.14.2`) — exact match for D6's `@istanbuljs/load-nyc-config → ^3.15.0` target.
   - Frontend `package.json` already has an `overrides` block (`follow-redirects`) — confirms "extends
     its existing one."
   - Minor imprecision (non-blocking, see notes): `brace-expansion` in both lockfiles sits under
     `minimatch`, which sits under the named parents (`eslint-plugin-react`, jest's `glob`,
     `typescript-eslint`) — one level deeper than D6's prose implies. This item is explicitly optional
     /best-effort per the ticket ("skip if it doesn't resolve cleanly, not allowed to block delivery"),
     so I'm not blocking on it.

6. **Spec-delta consistency** — CONFIRMED across all five spec deltas: cookie name (`helio_session`),
   CSRF header name (`X-Helio-Requested-With: 1`), and response-body shape (`{ expiresAt, user }` with
   `token` explicitly absent) are identical in `request-authentication`, `csrf-protection`,
   `email-password-auth`, `google-oauth-login`, and `frontend-auth-state`. No contradictions found.

### Additional check beyond the assigned list — a real gap

I traced every current consumer of `sessionStorage`/manual `Authorization` header in the frontend
(`grep -rl "Authorization\|sessionStorage" frontend/src`) to make sure the migration's Impact section
(`frontend/src/{services/httpClient.ts,features/auth/**}`) is actually exhaustive. It is not:

**`frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts`** independently reads
`sessionStorage.getItem("helio_auth_token")` (the same `SESSION_STORAGE_KEY` this migration removes)
and manually builds an `Authorization: Bearer <token>` header for its own `fetch()` call to
`GET /api/pipelines/:id/run-events` (an SSE stream), because native `EventSource` can't carry custom
headers. This route is mounted inside `authDirectives.authenticate` in `ApiRoutes.scala:131/202`
(`PipelineRunStreamRoutes`), so it's a real authenticated endpoint, actively consumed by
`PipelineDetailPage.tsx` for live pipeline-run status, and has its own test
(`usePipelineRunEvents.test.ts:85-96`) that asserts the `Authorization` header is set from
`sessionStorage`.

This file is:
- **Not in the design's stated Impact list** (`features/auth/**` doesn't cover
  `features/pipelines/**`).
- **Not in tasks.md** — section 4 (frontend) only touches `httpClient.ts`, `authSlice.ts`,
  `authService.ts`, `types/user.ts`. Task 6.2 ("update any component tests relying on `auth.token` or
  manual `Authorization` header mocking") is vague enough that an implementer *might* stumble onto
  this test, but nothing directs them to the *source* file, and nothing requires verifying the actual
  runtime behavior of the live-status feature post-migration.
- **Not in the Playwright verification plan** (tasks.md 7.1-7.7) — none of the seven scenarios touch
  the pipeline run-events SSE flow.

After this migration: `sessionStorage` will never contain the token, so this hook's manual
`Authorization` header will never be set at all, and even a stale value would now be rejected by the
backend's hard cutover (D2). Whether the feature keeps working then hinges entirely on an
**undocumented, unverified assumption** — that a plain `fetch()` without an explicit `credentials`
option defaults to `"same-origin"` and therefore still attaches the `helio_session` cookie for
same-origin dev requests (via the Vite proxy). Nothing in design.md states or defends this assumption,
and it isn't tested. In production this call also uses a bare relative URL (`/api/pipelines/...`),
not `API_BASE_URL` — given finding #1 above (no reverse proxy, no `/api/**` rewrite in
`firebase.json`), that call likely already 404s/rewrites-to-`index.html` in prod today, independent of
this ticket. That's a pre-existing, separate bug, but it doesn't excuse leaving an active, tested,
security-relevant auth consumer completely unaudited in a change whose whole purpose is to rip out the
exact mechanism (`sessionStorage` + manual `Authorization` header) it depends on.

This is a genuine gap between what tasks.md/design.md cover and what the migration actually touches —
not a nitpick.

### Verdict: REFUTE

### Change Requests

1. **Add `frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts` (and its test) to
   design.md's Impact section and to tasks.md section 4.** Explicitly decide and document one of:
   (a) update the hook to pass `credentials: "include"` explicitly on its `fetch()` call (matching the
   `withCredentials: true` decision made everywhere else) and delete the now-dead
   `sessionStorage.getItem(SESSION_STORAGE_KEY)` / manual `Authorization` header code, updating
   `usePipelineRunEvents.test.ts` accordingly; or (b) if there's a reason cookie-based auth won't work
   for this SSE endpoint (e.g. a real prod cross-site gap independent of this ticket), say so explicitly
   and scope a follow-up ticket — but don't leave it silently unaddressed in a change that removes the
   exact mechanism it currently relies on.
2. **Add a Playwright scenario (tasks.md section 7) exercising the pipeline run-events SSE flow**
   authenticated via the new session cookie, so the fix to #1 is actually verified end-to-end and not
   just asserted.

### Non-blocking notes

- D6's `brace-expansion` override description names `eslint-plugin-react`/jest's `glob`/
  `typescript-eslint` as the nesting parent, but the actual lockfile chain is
  `<parent> → minimatch → brace-expansion` (one level deeper). Since this item is explicitly optional/
  best-effort per the ticket, this is a documentation nit for the executor to get right during
  implementation, not a blocking issue.
- The new `COOKIE_SECURE` env var (task 3.1) isn't yet reflected in `.env.example`,
  `backend/.env.example`, `infra/.env.deploy.example`, or the "Production environment variables" table
  in `CLAUDE.md`. Worth adding alongside the code change for operational completeness.
- D4/task 3.5's CSRF-exemption logic ("skip the header check for PAT-authenticated requests") isn't
  fully spelled out as a mechanism — `AuthenticatedUser` currently carries only `id: UserId`, no
  credential-kind discriminator, so the CSRF directive will need to either inspect the raw
  Authorization/Cookie headers itself or thread a credential-kind flag through `authenticate`. This is
  inferable and testable (task 5.3 covers it) so I'm not blocking on it, but the design could have been
  more explicit about which approach it intends.
