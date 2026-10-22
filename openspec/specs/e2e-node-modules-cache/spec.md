# e2e-node-modules-cache Specification

## Purpose
Bounds the dependency-install time of the e2e CI jobs by restoring an exact lockfile-keyed `node_modules` cache and
skipping `npm ci` when it hits, so registry slowness cannot push a job past its timeout.

## Requirements

### Requirement: e2e jobs skip npm ci on an exact node_modules cache hit
The shared e2e setup action SHALL restore a cache holding `node_modules` and `frontend/node_modules` whose key is
derived from the runner OS, the runner architecture, the Node major version and the contents of both
`package-lock.json` and `frontend/package-lock.json`, with no fallback (`restore-keys`) match. On an exact hit it
SHALL skip both `npm ci` and `npm --prefix frontend ci`; on a miss it SHALL run both exactly as before.

#### Scenario: exact hit
- **WHEN** an e2e job runs and a cache entry with its exact key is visible to the run
- **THEN** the job logs a cache hit, neither `npm ci` step runs, and the remaining setup steps and tests run unchanged

#### Scenario: lockfile changed
- **WHEN** a run's `package-lock.json` or `frontend/package-lock.json` differs from every cached entry's
- **THEN** no entry is restored and both `npm ci` steps run

### Requirement: The node_modules cache is written from main by one job
The e2e `node_modules` cache SHALL be saved only by a workflow run for a push to `refs/heads/main`, only when that
run's restore missed, and only from exactly one job (the ci.yml `e2e` leg 1), immediately after installation.
Every other job and every pull-request, scheduled or tag run SHALL only restore it.

#### Scenario: pull-request run
- **WHEN** a pull-request CI run completes
- **THEN** no `e2e-node-modules-*` cache entry scoped to `refs/pull/<N>/merge` exists for it

#### Scenario: main push with a new key
- **WHEN** a push to `main` produces a key with no existing entry
- **THEN** exactly one job of that run saves it, and a later run with the same lockfiles restores it
