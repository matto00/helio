## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed `f78ec5865c6ba2669ac3c4488d1ddaf4873fa619`. The live base is `bcb0e891923094c1a1e85ecc053f30a73ee6d70f`, and the cycle-2 delta is `a827bbd2d..f78ec5865`. Each item was verified against the commit, not against the executor's summary.

### Phase 1: Spec Review — PASS
All five cycle-1 change requests are resolved.

- **CR1, evidence committed: resolved.**
  - All 10 `loop-*.log` files are tracked. This includes both `*-fire-broken.log` files.
  - Also tracked: `red-3.1-3.2.log`, `mutation-3.1a-*`, `mutation-3.4-*`, `seed-S4.log`, `teardown.log`, `container-up.log`, `migrate.log`, `setup.log`, `green-hooks.log` and `green-targeted.log`.
  - Two new mutation logs and `green-recover-test.log` were added.
  - `testFull.log` was replaced by the 4-line `testFull.summary.txt`.
  - In total, 31 files (386 KB) are tracked under the change dir's `evidence/`, and none are left ignored or untracked.
  - The helper scripts `rep.sh`, `m.sh`, `main-runs*.sh` and `branch-runs.sh` now resolve paths through `dirname "$0"` and `git rev-parse --show-toplevel`. None of them contains an absolute `/home/...` path.
- **CR2, overstatement: resolved.**
  - Section 1 now states that the bound includes the tick's own work, "which can include contention from a concurrent pass". It says retention's DURATION contributes zero to the tick, and its contention does not.
  - The "unchanged" row is replaced by a row saying the first pass ran longer while overlapping scheduled runs.
- **CR3, S2: resolved.** Section 4 now labels S2 as not seeded or measured, and gives the reason.
- **CR4, seed header: resolved.**
  - Line 1 now names the source file. Line 9 reads "pre-HEL-1435".
  - The usage line is now `-f hel1477-history-seed.sql`, and the migrate step is now `RetentionTickMeasure migrate`.
- **CR5, guard label: resolved.**
  - The test is now commented as "A GUARD, not a red", and the comment names its mutation (drop the `andThen` release).
  - `evidence/mutation-5-andThen-release-dropped.log` shows that test failing, along with the other four (failed=5).
- The constraints C1-C7 are still honored. The production-code delta in this cycle is a single comment in `OutputHistoryRetentionService.scala`, and no retention default changed.
- There are no unrelated diffs. The executor committed `evaluation-1.md` into the change dir, which is the normal place for it.

### Phase 2: Code Review — PASS
I ran these gates fresh:

- **Backend tests.** `nice -n 19 sbt -J-Xmx3g testFull` exited 0. The output contains `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`.
  - The suite reported 6813 succeeded, 0 failed, 4 canceled. That is two more than cycle 1, which matches the two new recover tests, and both of them ran.
  - Memory before the run was 47.4 GB available, and no other testFull was running. The sbt process exited at the end of the run.
  - The full log is at `backend/target/hel1477-eval/testFull-2.log`, which is gitignored.
- **Repo checks.** check:repo-integrity, check:scala-quality, check:openspec, check:spec-structure, check:test-temp-dir-hygiene, check:no-credential-leak and format:check all exited 0.
- **Frontend.** No frontend files changed.

The new scheduler-level recover tests in `PipelineSchedulerServiceDetachedRetentionSpec`:

- **Seam and coverage.**
  - The tests attach an appender to the `PipelineSchedulerService` logger. This is the right logger because `log` is `getLogger(getClass)` and the class is final.
  - The appender completes a Promise when it sees the ERROR "output history retention failed" event. The test then awaits that Promise with a bounded await, with no sleeps (C2).
  - Both the failed-future case and the synchronous-throw case are covered. The synchronous throw is a by-name `throw` that `Future.delegate` turns into a failed future.
- **Red.** `evidence/mutation-scheduler-recover-removed.log` shows both tests failing with TimeoutException when the recover is removed, and the existing detached test still passing. With the recover in place, `green-recover-test.log` shows 3 of 3 passing.
- **Other changes.**
  - The defensive-catch comment is accurate.
  - The `RetentionTickMeasure` doc tweak is accurate.
  - There are no inline FQNs, and the new imports are used.

### Phase 3: UI Review — N/A
Nothing changed under `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`.

### Overall: PASS

### Non-blocking Suggestions
- In `measurements.md` section 1, the phrase "about 5-20% longer" is slightly loose. The paired reps (branch r1-r3 against main r2-r4) give +1%, +21% and +8%. "1-21%" would be exact.
