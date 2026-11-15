## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `891de51f9d9f063d27b7274c47373642b718314e`. Diff base resolved live via
`resolve-review-base.sh`: `afca73bc8ac9bf039937b2d21fcef459573a3650` (origin/main).

### Fresh gate evidence (run by the evaluator in WORKTREE_PATH, not taken from the executor)

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 ("All matched files use Prettier code style!") |
| `npm test` (root jest + frontend jest, `HELIO_JEST_MAX_WORKERS=3`) | root 65/65 suites, 570/570 tests; frontend 764/764 suites, 9402/9402 tests; exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| `npm --prefix frontend run typecheck`, `check:helio-mcp-types` | exit 0 |
| `check:tokens`, `check:dependabot`, `check:openspec`, `check:spec-structure`, `check:e2e-user-cleanup`, `check:repo-integrity`, `check:precommit-ci-parity`, `check:no-credential-leak` | all OK |
| **CI's helio-mcp audit**: `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp` | **FAILS**: 6 advisories, among them GHSA-27r3-jxmh-p828 (body-parser, high) |
| `helio-mcp/e2e/oauthConnector.ts`, re-run against the lane servers | 25/25 PASS, exit 0 |
| `helio-mcp/e2e/connectMcpBrowser.ts`, re-run in a real browser (password + MFA, light/dark, Allow/Deny) | 12/12 PASS, exit 0 |

The new helio-mcp suites (`httpApp`, `oauthFlow`, `seal`, `httpConfig`) ran in the root suite and passed. The
frontend suites `ConnectMcpPage.test.tsx` and `connectMcpReturnTo.test.tsx` ran as 18/18 when targeted.

Backend is untouched, so `sbt testFull` is not triggered. That is consistent with C1 (no Scala/Flyway change).

### Phase 1: Spec Review — FAIL

- AC1 (sign-in completes, tools listed) is proven in-lane with the SDK's own OAuth client. 76 tools came back on
  my re-run. The claude.ai check is deferred to a follow-up by C3. PASS.
- AC2 (`create_content_panel` markdown as the signed-in user) passes. On my re-run the panel was read back over
  REST as alice, and bob got a 404 on it. PASS.
- AC3 (an invalid token is refused; nothing secret is committed or logged) passes. Missing, tampered, expired and
  revoked tokens get 401 + `WWW-Authenticate` with `resource_metadata` (my own curl probe matched).
  `check:no-credential-leak` is OK. My helio-mcp process log held only method/path/status lines, with zero
  `helio_pat_` / `Bearer ` / `v1.` hits. PASS.
- AC4 (stdio unchanged) passes. `index.ts` is untouched, and `HelioAuthError` keeps its text byte-identical when no
  hint is given (test `stdio is unchanged`). The existing helio-mcp tests pass unmodified (C4). PASS.
- No AC was silently reinterpreted. The two deviations from the ticket's letter (`GET /mcp` answers 405; the body
  limit is 32 MiB, not 64 MiB) are designed and owner-visible. Task 7.7 (stating them in the PR body) is correctly
  still open, because the PR does not exist yet.
- **Issue:** task 3.2 is ticked with "helio-mcp audit still clean", which is not true. CI's own helio-mcp audit
  step fails on this lockfile (see Change Request 1).
- Task 5.1a is ticked, but `measurements.md` says the Cloud Run 32 MiB cap was "NOT independently confirmed". I
  confirmed it myself (see the suggestions), so the number is right. Only the wording in the artifact needs
  updating.
- Scope: the `scripts/check-dependabot-groups.mjs` edit is needed for `check:dependabot` to accept the three new
  direct deps. No scope creep.
- Constraints C1-C5:
  - C1 holds: helio-mcp is the authorization server via `mcpAuthRouter`, the access token is a sealed PAT, and
    nothing is stored.
  - C2 holds: `deploy-mcp.sh` has `--min-instances=0`, no `--no-cpu-throttling` and the `--image=` guard, and the
    lane deployed nothing.
  - C3 and C4 hold.
  - C5 holds for the committed tree and the logs. See Change Request 2 for the "revoke after a verification run"
    half of the credential rule.

### Phase 2: Code Review — FAIL

The code quality is high. Specifically:

