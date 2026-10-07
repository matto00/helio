# HEL-1339: CI: sbt 2 thin-client silent hang (seen twice) + osv-scanner steps have no timeouts

## Description

origin_kind: followup
origin_ticket: HEL-1296

**Two independent sightings of the same silent sbt hang:**

1. **Security job, run 37361823617, attempt 1.** sbt 2.0.9 started in thin-client mode and launched a background
   server. It printed "set current project to helio-backend" and then produced nothing for 43.5 minutes, until the
   run was cancelled. The log shows no lock, resolution, network or out-of-memory line, and the cache was an exact
   hit (HEL-1296 ci-proof).
2. **e2e leg 4 in HEL-1288's streak, run 37416099275, attempt 3.** A background `sbt run` stopped after "set current
   project to helio-backend", and the health wait timed out after 300 s (HEL-1288 profile.md).

HEL-1296 bounded case 1 with a 2-minute step timeout. HEL-1288 is adding fail-fast detection for case 2. Neither found
a root cause, but the hang has now been seen twice with the same output, so the thin-client handoff to the background
server is the leading suspect.

## Acceptance Criteria

* Decide whether CI should run sbt without the thin client (for example `--client=false`, `sbt.server.forcestart`
  off, or `-batch` without a server), and measure the startup-time cost.
* On a timeout, capture diagnostics: a thread dump of the sbt server JVM, using its PID recorded from the sbt
  server's own files, not a pattern match.
* Add `timeout-minutes` to the osv-scanner `curl` download and `osv-scanner scan` steps.
* Record evidence from several CI runs.

## Driver constraints (binding for this run)

* osv-scanner step timeouts sized at 2-3x their measured duration.
* CI evidence gathered across several runs, one at a time; full logs kept for any failing run.
* Do not regress CI timing targets: backend median <= 5.5 min, e2e <= 7 min. HEL-1287 matrix + compile cache,
  HEL-1288 e2e sharding + fail-fast, HEL-1296 security gating must keep working.
* If dropping the thin client costs real time, escalate with the numbers (do not ship it silently).
* Never pkill/pgrep/killall/pattern-matched process selection; stop only recorded PIDs/PGIDs.
* Never bypass hooks. HEL-1341 may later touch ci.yml fork concurrency: keep edits to the sbt invocation,
  diagnostics and osv steps.
