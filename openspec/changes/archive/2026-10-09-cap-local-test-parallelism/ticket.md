# HEL-1442: Cap local test/dev memory and parallelism at CI's worker counts so 3 concurrent delivery lanes fit on the dev box (local only)

## Description

**Incident (2026-10-09 05:23 PDT):** the dev box (Ryzen 5 7600X, 12 threads, 62 GB RAM) hit a global OOM while 3
concertino lanes ran: two were committing (husky pre-commit runs the full `npm test`) and one was building. At the
moment of the kill, ~30 `node` processes held ~27 GB RSS, `java` ~6.7 GB, and shmem ~14 GB. The OOM killer took
`claude-desktop`, which tore down the whole Hyprland session (user logged out; the machine did not reboot).

**Owner ruling (Matt, 2026-10-09, reconfirmed to the driver via AskUserQuestion ~16:55Z):** make memory/parallelism
caps a PERMANENT part of local development. **CI's worker counts are the hard cap.** Size local so **3 lanes run
comfortably**. **Local only**: production (Cloud Run backend, Firebase frontend) must NOT get these caps.

## Current state (driver-observed; verify)

* Jest: root `jest` then `frontend` jest (`package.json` `test`), no `maxWorkers`, so locally it defaults to
  cores-1 = 11 workers per run. CI's 4-vCPU runner gets 3.
* Playwright: `workers: process.env.CI ? 2 : undefined`, so locally the default is 50% of cores = 6.
* sbt tests: forked groups run serially locally unless `HEL924_TEST_GROUP_CONCURRENCY` is set (CI sets 2). Heap: CI
  forces `-Xmx3g`; local is unbounded by config (check `.jvmopts`/`.sbtopts`, `Test / javaOptions`, the forked JVMs'
  `-Xmx`, and `sbt run`).
* Vite dev servers, the `sbt run` backend and Playwright browsers per lane (`scripts/concertino/start-servers.sh`,
  which is a RENDER TARGET: changes go upstream to Concertino, never edited here).

## Acceptance

* Every local test/dev entry point is capped at CI's numbers or lower: jest maxWorkers (and `workerIdleMemoryLimit`),
  Playwright workers, sbt forked-group concurrency and per-JVM heap, plus a node heap cap where it matters. Caps apply
  when `CI` is unset and leave CI's own settings unchanged. Nothing touches prod config (`Dockerfile`, Cloud Run
  flags, `application.conf` prod paths, the frontend build output).
* The pre-commit hook path (`npm test`) is capped too, since it's what ran during the incident.
* Measured proof on this box: peak RSS of one lane's full pre-commit + full `sbt testFull` + dev servers, before and
  after, and a 3-lane concurrent simulation (or a justified extrapolation) with comfortable headroom against 62 GB.
  Measure with `nice -n 19` and don't OOM the box doing it; ramp up.
* Wall-clock cost of the caps is stated (the local hook gets slower).
* Documented in CLAUDE.md/CONTRIBUTING.md (local caps and how to override for a one-off run) and MISTAKES.md (the
  incident). Any Concertino-side change (start-servers.sh, lane briefs) goes in a CON ticket.