- The `/mcp` order matches design D5 at `helio-mcp/src/httpApp.ts:225-234`: bearer → liveness → slot →
  `express.json` → transport. Bearer runs before any body read, so an oversized unauthenticated POST gets 401.
- Seals use per-kind HKDF subkeys, and `exp` is in seconds.
- The error page is HTML-escaped and sends `default-src 'none'; frame-ancestors 'none'` plus
  `X-Frame-Options: DENY`. I probed it live with a `<b>` client name and it came back escaped.
- `/oauth/pending` CORS answers only `HELIO_APP_URL`.
- Error handlers log the error name and status only.
- Return-to handling is limited to same-origin paths (`safeReturnPath`).
- The tests are meaningful and would catch real regressions: tamper, kind, expiry, replay, allow-list narrowing,
  the 401-before-413 case, gzip slot contention, two-user isolation, and route-wrapper round trips per sign-in path.
- Mechanical design rules: `check:tokens` is OK. `connectMcp.css` uses only `--space-*`, `--text-*` and `--app-*`
  tokens, and the page reuses the shared `auth-card`, `Spinner` and `OrbitMark`.
- File sizes are within the ~250-line soft budget, apart from e2e/evidence scripts and test files, which is
  acceptable.

Issues:

1. **[security / gate] A vulnerable body-parser is now reachable on a public endpoint, and CI's helio-mcp audit
   fails.**
   - `helio-mcp/package-lock.json` resolves `body-parser@2.3.0` (via `express@5.2.1`), which is affected by
     GHSA-27r3-jxmh-p828 (high): "Denial of Service via trailing bytes after a compressed request body".
   - Under stdio this package was never executed. This change mounts `express.json` on the public `POST /mcp`
     (`helio-mcp/src/httpApp.ts:230`). It also explicitly admits non-identity `Content-Encoding` bodies
     (`largeBodyGate`, `httpApp.ts:159-185`), which is exactly the advisory's trigger. Exposure is behind bearer
     auth, so only an authenticated caller can reach it, but any connected user can.
   - CI step "helio-mcp audit (helio-mcp/)" (`.github/workflows/ci.yml:521-523`) fails with this lockfile. I ran
     the identical command and it exited non-zero.
   - The same advisory set is present on main's lockfile (verified by auditing `afca73bc8`'s
     `helio-mcp/package-lock.json`: same 5 packages). So the CI failure itself predates this branch. The
     body-parser reachability does not.
2. **[CONTRIBUTING.md "Credential handling in delivery evidence" (HEL-846), rule 2, mandatory] Verification
   scripts leave live 90-day PATs behind.**
   - `helio-mcp/e2e/oauthConnector.ts` mints a connector PAT for alice and one for bob (`mintConnectorPat`, line
     69). It revokes only alice's, as part of the revocation check (line 298). Bob's PAT is never revoked: the
     `finally` at line 325 only kills the child process.
   - `helio-mcp/e2e/connectMcpBrowser.ts` leaves the browser user's connector PAT (minted through the real Allow
     click) live. Its `finally` at line 255 closes the browser and the stub only.
   - Both scripts are committed evidence tooling that will be re-run. Each run leaves unrevoked credentials in the
     shared dev DB.
   - Note: my own re-runs of both scripts for this evaluation left two such PATs, on throwaway users
     `hel1709-bob-*` and `hel1709-browser-*`. I could not revoke them without those users' sessions.

### Phase 3: UI Review — PASS

- The servers were started with the canonical `start-servers.sh` (with `VITE_MCP_ORIGIN=http://127.0.0.1:19777`)
  and `assert-phase.sh servers` printed PASS. I verified they serve this worktree:
  - the frontend process cwd is `.../HEL-1709/frontend`, and the served `/src/config/env.ts` contains the HEL-1709
    `MCP_ORIGIN`;
  - the backend process cwd is `.../HEL-1709/backend`.

  The servers were stopped afterwards with `stop-servers.sh` ("STOPPED ports=7141,10048").
- Happy path: the real-browser e2e passed end to end in both themes. Signed out → `/login` → password → MFA →
  back to `/connect/mcp?request=…` → Allow → code + state at the client → token → `/mcp` tools/list. The Settings
  list shows exactly one named, expiring connector PAT. Deny gives `access_denied` with state and mints nothing.
