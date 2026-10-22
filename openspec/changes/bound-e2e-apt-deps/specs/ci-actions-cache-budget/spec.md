## MODIFIED Requirements

### Requirement: Large CI caches are written only from main
The backend compile-output cache, the sbt dependency cache, the e2e `node_modules` cache and the e2e apt archive cache
SHALL be saved only by a workflow run for a push to `refs/heads/main`, from exactly one job per run. Pull-request runs
and every other job SHALL restore these caches without saving them.

#### Scenario: PR that changes the sbt build
- **WHEN** a pull request changes `backend/build.sbt` or `backend/src/**` and its CI run completes
- **THEN** no `sbt-*` or `backend-compile-*` cache entry scoped to `refs/pull/<N>/merge` exists for that PR

#### Scenario: PR that changes a lockfile
- **WHEN** a pull request changes `package-lock.json` or `frontend/package-lock.json` and its CI run completes
- **THEN** no `e2e-node-modules-*` cache entry scoped to `refs/pull/<N>/merge` exists for that PR

#### Scenario: PR that changes the e2e setup action
- **WHEN** a pull request changes `.github/actions/e2e-setup/**` and its CI run completes
- **THEN** no `e2e-apt-debs-*` cache entry scoped to `refs/pull/<N>/merge` exists for that PR

#### Scenario: main push with a new dependency key
- **WHEN** a push to `main` produces an sbt dependency key with no existing entry
- **THEN** exactly one job of that run saves the new entry and the other jobs only restore

### Requirement: Superseded main cache entries are removed
A janitor workflow SHALL delete `refs/heads/main` cache entries of an explicit allowlist of single-generation families
(the backend compile cache and CodeQL overlay base databases per language, keeping the newest two of each; and the
sbt dependency cache, the e2e `node_modules` cache and the e2e apt archive cache, keeping the newest one of each),
keeping at least the newest entry of each family. It SHALL select deletions only from that allowlist and only on
`refs/heads/main`, SHALL log every deletion (key, ref, size), and SHALL support a dry-run mode that deletes nothing.

#### Scenario: after several main pushes
- **WHEN** the janitor runs and a family has entries from several `main` pushes
- **THEN** only the newest entries (up to the keep count) of that family remain and each deleted key is logged

#### Scenario: superseded sbt dependency entry
- **WHEN** the janitor runs after `backend/build.sbt` changed on `main` and two `sbt-<hash>` entries exist on main
- **THEN** the older one is deleted and logged and the newest remains

#### Scenario: superseded node_modules entry
- **WHEN** the janitor runs after a lockfile changed on `main` and two `e2e-node-modules-*` entries exist on main
- **THEN** the older one is deleted and logged and the newest remains

#### Scenario: superseded apt archive entry
- **WHEN** the janitor runs and two `e2e-apt-debs-*` entries exist on main
- **THEN** the older one is deleted and logged and the newest remains

#### Scenario: entry outside the allowlist
- **WHEN** the janitor runs and finds a cache entry whose family is not on the allowlist, or whose ref is not
  `refs/heads/main`
- **THEN** it does not delete that entry
