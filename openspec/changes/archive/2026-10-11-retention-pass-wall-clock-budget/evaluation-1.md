## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed: `a827bbd2df4cad3c1d5caa4dac0e9db10e877417` against live base `bcb0e891923094c1a1e85ecc053f30a73ee6d70f` (resolve-review-base.sh).

### Phase 1: Spec Review — FAIL

The code meets every AC. The AC's proof requirement ("Prove the bound on the S4 prod-class proxy") is not met in what is
committed, and the measurement write-up overstates one claim.

- AC1 (detach / bound): met in code. `PipelineSchedulerService.tick` starts the pass and drops it from the zip
  (`PipelineSchedulerService.scala:120-129`). The in-flight guard in `OutputHistoryRetentionService.purgeIfDue` takes
  the CAS before `claim`, releases on the not-due path and on a synchronous throw, and releases a started pass via
  `andThen` on the WHOLE future (history, payload and the `nextDue` rewrite). That ordering satisfies C7.
  **Proof: not committed.** See CR1.
- AC2 (`thinAndPurge` to test support): met. `grep -rn thinAndPurge backend/src/main/scala` returns nothing. The only
  remaining mention is the V120 migration comment, which is left alone on purpose (design D4, Flyway checksum).
  `RetentionDrain` is built only on public `thinPass`.
- AC3 polish:
  - The row-limit test now asserts the exact composition at limits 40 and 20. Its mutation red is recorded.
  - The archived measurements.md has the `work_mem` sentence, and the uncited "colder clone" parenthetical is dropped.
- CLAUDE.md row: updated. No new env var, and no retention default changed (C4).
- Spec delta: consistent with the base requirement. `openspec validate --strict` passes.
- Constraints:
  - C1, C2, C5 and C7 are honored.
  - C3: honored. Container `hel1477-pg` on port 55477, and the teardown log shows 0 containers and 0 volumes remaining.
  - C4: honored.
  - C6 is honored except for a disclosed guard test (CR5).
- Task 1.2 says "Seed S4 (and S2)". S2 was never seeded or measured, and measurements.md section 4 does not label this
  deviation (CR3).
- Scope creep or unrelated diffs: none. Every changed file is in the ticket or design scope.

### Phase 2: Code Review — FAIL (evidence/doc defects only; the code itself is sound)

Gates, run fresh by me:

- `nice -n 19 sbt -J-Xmx3g testFull`: exit 0. `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`,
  and "Tests: succeeded 6811, failed 0, canceled 4". All four affected specs executed, so this was not a cached no-op.
  The log is in `backend/target/hel1477-eval/testFull.log`, which is gitignored.
- `npm run` check:repo-integrity, check:scala-quality, check:openspec, check:spec-structure,
  check:test-temp-dir-hygiene, check:no-credential-leak and format:check: all exit 0.
- No frontend files changed, so the frontend lint/test/build gates were not triggered.

Executor claims, verified against the raw logs:

- "S4 prod-io-base fire delay: 90.7 s on main, 25.2 s on the branch": **true.** Main gave 90744 / 85488 / 88346 ms
  (r2-r4). The branch gave 25221 / 25202 / 25202 ms. The main tick awaited the pass, which matches the old code's
  behaviour and is self-authenticating content evidence: tick 1 `dur_ms` is the pass `dur_ms` to the ms.
- "Red runs in evidence/red-3.1-3.2.log": **true but uncommitted.**
  - The log shows 5 failed and 1 passed.
  - The DetachedRetention spec timed out at line 35.
  - InFlight test 1 timed out at line 79, because the unguarded second call started a second pass.
  - **The `*.log` is gitignored (`.gitignore:27`), so it is not in the commit** (CR1).
