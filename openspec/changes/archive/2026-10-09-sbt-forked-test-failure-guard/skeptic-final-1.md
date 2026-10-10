## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `9dff11ce8a1b6d2192ac4605f48adac06ceef849` (016b6e034 implementation + merge of origin/main 6902b57f1).
Base resolved live: `resolve-review-base.sh` -> `6902b57f12a18042daf9b8e4984cc55b2011fc84`. No UI change (no `frontend/**`),
so the design-judgment step does not apply.

### What I verified (with evidence)

- **Cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/sbt-test-exit-code/hel-1468`.
- **Diff, read in full** (`git diff 6902b57f1...HEAD`): `backend/build.sbt` (+9), `backend/project/ScalaTestFailureGuard.scala`,
  `backend/project/ScalaTestSummaryGuard.scala`, `backend/src/test/scala/ScalaTestSummaryGuardSpec.scala`,
  `scripts/ci-sbt.sh` (+10, one block inside the `rc=0` path only), `scripts/ci-sbt.selftest.mjs` (+2 registration lines),
  `scripts/ci-sbt-selftest/log-scan.mjs` (new), `MISTAKES.md` (+35), change-dir artifacts. Matches Decisions 1-5:
  check before delegating, inherited logger wrapped (not a hard-coded Default), both `Test` and `Test/testFull` scopes,
  fail-closed on a summary without a `Tests:` line, no `Tests.Argument` added (C4), no disk state, sbt-free parser
  compiled into tests via `Test / unmanagedSources` like `DevEnv.scala`.
- **Core claim, fresh, my own scratch spec** (`backend/src/test/scala/com/helio/hel1468scratch/Hel1468SkepticFailSpec.scala`,
  40 failing assertions, written by me, never staged). Each run judged by exit + ScalaTest lines + project-path lines (C3):

  ```
  batch-1 rc=1 TESTSFAILED=1 noTests=0 success=0 guardSummary=1 guardRed=0 proj=3
  batch-2 rc=1 TESTSFAILED=1 noTests=1 success=0 guardSummary=1 guardRed=1 proj=2
  batch-3 rc=1 TESTSFAILED=1 noTests=1 success=0 guardSummary=1 guardRed=1 proj=2
  batch-4 rc=1 TESTSFAILED=1 noTests=1 success=0 guardSummary=1 guardRed=1 proj=2
  batch-5 rc=1 TESTSFAILED=1 noTests=0 success=0 guardSummary=1 guardRed=0 proj=2
  batch-6 rc=1 TESTSFAILED=1 noTests=1 success=0 guardSummary=1 guardRed=1 proj=2
  ci-1    rc=1 TESTSFAILED=1 noTests=0 success=0 guardSummary=1 guardRed=0 proj=2
  ci-2    rc=1 TESTSFAILED=1 noTests=0 success=0 guardSummary=1 guardRed=0 proj=2
  ci-3    rc=1 TESTSFAILED=1 noTests=1 success=0 guardSummary=1 guardRed=1 proj=2
  ci-4    rc=1 TESTSFAILED=1 noTests=1 success=0 guardSummary=1 guardRed=1 proj=2
  ci-5    rc=1 TESTSFAILED=1 noTests=0 success=0 guardSummary=1 guardRed=0 proj=2
  ci-6    rc=1 TESTSFAILED=1 noTests=1 success=0 guardSummary=1 guardRed=1 proj=2
  ```
  (`batch` = `nice -n 19 sbt -batch -J-Xmx3g -Dsbt.server.autostart=false "testOnly <spec>"`; `ci` =
  `scripts/ci-sbt.sh --deadline 900 --dir backend -- "testOnly <spec>"` with the same sbt flags.)
  **12 of 12 red, 0 exit-0 reds, 8 guard-only reds** (sbt printed `No tests to run for Test / testSelected`, i.e. lost
  the events, and the run still exited 1). Guard-only log excerpt (batch-2, ANSI stripped, line numbers of the log):
  `7: [info] Hel1468SkepticFailSpec:` ... `89: [info] [hel1468-guard] ScalaTest summary: failed=40 aborted=0 unreadable=0`,
  `94: [info] *** 40 TESTS FAILED ***`, `95: [info] No tests to run for Test / testSelected`,
  `96: [error] [hel1468-guard] ScalaTest reported 40 failed test(s), but sbt considered the run passed ...`,
  `97: [error] (Test / testSelected) sbt.TestsFailedException: Tests unsuccessful`. Project-path lines name this worktree.
  Without the guard those 8 runs are exactly the pre-fix exit-0 shape (matches the repro matrix's 52/72 and the mutation
  row in 3.4); I did not re-run the mutation myself.
- **testQuick after guard-only reds** (my own probe for a cache-poisoning hole: would sbt 2's test cache record a
  lost-event run as passed and skip the suite next time?): 4 runs of `testQuick <spec>` -> rc=1,1,1,1, each with
  `*** 40 TESTS FAILED ***`; 2 of 4 guard-only. The suite is re-run; no stale-pass hole.
- **Removed by exact path and green:** `rm -- .../hel1468scratch/Hel1468SkepticFailSpec.scala && rmdir -- .../hel1468scratch`;
  `git status --short` then lists only the untracked `evaluation-1.md`. Green run `testOnly ScalaTestSummaryGuardSpec
  DevEnvSpec` -> rc=0, `Tests: succeeded 15, failed 0`, `[hel1468-guard] ScalaTest summary: failed=0 aborted=0
  unreadable=0`, `[success]`. Green `ci-sbt.sh ... testOnly ScalaTestSummaryGuardSpec` -> rc=0, `Tests: succeeded 8,
  failed 0`, no `::error::`. That green run also follows the red runs in the same build: an earlier failure does not
  fail a later invocation (spec scenario 2).
- **Scope wiring:** `show` for `Test/testResultLogger`, `Test/testOnly/...`, `Test/testSelected/...`,
  `Test/testQuick/...`, `Test/testFull/...` -> all five print `hel1468-guard(Main(...))`, rc=0.
- **CI scan + HEL-1425 merge:** `node scripts/ci-sbt.selftest.mjs` -> all (a)-(h) HEL-1425 checks plus 9 new (i) checks
  `ok`, `all ci-sbt checks passed`, EXIT=0. The `ci-sbt.sh` diff against base is only the 10-line block inside
  `if [ "$rc" = 0 ]`. The script has no `set -e`/`pipefail` (only `set -u`), so a grep with no match cannot abort it.
  **Scan reverted** (scratch copy of `scripts/` with `ci-sbt.sh` replaced by `git show 6902b57f1:scripts/ci-sbt.sh`,
  confirmed identical by `diff`): the same selftest -> the 4 exit-1 (i) cases FAIL with `status 0`, all (a)-(h) still
  ok, `4 check(s) FAILED`, EXIT=1. The scan cases are red-first, and HEL-1425's behaviour is unchanged by the merge.
- **Commit hygiene:** `git log --format='%H%n%B' 6902b57f1..HEAD | grep -niE 'claude.ai|Claude-Session|session_'` ->
  no match (rc=1). `git diff --name-only 6902b57f1...HEAD | grep -i scratch` -> no match. No `hel1468scratch` path in
  any commit in the range.
- **AC trace:**
  1. Repro across paths with run counts: `repro-matrix.md` covers batch, default launcher, testQuick, `--client`,
     a cross-checkout server, `ci-sbt.sh` (cold and warm), and testFull, with counts. The cross-worktree attach claim is
     honestly recorded as not reproduced. My 12 fresh runs reproduce the lost-event shape (8 of 12).
  2. Root cause: shutdown-hook probe 6/6 exit 1 vs 4/6 baseline (repro-matrix 1.1). It points at a race with the
     fork's exit, the mechanism is from sbt's `ForkTests` source, and the defect is in sbt (wrapper accepted by the ticket).
  3. Fix, non-zero on every documented path: build-level guard on both logger scopes (my runs plus `show`); red/green
     re-proved above; CI `ci-sbt.sh` has the extra scan and the CI history was scanned (`ci-history-scan.txt`, 120 jobs
     with positive controls).
  4. MISTAKES.md entry: present (symptom, mechanism, guard, residual RUN ABORTED/concurrency risks, how to judge a
     run). The CON lane-guidance ticket is the orchestrator's Delivery item; it is not in this diff, as stated.
- **Iron Laws:** systematic-debugging is met by the probe-confirmed race (1.1) and the mutation proof that the guard
  is load-bearing (3.4: 4/10 exit 0 without the wrapper). Verification is met by the fresh runs above.
- **Gate-defect check (CON-160):** no evidence in this review rests on mtime ordering. Not applicable.

### Verdict: CONFIRM

### Non-blocking notes

- The guard's error message contains the literal `*** FAILED ***`, so a raw `grep -c '\*\*\* FAILED'` is +1 on
  guard-only reds. MISTAKES.md discloses this. A gate that counts that string should anchor on `^\[info\] - .* \*\*\*
  FAILED \*\*\*`.
- `show Test/testFull/testResultLogger` prints `hel1468-guard(Main(...))`, not a `SilentWhenNoTests` value, which
  differs slightly from design.md's Context bullet. The wiring itself is correct (wrapped in all five scopes). The
  executor's guard-only testFull run (repro-matrix) is the evidence that this scope throws. I did not re-run a full
  testFull (~9 min).
- The CON lane-guidance ticket still has to be filed at Delivery; the orchestrator should confirm it exists before merge.
