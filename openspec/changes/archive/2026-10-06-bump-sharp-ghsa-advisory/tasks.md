## Standing Constraints

- [C1] Touch only `frontend/package.json` (the one override line) and `frontend/package-lock.json` (plus this change
  dir); never `frontend/src`, `ci.yml`, `playwright.config.ts`, `.gitignore`, `.audit-ci.jsonc`, or other lockfiles.
- [C2] No writes under `~`: every npm call uses a scratchpad `npm_config_cache`; logs live in the session scratchpad
  with a `hel1346-` prefix and are never committed.
- [C3] No allowlist entry. If sharp ≥0.35.5 cannot be installed, stop and escalate.
- [C4] Never select kill/delete targets by pattern, name, or time window; no `pkill`/`pgrep`/`killall`.

### Frontend

- [x] 1.1 On the unmodified base, from `frontend/`, run `npx audit-ci --config .audit-ci.jsonc`; verify exit 1 citing GHSA-wq5f-xc86-pv6w (keep transcript)
- [x] 1.2 Raise `overrides["@vite-pwa/assets-generator"].sharp` to `^0.35.5` in `frontend/package.json`; verify `git diff` shows that one line only
- [x] 1.3 Regenerate the lockfile lock-only; verify `node_modules/sharp` is 0.35.5 and the changed/added/removed key set vs base is exactly sharp + `@img/sharp-*`
- [x] 1.4 Re-run `npx audit-ci --config .audit-ci.jsonc` from `frontend/`; verify exit 0 (keep transcript)

### Tests

- [x] 2.1 `npm ci` in `frontend/`, then `npm ls sharp` shows 0.35.5 and sharp loads in node; verify both
- [x] 2.2 `npm run build`, `npm run lint`, `npm run typecheck`, `npm test` in `frontend/`; verify all exit 0
- [x] 2.3 `npm run generate-pwa-assets` exits 0 and emits PNGs; restore exactly the listed `frontend/public/` paths and verify `git status` is clean outside the intended files
- [x] 2.4 Confirm root and `helio-mcp/` lockfiles contain no sharp (grep count 0) and are unmodified
- [x] 2.5 Write the changed-package list and red/green audit transcripts to `files-modified.md`
- [ ] 2.6 After PR (orchestrator-owned, Delivery): cite the PR's CI run id with `security` (frontend audit step) and `e2e` green