- "testFull 6811/0": **true.** The executor's log and my own run agree.
- "Sync-throw test not red; a guard": **true.** On main there is no guard to wedge, so it passes trivially (CR5).
- "3.1a's red is a mutation": **true.** On main, 3.1a fails for the busy-call reason, not the not-due path.
  `mutation-3.1a-not-due-leaks-guard.log` shows only 3.1a failing (timeout) under a not-due-leaks-guard mutation.
- "The outer-recover test lost its error-log assertion": **inaccurate.** The base version of "complete the tick when the
  retention service itself fails (outer recover)" never had a log assertion (`git show bcb0e8919:...MaintenanceHooksSpec.scala`).
  The diff does not touch it, so nothing was lost.
  - The two `historyFailureCase` tests KEEP their ERROR-log assertion. They now await the captured pass first, which is
    deterministic because the log is emitted in `.recover` before the `andThen` release. They attach the appender to
    the subclass logger, which is correct because the service uses `getLogger(getClass)`. Both pass.
  - Residual gap (non-blocking): deleting the scheduler-level `.recover` (`PipelineSchedulerService.scala:125`) would
    fail no test, since the failed future is discarded. The service's inner recovers already catch every repository
    failure, so the outer one only catches a service bug. The base had no such assertion either.

Code checks:

- Canonical code quality: no inline FQNs, no `any`-style escape hatches, file sizes are fine, and check:scala-quality passes.
- Correctness of the guard: correct. `andThen` returns the releasing future, so a caller observing completion
  observes the release, and the in-flight spec relies on this.
- Synchronous throw from the repository: `Future.delegate` turns it into a failure, which is recovered to `Failed`.
- `catch` in `purgeIfDue`: covers a throw from `claim`/`runPass` setup. It is effectively unreachable and untested
  (non-blocking).
- Tests: meaningful. They use Promise seams with no sleeps or `eventually`. The new spec uses
  `VerifiedEmbeddedPostgres.start`. The row-limit test fails under the row-limit-ignored mutation (log recorded).
- `RetentionTickMeasure`: **test sources only.** It is an `object` with `main` (not a Suite) under `src/test`, so it is
  never on the production classpath and never run by testFull.
  - **It refuses non-scratch URLs.** `require(args(1) == "jdbc:postgresql://127.0.0.1:55477/helio_hel1477_scratch")`
    runs before any connection or Flyway call, the refusal is recorded in `evidence/refusal-test.txt`, and it reads no
    env or `.env`.
  - Its `Thread.sleep` is in the hand-run driver loop (actor emulation), not in a test, so C2 does not apply.
- `backend/scripts/perf`: **safe.**
  - `hel1477-container.sh` only `rm -f`s and creates the exact name `hel1477-pg` / volume `hel1477-pgdata`, binds
    `127.0.0.1:55477`, and uses trust auth only on loopback. It is identical to the merged `hel1435-container.sh`
    except for names and port.
  - `hel1477-history-seed.sql` sets `ON_ERROR_STOP` and then runs a `current_database()` guard before its
    `TRUNCATE ... CASCADE` / DROP INDEX. The refusal is recorded in `evidence/seed-refusal-test.txt`.
  - However, its header is stale after the copy (CR4). It is also a 370-line verbatim copy of
    `history-retention-batched-measure.sql` that differs only in the DB name and port (DRY, non-blocking).

Evidence size:

- Committed evidence is only six small helper scripts and two refusal transcripts (under 2 KB).
- Uncommitted, gitignored logs are 10.46 MB, of which `testFull.log` is 10.16 MB. Everything except testFull.log is
  about 0.3 MB, which is reasonable to commit; the HEL-1435 archive precedent commits 11 MB across 254 files. Do not
  commit the 10 MB testFull.log raw.

### Phase 3: UI Review — N/A

There are no changes under `frontend/**`, `backend/.../ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`. The spec
delta lives under `openspec/changes/`, and the change has no API or UI effect.

### Overall: FAIL

### Change Requests

