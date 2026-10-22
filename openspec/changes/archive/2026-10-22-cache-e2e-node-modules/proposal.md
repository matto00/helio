## Why

Run 39711300255 (PR #1075) lost `e2e-prod-build` to its 8-minute timeout and `e2e (2)` to its 25-minute timeout
because root `npm ci` took 7 minutes, even though the `~/.npm` cache (`actions/setup-node` `cache: npm`) was a hit
(`node-cache-Linux-x64-npm-4d15...` restored, then "added 619 packages in 7m"). Caching the download cache is already
done and does not bound install time; only skipping `npm ci` does. Separately, `npm run e2e:prod-build` (HEL-1691)
cannot be run inside a concertino lane with documented scripts: it serves `vite preview` on DEV_PORT and needs DEV_PORT
free, but the only documented way to free it (`stop-servers.sh`) also stops the backend, and there is no documented
backend-only start (CORS is pinned to `http://localhost:$DEV_PORT` by the lane's start command).

## What Changes

- `.github/actions/e2e-setup`: restore a `node_modules` + `frontend/node_modules` cache keyed exactly on OS, arch,
  resolved Node version and both lockfiles; skip both `npm ci` steps on an exact hit; save it from exactly one job on
  a push to `main` (the ci.yml `e2e` leg 1), matching the existing large-cache policy.
- `scripts/cache-janitor.mjs`: add the new family to the allowlist so superseded `main` entries are deleted.
- `scripts/e2e-backend.sh`: a new explicit `lane-start` subcommand (CI's `start`/`wait` untouched) that starts the
  backend on `BACKEND_PORT` with CORS for `http://localhost:$DEV_PORT`, health-waits it, keeps its files in the
  worktree's git admin dir, and records the process group where `scripts/concertino/stop-servers.sh` stops it
  (refusing to overwrite a live record).
- `e2e/README.md` (and the `scripts/e2e-prod-build.mjs` header): the documented in-lane sequence
  stop-servers -> `e2e-backend.sh lane-start` -> `npm run e2e:prod-build` -> stop-servers -> start-servers.
- No timeout is changed.

## Capabilities

### New Capabilities
- `e2e-node-modules-cache`: the e2e jobs skip dependency installation when an exact lockfile-keyed `node_modules`
  cache exists.
- `e2e-prod-build-lane-run`: `npm run e2e:prod-build` runs end to end inside a concertino lane using only documented
  scripts, with a safe stop path.

### Modified Capabilities
- `ci-actions-cache-budget`: the e2e `node_modules` cache joins the main-only, one-job write rule and the janitor
  allowlist.

## Impact

`.github/actions/e2e-setup/action.yml`, `.github/workflows/ci.yml` (one `with:` input on the `e2e` job),
`scripts/cache-janitor.mjs` (+ selftest), `scripts/e2e-backend.sh`, `scripts/e2e-prod-build.mjs` (comment/doc only
unless needed), `e2e/README.md`. No product code, no schema, no migration.
