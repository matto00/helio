## Purpose

Defines how the shared e2e CI setup installs the system packages Playwright's chromium needs, so that a slow Ubuntu
mirror or a broken third-party apt source cannot stall or fail every e2e job before any test runs.

## ADDED Requirements

### Requirement: Chromium system packages match Playwright's own list
The shared e2e setup action SHALL install exactly the apt packages that the installed Playwright version reports as
chromium's system dependencies for the runner's OS, and SHALL fail the step with a message naming the problem if it
cannot obtain a non-empty package list. It SHALL still install the chromium browser itself with Playwright.

#### Scenario: Playwright version bump changes the dependency list
- **WHEN** a lockfile change moves Playwright to a version whose chromium dependency list differs
- **THEN** the setup installs the new list with no edit to the setup action

#### Scenario: package list cannot be derived
- **WHEN** Playwright's dependency listing prints no recognisable package list
- **THEN** the setup step fails with an error naming the missing package list, before any apt install runs

### Requirement: Third-party apt sources cannot fail the install
The package-index refresh used for this install SHALL NOT depend on any apt source outside the Ubuntu archive,
including the runner image's preinstalled `packages.microsoft.com` source.

#### Scenario: packages.microsoft.com refuses the index request
- **WHEN** `packages.microsoft.com` returns `403 Forbidden` (or an unsigned-repository error) for its `InRelease`
- **THEN** the chromium package install proceeds and the setup step does not fail because of it

### Requirement: Downloaded package archives are reused across runs
The setup action SHALL restore a cache of previously downloaded `.deb` archives before installing and SHALL fetch from
the network only packages whose exact version is not in the restored archives. The cache key SHALL include the runner
OS image family and architecture so archives from a different Ubuntu release are never used.

#### Scenario: warm cache, unchanged package versions
- **WHEN** a job restores an archive cache that already holds every needed package version
- **THEN** the install downloads no `.deb` from any mirror

#### Scenario: warm cache, one package updated upstream
- **WHEN** the Ubuntu archive has published a newer version of one needed package since the cache was saved
- **THEN** only that package is downloaded and the rest come from the restored archives

### Requirement: Package fetches are time-bounded and retried on another mirror
Any `.deb` download the install still needs SHALL run under a time bound well below the shortest calling job's timeout.
If it does not finish in time or fails, the action SHALL retry the download once against a different Ubuntu archive
mirror under the same bound, and if that also fails SHALL fail the step with an error that names the stalled fetch.
No job `timeout-minutes` value SHALL be changed by this requirement.

#### Scenario: primary mirror stalls
- **WHEN** the runner's default mirror delivers the archives too slowly to finish within the bound
- **THEN** the download is abandoned at the bound and retried on the alternate mirror

#### Scenario: both mirrors fail
- **WHEN** neither mirror completes the download within its bound
- **THEN** the step fails with an error naming the stalled package fetch, rather than the job being cancelled at its
  timeout

### Requirement: The apt archive cache is written from main by one job
The e2e apt archive cache SHALL be saved only by a workflow run for a push to `refs/heads/main`, only by the one job
that is designated to save the e2e `node_modules` cache, and only when that job had to download at least one archive
that the restored cache did not hold. Every other job, and every pull-request, scheduled or tag run, SHALL only
restore it.

#### Scenario: pull-request run
- **WHEN** a pull-request run's e2e jobs complete
- **THEN** no apt archive cache entry scoped to `refs/pull/<N>/merge` is created

#### Scenario: main push with nothing new downloaded
- **WHEN** the designated job on a `main` push restores archives that cover every needed package
- **THEN** it saves no new apt archive cache entry