1. **Commit the raw evidence that measurements.md cites.**
   - `measurements.md:3` says "All numbers are from raw logs under `evidence/`", and `RetentionTickMeasure.scala:25` says
     the output is "committed raw under `evidence/`". But every `*.log` is gitignored and absent from `a827bbd2d`, so
     the AC's S4 proof would vanish with the worktree.
   - `git add -f` the following: `loop-*.log` (all 10, including the two `*-fire-broken.log` that section 4 cites),
     `red-3.1-3.2.log`, `mutation-3.1a-not-due-leaks-guard.log`, `mutation-3.4-row-limit-ignored.log`, `seed-S4.log`,
     `teardown.log`, `container-up.log`, `migrate.log`, `setup.log`, `green-hooks.log` and `green-targeted.log`
     (about 0.3 MB in total).
   - For `testFull.log`, commit a trimmed summary (the `[hel1468-guard]` line plus the Tests/elapsed lines), or none,
     not the 10 MB file.
   - In the same change, fix the committed helpers. `evidence/main-runs.sh`, `main-runs2.sh`, `branch-runs.sh` and
     `rep.sh` (`R=`) call `$R/rep.sh` / `$R/m.sh` under `/home/matt/Development/helio/.concertino/runs/HEL-1477`,
     which is outside the repo. `m.sh` and `rep.sh` also hard-code the worktree path. Make them reference their
     sibling copies in `evidence/` (or a relative path), or state in measurements.md that they are a record of the
     commands, not runnable as committed.
2. **Correct the overstatement in measurements.md section 1.**
   - "Retention contributes zero" and "Pass wall time (unchanged by the change)" are contradicted by the logs and by
     section 3:
     - The branch ticks that overlapped the first pass took up to 4778 ms (r3 n=3), against at most 169 ms idle,
       because a concurrent pass slows the run the tick awaits.
     - The branch's first pass took 66.0 / 73.0 / 68.0 s against 65.5 / 60.2 / 63.1 s on main.
   - Restate it as follows: retention's DURATION contributes zero to the tick; its contention inflated the tick's own
     work to at most 4.8 s, against 0.17 s idle, in these runs; and the first pass ran about 5-20% longer while
     overlapping runs.
   - Keep the bound as "tick interval + the tick's own work (which can include contention)".
3. **Label the S2 deviation.** Task 1.2 says "Seed S4 (and S2)", but measurements.md section 4 lists only the
   profile, repetition, lock-skip and run-duration deviations. Add one line saying S2 was not run, and why.
4. **Fix the stale header in `backend/scripts/perf/hel1477-history-seed.sql`.**
   - Line 9 reads "pre-HEL-1477 (reused from HEL-1435)", a sed artifact; it should say pre-HEL-1435.
   - Line 13's usage line runs `-f history-retention-batched-measure.sql`, which is the other file and refuses this
     DB. It should be `-f hel1477-history-seed.sql`.
   - Line 8 refers to `HistoryThinMeasure migrate`, but this change's migrate step is `RetentionTickMeasure migrate`.
5. **Label the guard test (C6).** `OutputHistoryRetentionInFlightSpec.scala`'s "release the guard when the repository
   throws synchronously" cannot be red on the unfixed code, because there is no guard there. Add a one-line comment in
   the test saying it is a guard, not a red. Either name a mutation that fails it (for example, dropping the `andThen`
   release) and record that mutation's log, or state that it shares its red with the failed-future test.

### Non-blocking Suggestions

- Add a deterministic assertion for the scheduler-level `.recover` log at `PipelineSchedulerService.scala:125`. For
  example, inject a logger appender and await a Promise completed from within a capturing subclass. Today that
  `.recover` can be deleted without failing any test.
- Instead of a 370-line verbatim copy, consider parameterizing the existing `history-retention-batched-measure.sql`
  guard. The precedent is a copy, so this is not required.
- The `catch` branch in `purgeIfDue` is effectively unreachable (`claim` is pure atomics, and `runPass` setup is inside
  `Future.delegate`). A short comment saying it is defensive would help the next reader.
