# HEL-1427: CI: build the production backend Docker image on PRs so deploy-only build breaks are caught before release

## Description

Origin: HEL-1426. The v0.9.0 backend deploy failed because the Dockerfile's dependency layer didn't copy
`backend/project/TestShards.scala` (added by HEL-1287 / matto00/helio#773). CI never builds the production image, so
the break sat on main undetected for the whole v0.9 cycle and surfaced only when the tag deployed. The result was prod
frontend/backend skew.

## Scope

* Add a CI job (or extend the backend job) that runs `docker build` of the root `Dockerfile` (at least through the
  builder stage's `sbt update` + `sbt assembly`), with no push.
* Run it when `Dockerfile`, `.dockerignore`, `backend/build.sbt`, or `backend/project/**` change. Path-filter it if
  it's too slow to run on every PR, but make sure it is still required whenever it triggers (wire into `ci-complete`
  correctly for skipped-vs-failed).
* Use layer caching so it doesn't add significant wall time. Mind the HEL-1299 Actions cache budget.

## Acceptance

* A PR that reintroduces the HEL-1426 gap (e.g. removes the `COPY backend/project/*.scala` line) fails CI.
  Demonstrate the red.
* `ci-complete` gates on the new job.

## Driver constraints (run-specific)

* HEL-1299 AC1/AC5 post-merge measurements run until after 2026-10-09 22:30Z: do NOT change any existing cache
  key/path or the restore/save split. If a docker layer cache would materially eat the 10 GB budget, prefer no cache.
* The red must be demonstrated on real CI (run id linked), then reverted; green proven on the final head.
* `ci-complete` is the required aggregate check; a path-filtered job must not turn a skip into a failure or a failure
  into a pass.
