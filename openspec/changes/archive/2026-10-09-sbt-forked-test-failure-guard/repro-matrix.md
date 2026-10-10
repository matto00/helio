# HEL-1468 repro matrix (before the fix vs after the guard)

Machine: Arch, sbt 2.0.9 via the sbt-extras launcher (`command -v sbt` = `~/.local/bin/sbt`), Java 21. Every sbt run was
`nice -n 19` with `-J-Xmx3g`, one at a time, from this worktree's `backend/` (both project-path lines named this
worktree: `loading project definition from .../hel-1468/backend/project` and `set current project ... in build file:
.../hel-1468/backend/`; the thin-client runs print them only on the run that starts the server, hence `projPathLines`
0-1 in the raw rows). Scratch specs (uncommitted, removed by exact path before the commit): a 40-failure spec
(`Hel1468ScratchManyFailSpec`, `*** 40 TESTS FAILED ***`) and a 1-failure spec. Raw rows: one line per run in
`hel1468-exec-matrix.tsv` plus logs `hel1468-exec-<label>-<cache>-<n>.log` in the session scratchpad.

Judged per C3 by exit code AND the ScalaTest `Tests:`/`*** N TESTS FAILED ***` lines AND `[success]` /
`No tests to run` (= sbt lost the group's events). "cold" = a changed scratch source before each run (recompile, test
cache invalid); "warm" = no change. Exit-0 count = a red run that exited 0.

## 1.1 Discriminating probe

