## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `e2bcf6b8c7e235bc883e317edec1a88a818384fb` (cycle-2 delta: `891de51f9..e2bcf6b8c`). Diff base resolved live:
`afca73bc8ac9bf039937b2d21fcef459573a3650` (origin/main).

### Fresh gate evidence (evaluator-run, WORKTREE_PATH)

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| root `jest` (includes all helio-mcp suites, `HELIO_JEST_MAX_WORKERS=3`) | 65/65 suites, 570/570 tests |
| frontend `npm --prefix frontend test` + `npm --prefix frontend run build` | not re-run this cycle. `git diff --name-only 891de51f9..HEAD -- frontend backend` is empty, so the frontend tree is byte-identical to the one that went green in cycle 1 (764/764 suites, 9402/9402 tests, build exit 0) |
| `check:helio-mcp-types`, `npm --prefix helio-mcp run build` | exit 0 |
| `check:dependabot`, `check:no-credential-leak`, `check:openspec` | OK |
| `npm --prefix helio-mcp ci --dry-run` | lockfile in sync with package.json |
| `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp` | **one advisory remains:** GHSA-mrhx-c7xc-m3w5 (zod). This is pre-existing on main; see "Merge-readiness note" below |
| `helio-mcp/e2e/oauthConnector.ts` (re-run) | 25/25 PASS. Cleanup: bob's PAT revoked with 204; alice's returned 404 because the revocation check had already revoked it |
| `helio-mcp/e2e/connectMcpBrowser.ts` (re-run, real browser) | 12/12 PASS. Cleanup: the connector PAT minted by the Allow click was revoked with 204 |

Both transcripts have zero `helio_pat_`, `Bearer ` and `v1.` hits. My re-runs this cycle left no live PATs.

The servers were started with `start-servers.sh` (`VITE_MCP_ORIGIN=http://127.0.0.1:19777`), and `assert-phase servers`
printed PASS. Both server processes' cwd is this worktree, and the served `env.ts` carries `VITE_MCP_ORIGIN`. The
servers were stopped with `stop-servers.sh`.

### Verification of cycle-1 change requests

**CR1 (body-parser): resolved.**
- `npm ls` shows `body-parser@2.4.0` under `express@5.3.0`, and `@modelcontextprotocol/sdk@1.32.2`.
- The overrides now resolve `qs@6.17.1`, `fast-uri@3.1.9` and `@hono/node-server@2.1.6`.
- GHSA-27r3-jxmh-p828 no longer appears in audit-ci output.
- Task 3.2 now states the audit status truthfully.

**The remaining zod advisory is not this lane's to fix.**
- The advisory's only patched version is `4.6.6` (range `< 4.6.6`, per the GitHub advisory API).
- The latest zod 3 release is `3.25.76`, which is what the lockfile resolves, so there is no 3.x backport.
- Moving to zod 4 is a breaking migration across the tool schemas.
- It is present on main's lockfile too.

**CR2 (revoke e2e PATs): resolved.**
- `oauthConnector.ts` records every minted PAT and revokes all of them in `finally`.
- `connectMcpBrowser.ts` revokes every `MCP connector: Browser e2e client` token in `finally`.
- My re-runs confirmed it with the 204/404 cleanup lines above.

**Suggestions: applied.**
- `measurements.md` now cites the quotas page.
- The README notes the 32 MiB response cap.
- The liveness `"refused"` pass-through is documented at `httpApp.ts:151-154`.
- The projection cap uses `Buffer.byteLength` (`provider.ts:110`).

### Phase 1: Spec Review — PASS
Issues: none.
- All four ACs are re-proven in-lane by the e2e re-runs.
- Constraints C1-C5 are honoured, and stdio is unchanged.
- The tasks match what was built. Task 7.7 (PR-body deviations) is correctly still open for Delivery.

### Phase 2: Code Review — PASS
Issues: none blocking.
- The cycle-2 delta is small and focused: lockfile/overrides, e2e cleanup, one comment, one byte-length fix and docs.
- No drive-by behaviour changes.

### Phase 3: UI Review — PASS
- No frontend file changed this cycle.
- The real-browser consent flow re-ran green in both themes: password+MFA return-to, Allow, Deny.
- The cycle-1 checks (error states, console, keyboard, 1440/1100/768/360 breakpoints) apply unchanged to an
  identical frontend tree.

### Overall: PASS

### Merge-readiness note (not a lane change request; for the orchestrator)
- CI's "helio-mcp audit (helio-mcp/)" step (`.github/workflows/ci.yml:521-523`) will still fail on this PR because
  of GHSA-mrhx-c7xc-m3w5 (zod, high). It fails on main for the same reason.
- This change makes zod newly reachable from a public, network-facing endpoint. Exposure is behind bearer auth and
  the 32 MiB body cap.
- Under C3 ("merge on green") the PR must not merge with that step red. Two routes:
  - land the zod 4 migration first, as a separate ticket;
  - or have the owner approve an `.audit-ci.jsonc` allowlist entry in the file's documented form
    (`"GHSA-mrhx-c7xc-m3w5|zod*"` with ticket, reason, path and review-by date).

  Either is an owner/orchestrator routing decision, not an executor code fix.

### Non-blocking Suggestions
- `connectMcpBrowser.ts`'s cleanup prints only the HTTP status of the revoke. It could reuse
  `scripts/isolatedAuth.ts`'s `revokePat`, which also confirms the 401 afterwards.
