## Standing Constraints

- [C1] Touch only `frontend/package-lock.json`, `helio-mcp/package-lock.json`, `frontend/.audit-ci.jsonc`, `helio-mcp/.audit-ci.jsonc` (plus this change dir); never ci.yml, playwright.config.ts, package.json, or source files.
- [C2] No writes under `~`: every npm call uses a project-local or scratchpad `npm_config_cache`.
- [C3] Local Playwright, if run: `nice -n 19`, at most 2 workers, own ports (6751/9658).

### Backend

- [x] 1.1 In `helio-mcp/`, run `npm update proxy-addr --package-lock-only`; verify the changed-version key set vs base is exactly `node_modules/proxy-addr` (2.0.8)
- [x] 1.2 From the repo root, run `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp` (CI-verbatim args); verify exit 0 (was 1 on base)
- [x] 1.3 In `helio-mcp/`: `npm ci`, `npm run build`, `npm run typecheck` (mirrors CI `check:helio-mcp-types`); verify all exit 0
- [x] 1.4 At the repo root: `npm ci` (scratchpad cache), then `npx jest helio-mcp/src`; verify the helio-mcp suite passes (regression check only — proxy-addr is not on helio-mcp's stdio code path)

### Frontend

- [x] 2.1 In `frontend/`, run `npm update source-map-js --package-lock-only`, no overrides; verify the changed-version key set vs base is exactly `node_modules/source-map-js` (1.2.2)
- [x] 2.2 In `frontend/`, run `npx audit-ci --config .audit-ci.jsonc`; verify exit 0 (was 1 on base)
- [x] 2.3 Update the stale "npm audit is 0" comment lines (and the "see ticket.md Dependencies" reference) in both `.audit-ci.jsonc` files; verify the parsed `high`/`moderate`/`allowlist` values are unchanged vs base

### Tests

- [x] 3.1 `npm ci` in `frontend/`, then `npm run build`, `npm run lint`, `npm run typecheck`, `npm test`; verify all exit 0
- [x] 3.2 Re-run the root audit exactly as CI does (`npx audit-ci --config .audit-ci.jsonc` at the root); verify exit 0
- [x] 3.3 Write the changed-package list for both lockfiles plus red/green audit transcripts (base vs branch, all three steps) to `files-modified.md`
- [ ] 3.4 After the PR is opened (orchestrator-owned, Delivery): cite the PR's CI run id with `security` and `e2e` jobs green; the e2e AC is satisfied by CI, not a local Playwright run