- Unhappy paths, checked live in the browser:
  - a tampered `request` shows "This connection request is invalid or has expired.";
  - with helio-mcp stopped, the page shows "Could not reach the connector service.";
  - neither state shows Allow or Deny.

  The missing-request, unconfigured-origin, framed and failed-mint states are covered by unit tests.
- Console: zero app errors or warnings on the happy path. The error path logs only the browser's own network line
  for the intended 400 (twice, from StrictMode's dev double-effect). This is not an unhandled exception.
- Loading: the `Spinner` (`aria-label="Loading"`) appears while pending info loads, as unit-tested.
- Accessibility and keyboard: the buttons have the accessible names "Allow" and "Deny". Tab focuses Allow with
  `:focus-visible` and a 2px solid outline. Facts are a `dl` (term/definition). A client name containing `<b>`
  renders as literal text.
- Breakpoints: `documentElement.scrollWidth` equals `innerWidth` at 1440, 1100, 768 and 360. The card spans
  350–750 at 1100, 184–584 at 768 and 24–336 at 360, and the buttons stay full-width (57–303 at 360). No layout
  breakage. These are self-authenticating numeric measurements, so no screenshot artifact is load-bearing here.
- Entry points: the page is reachable from the `/authorize` redirect (signed in and signed out) and directly by
  URL.

### Overall: FAIL

### Change Requests

1. **Bump body-parser in `helio-mcp/package-lock.json` to a fixed release (>= 2.4.0) and correct task 3.2.**
   - Do it in the lockfile (e.g. `npm --prefix helio-mcp update body-parser`). If express's range does not admit
     2.4.0, add an `overrides` entry in `helio-mcp/package.json`.
   - Then re-run `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp` and confirm
     GHSA-27r3-jxmh-p828 is gone.
   - Reword task 3.2's "helio-mcp audit still clean" to what is true. The remaining advisories (`qs`, `fast-uri`,
     `@hono/node-server`, `zod`) predate this branch on main and are not this lane's to fix. But CI's helio-mcp
     audit step will keep this PR red until they are resolved or allow-listed per `.audit-ci.jsonc`'s convention.
     The orchestrator should route that, e.g. as a HEL-1703-style dependency ticket, rather than let the PR merge
     red.
2. **Revoke every PAT the verification scripts mint, in their `finally` blocks** (CONTRIBUTING.md HEL-846
   rule 2).
   - In `helio-mcp/e2e/oauthConnector.ts`, record bob's (and alice's) PAT ids and `DELETE /api/tokens/:id` each in
     the `finally` at line 325, tolerating an already-revoked one. Revoking an already-revoked PAT is harmless.
   - In `helio-mcp/e2e/connectMcpBrowser.ts`, list the throwaway user's tokens with its session cookie and revoke
     every `MCP connector: Browser e2e client …` token in the `finally` at line 255.
   - Prefer reusing `helio-mcp/scripts/isolatedAuth.ts`'s `revokePat`, which revokes by exact id and confirms the
     401.

### Non-blocking Suggestions

- `measurements.md`: replace "NOT independently confirmed" with the source. On 2026-11-09 I fetched
  https://cloud.google.com/run/quotas (page title "Cloud Run Quotas and Limits"), which states: "Maximum HTTP/1
  request size 32 MiB per request. Limit applies if using HTTP/1 server. No limit if using HTTP/2 server." The
  same page also caps the HTTP/1 **response** size at 32 MiB, which is worth one line in the README's "Size" note,
  since `enableJsonResponse: true` buffers each tool result into a single response.
- `helio-mcp/src/httpApp.ts:131-151` (`livenessGate`): a `"refused"` result (any non-401 4xx) falls through to the
  tool call without being cached, so it re-checks the backend on every request. Either treat it like `"rejected"`
  or document why it passes.
- `helio-mcp/src/oauth/provider.ts:113`: the 2 KiB projection cap measures `JSON.stringify(...).length`, which is
  UTF-16 code units, not bytes. Use `Buffer.byteLength(..., "utf8")` if "bytes" is meant.
- The throwaway users the two e2e scripts register are never deleted. Same precedent as
  `helio-mcp/e2e/connector-authoring.ts`, so this is not a regression. Consider a cleanup alongside CR2.
