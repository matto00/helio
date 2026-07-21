# concertino-worktree-setup Specification

## Purpose
Ensure a freshly created Concertino worktree comes up with its configured dependency
directories (e.g. `frontend/node_modules`) populated — by default a near-instant,
near-zero-disk hardlink copy of the main checkout, with an `npm ci` fallback on lockfile
drift — so the full pre-commit hook chain (including the frontend lint/test step) runs
without resorting to `git commit -n`.
## Requirements
### Requirement: Worktree setup populates configured module directories

The canonical `setup-worktree.sh` SHALL populate each module directory listed in the
`worktree.linkModules` config field (rendered as `CONCERTINO_LINK_MODULES`) so that a
freshly created worktree can run the full pre-commit hook chain — including any hook
step that depends on installed dependencies (e.g. Husky's frontend lint/test step) —
without bypassing it via `git commit -n`. The step SHALL be best-effort: even though
the script runs under `set -euo pipefail`, every fallible command in this step MUST be
guarded so that a failure (e.g. a failed `npm ci`) MUST NOT abort worktree setup —
setup MUST still reach its `READY` output, consistent with the existing worktree hooks.

#### Scenario: Fresh worktree can run the frontend pre-commit step

- **WHEN** a worktree is created for a project that configures
  `worktree.linkModules: ["frontend/node_modules"]` and the main checkout has
  `frontend/node_modules` installed
- **THEN** the worktree's `frontend/node_modules` resolves after setup and the Husky
  pre-commit chain's frontend lint/test step runs without `git commit -n`

#### Scenario: A failing module-populate step does not abort setup

- **WHEN** the populate step's fallible command fails (e.g. `npm ci` fails on an
  unreachable registry or a corrupt lockfile)
- **THEN** setup emits a `note:` about the failure and still completes, printing its
  `READY worktree=…` / `READY branch=…` / port lines

### Requirement: Hardlink copy by default, real install only on lockfile drift

The setup step SHALL prefer a hardlink copy over a real install for each configured
module directory `M` (parent `P = dirname(M)`, lockfile `P/package-lock.json`). It MUST
NOT create a symlink that points into the main checkout's live `node_modules`, because
a `npm ci` run in the worktree through such a symlink destroys the shared main
checkout's modules. It MUST skip `M` when the worktree already has it (a real directory
or an existing link), keeping setup idempotent. It MUST populate the worktree's `M`
with a hardlink copy of the main checkout's `M` (`cp -al`) when the main checkout's `M`
exists and the worktree lockfile matches the main checkout's lockfile — incurring
near-zero time and disk via shared inodes while leaving the worktree's copy an
independent directory entry that a later `npm ci` cannot corrupt on the main side. It
MUST fall back to installing the worktree's own modules (`npm ci` in `P`) when the
lockfiles differ, the main checkout's `M` is absent, or the hardlink copy fails (e.g.
`EXDEV` cross-filesystem), so a dependency-changing or cross-filesystem worktree gets
correct modules rather than stale or missing ones.

#### Scenario: Unchanged dependencies are hardlink-copied

- **WHEN** setup runs and the worktree lockfile matches the main checkout's lockfile
  and the main checkout's module directory exists
- **THEN** the worktree module directory is a hardlink copy of the main checkout's
  module directory (no symlink into the main checkout, no `npm` install performed) and
  a subsequent `npm ci` in the worktree leaves the main checkout's modules intact

#### Scenario: Changed dependencies trigger a real install

- **WHEN** setup runs and the worktree lockfile differs from the main checkout's
  lockfile
- **THEN** the setup step installs the worktree's own modules from its lockfile rather
  than copying from the main checkout

### Requirement: Config field propagates through sync

The `worktree.linkModules` field SHALL be documented in the config schema and rendered
into the consuming repo's `.concertino.env` as `CONCERTINO_LINK_MODULES` by
`concertino sync`, so enabling it in a project config reaches the generated
`setup-worktree.sh` through the mandated sync mechanism (no hand-edit of generated
files).

#### Scenario: Sync renders the configured module list

- **WHEN** a project sets `worktree.linkModules` in `concertino.config.json` and runs
  `concertino sync`
- **THEN** the regenerated `scripts/concertino/.concertino.env` contains a
  `CONCERTINO_LINK_MODULES` entry with those directories and the regenerated
  `setup-worktree.sh` consumes it

