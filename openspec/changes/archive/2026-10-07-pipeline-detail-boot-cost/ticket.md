# HEL-1354: Pipeline-detail page boot cost: 7 parallel API calls incl. duplicate run-history GET; Outputs tab slow to become clickable under load

## Description

origin_kind: followup
origin_ticket: HEL-1298

HEL-1298 measured the pipeline-detail page while root-causing the hel910 e2e flake. On boot the page fires 7 parallel API calls, one of which is a **duplicate** `run-history` GET. With the CPU throttled 6x, the Outputs tab took 2.6–3.4 s to become clickable, compared with 0.19 s idle. The hel910 fix made the test cheaper but not the page itself. On a quiet host, the fixed scenario still ran 26.8–28.0 s at 8x throttle, against a 30 s timeout. The owner waived the review's 27 s headroom bar on the strength of this follow-up.

Not proven to be the cause of the flake, but a real user-facing cost on slow devices.

## Acceptance Criteria

* Remove the duplicate run-history GET, and say why it was doubled (systematic-debugging law: probe first, show the duplicate's root cause with evidence).
* Defer or consolidate whichever boot calls aren't needed for first paint.
* Report before and after: request count, time to an interactive Outputs tab idle and at 6x throttle, and the hel910 scenario duration at the HEL-1298 8x configuration.
* No behaviour regressions, and RTL tests for whatever was deferred.

## Driver constraints (binding for this run)

* Every number in the ticket text is a claim to re-measure, not a fact.
* HEL-1340 moved step-creation into `usePipelineStepCreation.ts`; HEL-1345 changed the create/reparent flow — re-read current page code.
* Avoid HEL-1350's files (in-flight sibling): the Output editor and `buildChartOption`.
* Do not touch `.github/workflows/ci.yml`, `playwright.config.ts`, or `.gitignore`.
* At most one CI run at a time.
* Local Playwright: at most 2 workers, under `nice -n 19`.
* CPU-throttle measurement: CDP `Emulation.setCPUThrottlingRate` plus up to 3 niced burner processes, killed only by recorded PID; record load average (`/proc/loadavg`) with each measurement batch.
* Never write under `~` outside the repo; use a project-local npm cache (`npm_config_cache=<worktree>/.npm-cache` or similar, never committed). Run `npm ci` in the worktree's `helio-mcp` if stale.
* Never bypass hooks (`--no-verify`/`-n`).
* Never use `pkill`, `pgrep`, or `killall`.
* Record exact ids for anything created on the dev DB; never touch the `matt@helio.dev` account.
* Use your own headless browser context (a Playwright script/spec) — never the shared Playwright MCP browser, never `/tmp` cookie jars.
* Keep full logs for any failing run.
* `sbt --client shutdown` and `cleanup.sh --phase4` as separate Bash calls.
