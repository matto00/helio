# HEL-1468: sbt `testOnly` can exit 0 and print [success] while reporting "*** N TESTS FAILED ***": gates that trust the exit code can miss failures

## Description

Origin: HEL-1419's final skeptic, 2026-10-09, during a deliberate mutation run: `sbt testOnly …` in this repo exited 0
and printed `[success]` while the output contained `*** 7 TESTS FAILED ***`. Not yet reproduced by the driver. If real,
any gate (lane evaluators, mutation/red-first proofs, local scripts) that trusts sbt's exit code alone can certify a red
run as green, the exact evidence-shaped-non-evidence trap.

Priority: High. Labels: Follow-up, Bug. Related: HEL-1419, HEL-1018.

## Acceptance Criteria

- Reproduce deterministically: a throwaway failing test, `sbt testOnly <it>`, check `$?` and the output. Check
  `testOnly` vs `testFull`, the thin client (`sbt --client`) vs the batch launcher, and a server attached from another
  worktree (MISTAKES.md's existing sbt entry), with the sbt 2 test-result cache in play (HEL-1018: sbt 2 caches tests).
- Root-cause it (systematic-debugging law: probe first).
- Fix it (build setting, wrapper script, or the canonical invocation) so a failing test ALWAYS yields a non-zero exit
  on every documented path, with a red/green proof. Check whether CI's `scripts/ci-sbt.sh` path is affected (it must
  not be silently green).
- Add a MISTAKES.md entry, and update lane guidance (CON) to grep for `TESTS FAILED`/`*** FAILED` in addition to the
  exit code until fixed.

## Driver context (claims to verify)

- Report the exit code + key output line for each invocation path in a table (testOnly batch, testOnly default
  launcher, testFull, `sbt --client`, server attached across worktrees, CI's `scripts/ci-sbt.sh`).
- If the root cause is in sbt itself, a wrapper/guard plus documentation is acceptable: say so.
- CI must never be silently green on failures: check past backend shard logs (grep only, never print env).
- Throwaway failing tests are never committed; scratch copies, removed by exact path.

## Planning findings (orchestrator premise probe, 2026-10-09, sbt 2.0.9, worktree build)

- REPRODUCED. A spec with 40 plain failing assertions, `nice -n 19 sbt -batch -J-Xmx3g -Dsbt.server.autostart=false
  "testOnly <spec>"`, 6 runs: exit 0 in 4 (each printed `*** 40 TESTS FAILED ***`, then `No tests to run for Test /
  testSelected`, then `[success]`), exit 1 in 2. HEL-1419's exact M1 mutation: 2 of 5 runs exit 0. A spec with ONE
  failing test: 3 of 3 runs exit 1. Nondeterministic and payload-size dependent; independent of the test cache.
- Mechanism class (from sbt v2.0.9 source, `main-actions/.../ForkTests.scala`): forked tests report results to sbt via a
  `testEvents` JSON notification per suite; `React.apply` swallows any `NonFatal` while handling a notification, and
  `mainTestTask` builds the group's result from whatever events arrived -- an empty map is `TestResult.Passed`, and
  `TestResultLogger` then prints "No tests to run". The ScalaTest summary lines still arrive, so the log says FAILED
  while sbt's result says Passed. Not fixed in sbt v2.0.10 or develop (ForkTests/WorkerExchange unchanged).
- `testFull`, `test`(testQuick) and `testOnly` all run forked groups through the same `ForkTests` path.
- CI history (orchestrator, task 1.3 input): 120 green `backend` jobs across the 30 most recent green ci.yml runs,
  logs fetched with `gh api --allow-escape-sequences .../jobs/<id>/logs` (a first scan without that flag fetched
  nothing and read as clean -- discarded). Every job had a positive control (`Tests: succeeded` count > 0); zero jobs
  contained a ScalaTest failed/aborted summary, `*** FAILED ***`, `RUN ABORTED` or `No tests to run for`. Per-job counts:
  `ci-history-scan.txt` in this change dir.