A scratch spec registering a JVM shutdown hook that sleeps 2 s (delays the fork's exit), the same 40 failures, warm,
6 runs: **6 of 6 exit 1, 0 lost-event runs** (baseline for the same spec without the hook, 4 of 6 exit 0 in the
orchestrator's planning runs and 4 of 6 / 4 of 6 in the cold/warm rows below). Delaying the fork's exit removes the
loss, which points at a race between the fork's exit and sbt's processing of the `testEvents` backlog, not at a
swallowed handler. Hook spec removed afterwards.

## 1.2 / 3.2 Before vs after, 6 runs per cell (testFull: see its own section)

| Path                                                     | cache | before: exit 0 of 6 (all printed `*** 40 TESTS FAILED ***`) | after: exit 0 of 6 | after: runs where sbt lost the events and the guard alone made it red |
| -------------------------------------------------------- | ----- | ----------------------------------------------------------- | ------------------ | --------------------------------------------------------------------- |
| `sbt -batch testOnly <spec>`                             | cold  | 4                                                           | 0                  | 4                                                                     |
| `sbt -batch testOnly <spec>`                             | warm  | 4                                                           | 0                  | 4                                                                     |
| default launcher `sbt testOnly <spec>` (no `-batch`)     | cold  | 2                                                           | 0                  | 1                                                                     |
| default launcher `sbt testOnly <spec>` (no `-batch`)     | warm  | 2                                                           | 0                  | 3                                                                     |
| `testQuick <spec>` (`test`'s task)                       | cold  | 4                                                           | 0                  | 0                                                                     |
| `testQuick <spec>`                                       | warm  | 5                                                           | 0                  | 5                                                                     |
| `sbt --client testOnly` (thin client, server from this tree) | cold  | 6                                                       | 0                  | 4                                                                     |
| `sbt --client testOnly`                                  | warm  | 4                                                           | 0                  | 0                                                                     |
| `sbt --client`, another checkout's server also running   | cold  | 6                                                           | 0                  | 1                                                                     |
| `sbt --client`, another checkout's server also running   | warm  | 5                                                           | 0                  | 5                                                                     |
| `scripts/ci-sbt.sh` (`--server`, foreground)             | cold  | 5                                                           | 0                  | 5                                                                     |
| `scripts/ci-sbt.sh`                                      | warm  | 5                                                           | 0                  | 5                                                                     |

Total: before 52 of 72 red runs exited 0 (`[success]`, `No tests to run`); after 0 of 72, and in every after-run the log
carried `[hel1468-guard] ScalaTest summary: failed=40 ...` (guardRed = 72 of 72) and the scratch suite's header
`Hel1468ScratchManyFailSpec:` followed by 40 `*** FAILED ***` lines. The "guard alone" column counts after-runs that
printed `No tests to run` (sbt's own result was `Passed`) and still exited 1, with the `[error] [hel1468-guard]
ScalaTest reported 40 failed test(s) ...` line; the other runs were red by sbt's own logger too (the guard logs first
either way). Total guard-only catches: 37 of 72 (the remainder, 35, were runs where sbt kept the events and would
have failed anyway).

Notes on the paths:

- **Thin client / cross-checkout server.** `sbt --client` works with the sbt-extras launcher here (it prints
  `entering thin client - BEEP WHIRR`, starts a background server). With a server for a second disposable checkout
  (`git worktree add --detach` under the scratchpad, scratch specs copied in, removed afterwards) already running, the
  client in this tree did NOT attach to it: it started its own server and both project-path lines named this worktree
  (`hel1468-exec-cross-probe.log`). The HEL-1285 attach claim is therefore still not reproduced; it is unrelated to
  the lost-events cause and the project-path check stays the safeguard.
- **`test` (full)** was not run separately: `test` and `testQuick` are the same task, covered by the `testQuick` rows.
- **Warm `testQuick` over unchanged sources** prints no ScalaTest summary only when nothing is selected/cached; with
  failing tests it always reruns, so every row above has a summary.

## testFull (each run ~8-9 min, so 3 before + 3 after + variants instead of 6)

Scratch specs present (40 + 1 failing; `Tests: succeeded 6526/6534, failed 41, canceled 4`):

| Run                                          | exit | key line                                                      |
| -------------------------------------------- | ---- | ------------------------------------------------------------- |
| before r1, r2, r3                            | 1,1,1 | `*** 41 TESTS FAILED ***`, `Tests: ... failed 41`, no `[success]` |
| after r1, r2, r3                             | 1,1,1 | same, plus `[hel1468-guard] ScalaTest summary: failed=41 ...`  |
| after, `HEL924_TEST_GROUP_CONCURRENCY=2`     | 1    | same, guard line `failed=41`                                   |
| guard-only (sbt's own logger replaced by `TestResultLogger.Null`, scratch present) | 1 | `[error] [hel1468-guard] ScalaTest reported 41 failed test(s)` and no sbt summary |
| scratch removed (final build), no failures   | 0    | `Tests: succeeded 6533, failed 0, canceled 4`, `[hel1468-guard] ... failed=0 aborted=0`, `[success]` |

**Honest limit:** the loss never occurred in testFull in the 3 before-runs (nor in the 4 after-runs), so no
exit-0-before for testFull was observed here; the pattern in the rest of the matrix is that it is a race
(about half of the runs for a single forked group). The guard-only run is what proves the `Test / testFull /
testResultLogger` wiring turns a failed summary into a non-zero exit independently of sbt's own result.
`show Test/testResultLogger`, `Test/testOnly/...`, `Test/testSelected/...`, `Test/testQuick/...`, `Test/testFull/...` all
print `hel1468-guard(Main(...))` (log `hel1468-exec-show.log`).

## 3.4 Mutation: remove the wrapper from both scopes

- `-batch testOnly <spec>` warm, 10 runs: **4 exit 0** (`No tests to run`, `[success]`), 6 exit 1; `guardRed` 0 of 10.
- Restored the wrapper: back to 0 of 72 (above). Scratch-only variant (`wrap(TestResultLogger.Null)`): 8 of 8 `testOnly`
  runs exit 1 via the guard alone, and a passing spec (`DevEnvSpec`) exits 0.
- `scripts/ci-sbt.sh` with the wrapper removed, 8 runs: sbt exited 0 in 4 (`success=1`) and the log scan turned all 4 into
  exit 1 (`::error::ci-sbt: sbt exited 0 but its log carries a ScalaTest failure line ("*** 40 TESTS FAILED ***") ...`);
  the other 4 were red by sbt itself.

## 3.5 Concurrency (`HEL924_TEST_GROUP_CONCURRENCY=2`)

12 `testOnly` runs of two specs (one slow 40-failure spec, instantiated after a 4 s sleep, in one forked group; one
passing spec in another group), two name pairs so both start orders occurred (failing suite instantiated first in 8
of 12 runs, second in 4). Every run: exit 1, `[hel1468-guard] ... failed=40`, `Tests: succeeded 1, failed 40`. No
under-count and no miss in 12 runs. The design's theoretical risk (ScalaTest joins only the last-started group's
reader thread) was not observed; MISTAKES.md records it as unobserved.

## 3.1 / 3.3 / 2.x verification records

- `ScalaTestSummaryGuardSpec`: 8 tests, `Tests: succeeded 8, failed 0`, exit 0 (`sbt -batch testOnly ScalaTestSummaryGuardSpec`).
  Fixtures are verbatim `Run completed in ...` summary texts from real runs (all passed, 1 failed, 40 failed, 1 suite
  aborted, produced by a scratch spec whose constructor throws); the ANSI form wraps the real banner in the SGR
  codes of CI job 114064543620; the unreadable form is the real 40-failure text with its `Tests:` line removed.
- `npm run selftest:ci-sbt`: all checks passed including the new (i) group (plain, ANSI-wrapped `TEST FAILED`, `SUITE
  ABORTED`, `RUN ABORTED` with real ESC bytes -> exit 1; the unstripped regex does NOT match them; clean log -> 0; sbt
  non-zero -> status unchanged 7). With the `ci-sbt.sh` change reverted the same selftest fails the 4 exit-1 cases
  (`status 0`), so the cases are red-first.
- The ANSI strip is the widened `s/\x1b\[[0-9;?]*[A-Za-z]//g` (skeptic r6 suggestion, adopted) in both `ci-sbt.sh`
  and the parser.

## 1.3 CI history

Done by the orchestrator before this phase (`ci-history-scan.txt`, ticket.md Planning findings): 120 green `backend`
jobs over the 30 most recent green ci.yml runs, each with a positive control (`Tests: succeeded` count > 0); zero
contained a ScalaTest failed/aborted summary, `*** FAILED ***`, `RUN ABORTED` or `No tests to run for`. Not redone.
