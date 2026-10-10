## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `016b6e034847e5f150b69579b16e031de9829346` (base `bc39b79c1f1e6c6d6c8c29397a6c3f8e2c9ec69b`, resolved live
via `resolve-review-base.sh`). Spawn-cwd guard: `READY`.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (reproduce, per-path table, cache cold/warm, client, cross-checkout server, ci-sbt.sh): `repro-matrix.md` has a
  6-runs-per-cell before/after table for every path the ticket lists, plus testFull (3+3 and variants) and a stated
  limit (the loss was never observed in testFull before the fix; the guard-only `TestResultLogger.Null` run covers
  the testFull wiring instead). The cross-checkout attach is reported as not reproduced, not glossed over.
- AC2 (root cause, probe first): probe 1.1 (a fork shutdown hook sleeping 2 s gave 6/6 exit 1) points to a race. The
  sbt-source mechanism is in design.md. The sbt-side root cause is documented as the reason for a wrapper.
- AC3 (fix on every documented path, red/green proof, CI path): the build-level `TestResultLogger` wrapper covers
  `Test / testResultLogger` (testOnly/testSelected/testQuick inherit it) and `Test / testFull / testResultLogger`.
  `ci-sbt.sh` gets a separate post-exit log scan. Both are verified (see Phase 2).
- AC4 (MISTAKES.md entry, CON lane guidance): the MISTAKES.md entry is present. design.md Decision 6 gives the
  CON ticket to the orchestrator at Delivery. **The orchestrator must file it before delivery.**
- Tasks: every task is ticked and matches the diff. No scope creep: there are no production code, schema or
  `.husky/**` changes.
- Constraints: C1 holds (no scratch spec in the tree; `git status` is clean after my runs too). C2 holds (both the
  executor's and mine). C3 holds (the matrix judges runs by exit code, `Tests:`/banner lines and project-path lines).
  C4 holds (`build.sbt` adds no `Tests.Argument`; the guard keeps no state and has a fail-closed `Unreadable`
  branch).

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran myself (all run in WORKTREE_PATH, sbt with `nice -n 19 -J-Xmx3g`, `-batch -Dsbt.server.autostart=false`,
one at a time, after checking `free -g`):

| Check | Result |
| --- | --- |
| `testOnly ScalaTestSummaryGuardSpec DevEnvSpec` + `show` of the logger in 4 scopes | exit 0. `Tests: succeeded 15, failed 0`, `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`. `Test`, `Test/testFull`, `Test/testOnly` and `Test/testQuick` `testResultLogger` all show `hel1468-guard(Main(...))`. |
| My own 40-failure scratch spec (`backend/src/test/scala/com/helio/hel1468scratch/Hel1468EvalManyFailSpec.scala`), `-batch testOnly`, 6 runs | **6/6 exit 1.** All 6 printed `*** 40 TESTS FAILED ***` and the guard summary line `failed=40`, and none printed `[success]`. **Guard-only reds: runs 2, 3 and 6.** Each printed `No tests to run for Test / testSelected` (sbt lost the events), then `[error] [hel1468-guard] ScalaTest reported 40 failed test(s), but sbt considered the run passed ...`, and still exited 1. Runs 1, 4 and 5 were red from sbt's own logger as well. The suite header and 40 `*** FAILED ***` lines were in every log, and the project-path lines named this worktree. |
| `scripts/ci-sbt.sh --deadline 500 -- testOnly <scratch>`, 4 runs (`SBT_CMD="nice -n 19 sbt -J-Xmx3g"`) | 4/4 exit 1. In runs 3 and 4 sbt lost the events and the build guard caught them. sbt never exited 0, so the log scan was not triggered live; its behaviour is covered by the selftest and by the executor's mutation runs (repro-matrix 3.4). |
| Zero selected tests (`testOnly DevEnvSpec -- -z zzNoSuch...`) | exit 0. `Total number of tests run: 0`, `Tests: succeeded 0, failed 0`, guard `failed=0`, `[success]`. |
| No ScalaTest summary (warm `testQuick DevEnvSpec` twice) | exit 0, `No tests to run for Test / testQuick`, no guard line: no verdict, as designed. |
| Scratch removed by exact path (`rm` of the file, `rmdir` of `hel1468scratch/`), then `testOnly ScalaTestSummaryGuardSpec` | exit 0, `Tests: succeeded 8, failed 0`. The failed runs just before it do not fail it (no carried state). |
| `testOnly com.helio.NoSuchSpec...` | exit 1 from sbt's own "No tests match the patterns" error; no guard line. This is sbt's existing behaviour and not part of this change. |
| `npm run selftest:ci-sbt` | exit 0, `all ci-sbt checks passed`, including all 9 new `(i)` checks |
| `npm run format:check` / `npm run lint` / `npm run check:scala-quality` | 0 / 0 / 0 (soft warnings only, all in files this change does not touch) |

I did not run a full `testFull`. The wrapper is a logger-only change. The `testFull` scope wiring is confirmed by
`show` and by the executor's guard-only run. A green run only adds one info line, and the executor recorded a green
testFull (`Tests: succeeded 6533, failed 0` with the guard line). CI will run it again on the PR.

Fail-closed behaviour: tested at unit level (`ScalaTestSummaryGuardSpec` "no readable Tests: line fails closed",
using the real 40-failure text with its `Tests:` line removed). I could not produce it live without changing the
code, which is acceptable for a format-drift branch.

Code review:
- `ScalaTestFailureGuard.scala:14-21`: the check is computed and logged before delegating. The inner logger always
  runs, and the guard throws only if the inner logger did not, so the message "sbt considered the run passed" is
  accurate by construction. `toString` makes `show` readable.
- `ScalaTestSummaryGuard.scala`: a pure parser with no sbt dependency. It strips ANSI codes and reads the
  `Tests:`/`Suites:`/banner lines. A failure banner without a `Tests:` line is `Unreadable`, so it fails closed. No
  magic values; types are sealed.
- `ci-sbt.sh:63-72`: the script runs with `set -u` only (no `-e`/`pipefail`), so a grep with no match does not abort
  the script. The ANSI strip is applied before the anchored patterns. Behaviour is unchanged when sbt exits non-zero.
- `build.sbt` comments explain why the build has to work around sbt; there are no inline FQNs or dead code.

### Phase 3: UI Review — N/A
Backend/tooling only. No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes. The change's
spec delta is under `openspec/changes/`, not `openspec/specs/`.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `MISTAKES.md` symptom paragraph says these paths "each exited 0 in roughly half of their runs". The matrix shows
  52 of 72 overall (about 72%), with cells ranging from 2/6 to 6/6. Consider "in a third to all of their runs
  (52 of 72 overall)".
- The guard's own error line contains the literal `*** FAILED ***`, so a naive `grep -c '\*\*\* FAILED \*\*\*'` count
  is one higher on guard-only reds (I saw 41 against 40). This is harmless, but worth knowing for anyone who counts
  failure lines.
- Delivery item (not the executor's): file the CON lane-guidance ticket required by AC4 / design Decision 6.
- A merge conflict with HEL-1425 (on main) in `scripts/ci-sbt.sh` / `scripts/ci-sbt.selftest.mjs` is expected. The
  merger should rerun `npm run selftest:ci-sbt` after resolving it.
