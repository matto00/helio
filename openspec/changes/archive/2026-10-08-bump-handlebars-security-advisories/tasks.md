## Standing Constraints

- [C1] Touch only `package-lock.json` and `frontend/package-lock.json` (plus this change dir); never ci.yml, any package.json, any `.audit-ci.jsonc`, or source files.
- [C2] No writes under `~`: every npm call uses a scratchpad/worktree `npm_config_cache` and logs dir.
- [C3] No self-authored allowlist entries; any unfixable advisory path is escalated with the exact proposed HEL-1246-pattern entry.
- [C4] Test runs: `nice -n 19`, at most 3 workers.

### Root

- [x] 1.1 Run root `npx audit-ci --config .audit-ci.jsonc` on base; capture red output (handlebars x3)
- [x] 1.2 `npm update handlebars --package-lock-only` at root; verify changed-version key set vs base is exactly `node_modules/handlebars` 4.7.9 -> 4.7.10
- [x] 1.3 Re-run root audit-ci (CI-verbatim); verify exit 0

### Frontend

- [x] 2.1 Run `frontend/` audit-ci on base; capture red output
- [x] 2.2 `npm update handlebars --package-lock-only` in `frontend/`; verify changed-version key set is exactly `node_modules/handlebars` 4.7.9 -> 4.7.10
- [x] 2.3 Re-run frontend audit-ci; verify exit 0

### helio-mcp

- [x] 3.1 Run `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp` from root; verify exit 0 (unchanged tree)

### Tests

- [x] 4.1 `npm ci` at root and in `frontend/` from the new lockfiles
- [x] 4.2 Full root jest suite (includes helio-mcp/src); verify pass
- [x] 4.3 Frontend `npm test` and `npm run typecheck`; verify pass
- [x] 4.4 Write per-tree lockfile deltas and red/green audit transcripts to `files-modified.md`
