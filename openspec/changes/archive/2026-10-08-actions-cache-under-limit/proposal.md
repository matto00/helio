## Why

The Actions cache is at 11.66 GB (2026-10-08) against GitHub's 10 GB repo limit, so entries are evicted before
reuse — PR-scoped caches never survive. The dominant source has shifted since the ticket was filed: HEL-1287's
`backend-compile-v3` entry now caches sbt 2's ever-growing CAS (`~/.cache/sbt`) and is 1.8 GB per `main` push
(7.1 GB). CodeQL's overlay base databases add ~157 MB per `main` push and are never pruned.

## What Changes

- Bound the backend compile cache: prune `~/.cache/sbt` to the blobs the current compile output references before
  saving (main only, as today), so an entry no longer accumulates every historical build.
- sbt dependency cache (`sbt-<hash>`): restore everywhere, save only from one `main` job; PRs never save it.
- `cd-frontend.yml` (tag push): stop writing npm caches under `refs/tags/*`.
- New `cache-janitor` workflow: after `main` CI and on a schedule, delete superseded `refs/heads/main` entries of an
  explicit family allowlist (backend compile, CodeQL overlay base per language), keeping the newest.
- New PR-close workflow: delete caches of exactly `refs/pull/<N>/merge` for the closed PR.
- CodeQL default setup is **not** changed: every language it analyses today keeps being analysed (AC4).

## Capabilities

### New Capabilities
- `ci-actions-cache-budget`: which CI caches are written from which refs, how superseded entries are removed, and
  how the budget is measured.

### Modified Capabilities

## Impact

`.github/workflows/ci.yml`, `cd-frontend.yml`, two new workflows, a small prune script + selftest. No app code.

**Post-merge acceptance (driver-run, per the HEL-1287/1288 precedent):** AC1 (<= 6 GB, >= 24 h after merge), AC2
(no `refs/tags/*` entries after the next `v*` deploy) and AC5 (5-green-`main`-run medians) cannot be observed inside
the delivery lane. The lane ships in-lane evidence (dry analysis, the real PR demonstrating AC3) plus exact
measurement commands in `design.md`; the driver runs them and comments on the ticket.

## Non-goals

- Changing CodeQL setup, languages, query suite or schedule; switching to an advanced `codeql.yml`.
- Changing test sharding, timeouts or concurrency (HEL-1287/1288/1361 territory).
- One-off manual deletion of today's entries (the janitor's first run handles superseded ones, logged).
