## Standing Constraints

- [C1] Commit only `helio-mcp/package.json`, `helio-mcp/package-lock.json`, `helio-mcp/src/index.ts` (owner ruling include-index-edit) (+ this change dir). Any other file means STOP and escalate first.
- [C2] Never touch zod, `.audit-ci.jsonc` allowlist, `.github/workflows/ci.yml`, `playwright.config.ts`, `.gitignore`, `frontend/`.
- [C3] No writes under `~`: every npm/npx call sets scratchpad `npm_config_cache` and `npm_config_logs_dir` (prefix `hel1348-`); never committed.
- [C4] Never use the session's helio MCP tools; build helio-mcp fresh in the worktree. Never pkill/pgrep/killall; kill only recorded PIDs.
- [C5] Scope widened to helio-mcp/src/index.ts (maxBufferSize + stderr onerror) by owner ruling include-index-edit

### Backend

- [x] 1.1 Record base red: from the worktree root, `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp` exits 1 on GHSA-6qxp-vccf-f47h (keep full log)
- [x] 1.2 Build base `dist` and capture the stdio smoke baseline (design D5) before changing anything
- [x] 1.3 In `helio-mcp/`: `npm install @modelcontextprotocol/sdk@1.31.0 --save`; verify package.json diff is only the `^1.31.0` line
- [x] 1.4 Mechanical lockfile churn check vs base (design D2); expected set = sdk 1.29.0→1.31.0 only; justify or revert any other key; zod entry byte-identical
- [x] 1.5 Same audit command on branch exits 0, no allowlist change (keep full log)

- [x] 1.6 `helio-mcp/src/index.ts`: pass `{ maxBufferSize }` (derived value + arithmetic in a comment) to `StdioServerTransport`; register a stderr-logging `onerror`

### Tests

- [x] 2.1 `npm ci` in `helio-mcp/`; assert installed sdk version is 1.31.0
- [x] 2.2 `npm run build` and `npm run typecheck` in `helio-mcp/` exit 0
- [x] 2.3 Root `npm ci` then `npx jest helio-mcp`; record which sdk copy Jest resolves and the pass count
- [x] 2.4 Re-run the stdio smoke against the fresh 1.31.0 `dist`; diff against 1.2's baseline
- [x] 2.5 Write the 1.29→1.31 API-diff finding and the 10 MB ReadBuffer assessment (design D6)
- [x] 2.6 Write `files-modified.md`: changed-package list, red/green transcripts, gate results, smoke diff
- [x] 2.8 Red/green: 11 MB inline-CSV request vs scratch stub listener — `-32000` on a774c3d99 build, forwarded on fix build; overflow above N logs to stderr
- [x] 2.9 Correct `files-modified.md` ReadBuffer section and D6 outcome; response side marked UNVERIFIED
- [ ] 2.7 After the PR opens (orchestrator-owned): cite the CI run id with the `security` job's helio-mcp audit step green
