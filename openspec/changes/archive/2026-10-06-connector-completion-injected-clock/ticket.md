# HEL-1323: ConnectorCompletionServiceSpec: 50 ms expiry race under load (flaked at 3 forks)

## Description

origin_kind: followup
origin_ticket: HEL-1287

During HEL-1287, `ConnectorCompletionServiceSpec` flaked once when CI ran 3 forked test groups per leg. That is why CI
now uses 2. The lane attributes it to a 50 ms expiry window that loses a race when the CPU is contended.

## Acceptance Criteria

* Root-cause it with a probe (systematic-debugging law). Reproduce it under contention, for example at 3 forks or with
  background load at `nice -n 19`, and record the failure rate.
* Fix it with an injected clock or by waiting on state. Do not just lengthen the window.
* Show 20 or more green runs under the contended setup.
* Then report whether CI could safely go back to 3 forks per leg. Raising it is a separate decision.

## Driver constraints (from the dispatching driver, binding for this run)

* If the root cause is a product bug (e.g. an expiry/completion race in product code), fix the product and add a test
  that is red without the fix; if that touches security semantics, escalate.
* Do NOT change the CI fork setting; `.github/workflows/ci.yml`, `frontend/playwright.config.ts` and `.gitignore` are
  out of scope and must not be touched.
* Backend tests: `nice -n 19 sbt testFull` with Bash timeout 600000. Contention repro: `testOnly` with at most 3
  forks, or niced background load processes; never more than 3-4 workers in total; kill load processes only by their
  recorded PIDs.
* `sbt --client shutdown` and `cleanup.sh --phase4` are separate Bash calls.
* Never create/update/delete anything under `~` outside the repo and its worktrees. Prefer EmbeddedPostgres.
* At most one CI run at a time.
