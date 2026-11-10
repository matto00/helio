## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `e2bcf6b8c7e235bc883e317edec1a88a818384fb`. The diff base was resolved live with `resolve-review-base.sh`
(main/origin) and is `afca73bc8ac9bf039937b2d21fcef459573a3650`. The diff is 74 files, +5779/-68, in 2 commits. The
spawn-cwd guard printed `READY`.

### What I verified (with evidence)

**Gates, re-run fresh by me in the worktree, all at nice 19 with at most 3 workers**
- Root `npx jest helio-mcp --maxWorkers=3`: 65/65 suites and 570/570 tests passed, exit 0. This includes the new `httpApp`, `oauthFlow`, `seal` and `httpConfig` suites.
- `npm run lint`: exit 0. `npm run format:check`: exit 0.
- Targeted frontend jest run (`mcpConnect|connectMcpReturnTo|postLoginReturnTo|pwaConfig|auth/`): 13 suites and 159 tests passed, exit 0.
- `npm --prefix frontend run typecheck`: exit 0. `npm --prefix frontend run build`: exit 0.
- `check:helio-mcp-types`: exit 0. `npm --prefix helio-mcp run build`: exit 0.
- `check:cloud-run-cpu`, `check:dependabot`, `check:openspec`, `check:no-credential-leak`, `check:repo-integrity`, `check:spec-structure` and `check:precommit-ci-parity`: every one exit 0.
- `infra/deploy-mcp.sh`: `bash -n` gives 0. A run with no `--image=` exits 1 with the guard message.
- `audit-ci` on helio-mcp: the only failing advisory is GHSA-mrhx-c7xc-m3w5 (zod). The lockfile resolves zod 3.25.76, the same version as main's lockfile. This matches the known exclusion in the orchestrator's prompt.
- I did not re-run the full frontend suite. The evaluator ran it in cycle 1 (764/764), and `git diff 891de51f9..HEAD -- frontend` is empty.

**Acceptance criteria, traced**
1. *Connector sign-in completes and lists tools.*
   - The code path is `httpApp.ts` (`mcpAuthRouter` + `requireBearerAuth` + stateless `StreamableHTTPServerTransport`), `oauth/provider.ts` and `oauth/routes.ts`.
   - I ran `helio-mcp/e2e/oauthConnector.ts` myself against the lane backend (:10048) and `dist/http.js`, using the SDK's own OAuth client. It printed ALL CHECKS PASSED: 401 discovery, DCR, `/authorize` 302 to `/connect/mcp`, pending info, callback 302 with code+state, `/token`, and listTools (76 tools).
   - The claude.ai check itself is the owner's after deploy (C3).
2. *`create_content_panel` markdown as the signed-in user.*
   - The same run passed "create_content_panel (markdown) succeeded" and "panel read back over REST as that user (HTTP 200)".
   - Bob's isolation also passed: none of alice's dashboards were visible, and alice's panels returned 404 to him.
3. *Unauthenticated requests refused; no secret logged.*
   - My own curl: `POST /mcp` with no token gave `401` and `WWW-Authenticate: Bearer error="invalid_token", ..., resource_metadata=".../.well-known/oauth-protected-resource/mcp"`.
   - In the e2e run, a tampered token got 401. A revoked PAT got a "reconnect" tool error inside the TTL, then 401 `invalid_token` after it.
   - The e2e transcript and my probe server's log had 0 hits for `helio_pat_`, `Bearer v1` or `request=`. The request log uses only `originalUrl.split("?")[0]`, and the error handler and `onerror` log only the error name.
4. *stdio unchanged.*
   - `index.ts` is not in the diff, and no pre-existing helio-mcp test file was modified (the four test files in the diff are new).
   - `HelioAuthError` keeps its exact stdio text when no hint is supplied (`httpClient.ts` diff), and a test asserts it (`httpApp.test.ts:227`).

**My own adversarial probes (beyond the executor's evidence)**
- DCR with `http://evil.example/cb` gives 400, and `javascript:` gives 400.
- `/authorize` with a redirect_uri the client never registered gives 400 with no redirect.
- `client_name` `Claude <b>x</b>` renders as literal text on the consent page (React escaping). helio-mcp's own HTML error pages escape it as well (`util.ts escapeHtml`, CSP `default-src 'none'`).
- I read seal.ts, provider.ts, routes.ts, patCheck.ts, httpApp.ts and httpConfig.ts in full:
  - per-kind HKDF subkeys, a `kind` check, and `exp` in seconds;
  - code bound to clientIdHash, PKCE and redirect;
  - an in-instance used-code set;
  - redirect allow-list re-applied at authorize;
  - the bearer → liveness → slot → json order, so an anonymous request is refused before the body is read;
  - config errors name the variable but never echo its value.
- Return-to safety: `safeReturnPath` rejects absolute URLs, `//host`, `/\host` and control characters, and has tests.

**UI judgment (DESIGN.md, both themes)**
- The consent page renders with a real pending request from my probe server. Screenshots, persisted:
  - dark: `/home/matt/Development/helio/.concertino/runs/HEL-1709/evidence/.concertino/skeptic-shots/consent-current-theme.png`
  - light: `/home/matt/Development/helio/.concertino/runs/HEL-1709/evidence/.concertino/skeptic-shots/consent-light.png`
  - error state, light: `/home/matt/Development/helio/.concertino/runs/HEL-1709/evidence/.concertino/skeptic-shots/consent-error-light.png`
- The page reuses the sign-in `auth-page`/`auth-card` layout, the brand mark, the `.eyebrow` utility, the primary `auth-submit` and a secondary button recipe it shares with the Google button.
- The CSS is all tokens (`--space-*`, `--text-*`, `--app-text*`), with no hardcoded values. Light and dark are at parity. The hierarchy is clear (title, then subtitle, then facts, then consequence note, then actions), and the error state uses the shared `auth-error` block.
- The only console errors were the expected 400 network responses for invalid requests. There were no application errors.
- The theme was restored to dark afterwards. I never clicked Allow, so no PAT was minted in the dev account.

**Deploy artefacts:**
- `deploy-mcp.sh` has `--min-instances=0` and `--max-instances=2`, has no `--no-cpu-throttling`, and reads its secret from Secret Manager (C2).
- The Dockerfile is multi-stage, runs as non-root, uses `tsconfig.build.json`, and does not mask build failures.
- The sizing arithmetic in `measurements.md` is consistent: 129 + 281 + 4 × 73 = 702 MiB, under 768 MiB.

### Verdict: CONFIRM

### Non-blocking notes
- `check:cloud-run-cpu` scans only `infra/deploy-backend.sh` (`scripts/check-cloud-run-cpu.mjs:41,60`). It does not guard the new `infra/deploy-mcp.sh`, so C2's "never --no-cpu-throttling" is protected only by review today. Worth a small follow-up to extend the check.
- The zod advisory GHSA-mrhx-c7xc-m3w5 will keep CI's helio-mcp audit step red. Routing it to a separate ticket (as planned) or adding an owner-approved allowlist entry has to happen before "merge on green" can be satisfied.
- Task 7.7 (the PR body must state the 405-for-GET and 32 MiB deviations) is still open for Delivery.
- The e2e scripts leave throwaway `hel1709-*@example.com` users in the shared dev DB. Their PATs are revoked.
