## Purpose

Keeps the repository's GitHub Actions cache comfortably under GitHub's 10 GB per-repo limit, so CI cache entries are
reused instead of being evicted, by controlling which refs write caches and removing entries no run can use again.

## ADDED Requirements

### Requirement: Large CI caches are written only from main
The backend compile-output cache and the sbt dependency cache SHALL be saved only by a workflow run for a push to
`refs/heads/main`, from exactly one job per run. Pull-request runs and every other job SHALL restore these caches
without saving them.

#### Scenario: PR that changes the sbt build
- **WHEN** a pull request changes `backend/build.sbt` or `backend/src/**` and its CI run completes
- **THEN** no `sbt-*` or `backend-compile-*` cache entry scoped to `refs/pull/<N>/merge` exists for that PR

#### Scenario: main push with a new dependency key
- **WHEN** a push to `main` produces an sbt dependency key with no existing entry
- **THEN** exactly one job of that run saves the new entry and the other jobs only restore

### Requirement: The backend compile cache does not accumulate history
A saved backend compile-output cache entry SHALL contain only the sbt disk-cache content referenced by that run's own
compile output, so its size tracks the current build rather than growing with every previous build.

#### Scenario: consecutive main pushes
- **WHEN** two consecutive `main` pushes each save a backend compile entry with no change to dependencies
- **THEN** the second entry is not larger than the first by more than the size of the newly compiled output

#### Scenario: incremental compile still works from a pruned entry
- **WHEN** a run restores a pruned compile entry and one source file changed
- **THEN** sbt compiles incrementally (it does not recompile the whole project) and the build succeeds

### Requirement: Tag-triggered deploys write no caches
Workflows triggered by a `v*` tag push or by a tag-based `workflow_dispatch` SHALL NOT save any Actions cache entry.

#### Scenario: release deploy
- **WHEN** the CD workflows run for a new `v*` tag
- **THEN** no cache entry with a `refs/tags/*` ref is created

### Requirement: Superseded main cache entries are removed
A janitor workflow SHALL delete `refs/heads/main` cache entries of an explicit allowlist of single-generation families
(the backend compile cache and CodeQL overlay base databases per language, keeping the newest two of each; and the
sbt dependency cache, keeping the newest one), keeping at least the newest entry of each family. It SHALL select deletions only from that allowlist and only on `refs/heads/main`, SHALL log every deletion
(key, ref, size), and SHALL support a dry-run mode that deletes nothing.

#### Scenario: after several main pushes
- **WHEN** the janitor runs and a family has entries from several `main` pushes
- **THEN** only the newest entries (up to the keep count) of that family remain and each deleted key is logged

#### Scenario: superseded sbt dependency entry
- **WHEN** the janitor runs after `backend/build.sbt` changed on `main` and two `sbt-<hash>` entries exist on main
- **THEN** the older one is deleted and logged and the newest remains

#### Scenario: entry outside the allowlist
- **WHEN** the janitor runs and finds a cache entry whose family is not on the allowlist, or whose ref is not
  `refs/heads/main`
- **THEN** it does not delete that entry

### Requirement: Closed pull requests leave no caches behind
When a pull request is closed (merged or not), a workflow SHALL delete every cache entry whose ref is exactly
`refs/pull/<N>/merge` for that pull request's number, and SHALL NOT select entries by any other ref or key pattern.

#### Scenario: PR closed
- **WHEN** pull request N is closed
- **THEN** no cache entry with ref `refs/pull/N/merge` remains and entries of other refs are untouched

### Requirement: CodeQL coverage is unchanged by cache management
Cache management SHALL NOT change which languages CodeQL analyses; deleting a superseded CodeQL overlay base
database SHALL only cost a later analysis its incremental speed-up, never coverage.

#### Scenario: after the change ships
- **WHEN** `gh api repos/matto00/helio/code-scanning/default-setup` is read after merge
- **THEN** its `languages` still include `actions`, `javascript-typescript` and `python`
