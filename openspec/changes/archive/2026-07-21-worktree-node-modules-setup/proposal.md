## Why

Every backend-only ticket in the 2026-07-20 fleet committed with `git commit -n`,
bypassing Husky's pre-commit chain, because concertino worktrees come up without
`frontend/node_modules` — so Husky's frontend jest/lint step cannot run. It is
recurring friction that defeats the local gate (CI still catches everything, so it is
not a correctness risk today).

## What Changes

- Add first-class **node_modules population** to the concertino worktree-setup source
  (`core/scripts/setup-worktree.sh` template), driven by a new config field
  (`worktree.linkModules`) rendered into `.concertino.env` by `bin/concertino`.
- For each configured directory the template makes a **hardlink copy** (`cp -al`) of
  the main checkout's `node_modules` (near-instant, near-zero extra disk via shared
  inodes; a plain symlink is rejected because a worktree `npm ci` through it destroys
  the shared main `node_modules`), with a fallback to `npm ci` when the worktree's
  lockfile differs from the main checkout's, the main modules are absent, or the
  hardlink copy fails (e.g. cross-filesystem `EXDEV`). All fallible commands are guarded
  so a failure never aborts setup under `set -euo pipefail`.
- Update `config/concertino.schema.json` to document the new field.
- Enable it in helio's `concertino.config.json` for `frontend/node_modules`, then
  re-sync so the regenerated helio `scripts/concertino/setup-worktree.sh` +
  `.concertino.env` carry the change.
- Result: a fresh worktree runs the full Husky pre-commit chain without `commit -n`.

## Capabilities

### New Capabilities
- `concertino-worktree-setup`: worktree setup populates each configured module
  directory (default: hardlink copy of the main checkout, `npm ci` fallback on lockfile
  drift / missing modules / cross-filesystem) so the full Husky pre-commit chain runs
  without `commit -n`.

### Modified Capabilities
<!-- None. -->

## Impact

- Concertino source repo (`~/Development/concertino`): `core/scripts/setup-worktree.sh`,
  `bin/concertino` (renderEnv), `config/concertino.schema.json`.
- Helio: `concertino.config.json` + regenerated `scripts/concertino/setup-worktree.sh`
  and `scripts/concertino/.concertino.env` (via `concertino sync`).
- No application code, API, schema, or migration changes. Two PRs (concertino + helio).

## Non-goals

- Unconditional per-worktree `npm ci` (rejected: hundreds of MB per worktree).
- Changing the Husky hook chain itself or backend (`sbt`) setup.
