## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `2baefd86d1d4fd5d97594c6302fc88a1cea6d0ed`. The base was resolved live with `resolve-review-base.sh`, giving
`5ba82b39f5de50eb414b9f95f4f06bf4b89634cb` (exit 0). The cwd guard printed `READY`.

### What I verified (with evidence)

- **Scope of the diff.** `git diff 5ba82b39f...HEAD -- backend` touches only
  `PipelineRunGuardIntegrationSpec.scala`. It is a test-only change, with no production code and no UI.
- **AC1: guardClock is pinned.**
  - `PinnedGuardClock` is a `Clock` returning `2026-01-01T00:30:00Z`.
  - It is passed as `guardClock` in both `newService` (:133) and `newGatedService` (:181).
  - `PipelineRunExecutor.scala:129` feeds `guardClock.now()` into `incrementRateIfUnderLimit`, so the pin reaches the
    bucketing seam.
  - The spec says a literal is safe because `cleanupOldWindows` never runs. I checked this claim:
    - the only production caller is `PipelineSchedulerService:104`;
    - the spec builds no scheduler;
    - the spec uses its own `EmbeddedPostgres`, not the shared dev DB.
    So no external process can purge the pinned 2026-01-01 rows.
- **AC2: red first, then green.**
  - `probe-red.txt`:
    - sub1 and sub2 finished 1301 and 1215 ms before a real 10s boundary;
    - sub3 started 100 ms after it;
    - there are two `window_start` rows exactly one window apart: `(00:26:50, 2)` and `(00:27:00, 1)`;
    - the result was "expected Left(TooManyRequests), got Right";
    - the guard line reads `[hel1468-guard] failed=1`.
  - `probe-green.txt`:
    - the same boundary crossing (sub3 at -100 ms);
    - a single row `2025-12-31 16:30 PST = 2026-01-01T00:30Z` with count 2;
    - `retryAfterSeconds=10`;
    - the guard line reads `failed=0`.
  - The timestamps are internally consistent: the rows are displayed in the JVM's local zone, which is PDT for the red
    probe and PST for the January pinned instant.
  - I did not re-run the red probe myself. It is a temporary edit.
- **The 1800 wiring guard is real (my own mutation).**
  - I removed both `guardClock = PinnedGuardClock` lines and ran
    `nice -n 19 sbt -J-Xmx3g -batch "testOnly ...PipelineRunGuardIntegrationSpec"`.
  - Result: `1799 was not equal to 1800 (PipelineRunGuardIntegrationSpec.scala:230)`, `[hel1468-guard] failed=1`,
    `Tests: succeeded 9, failed 1`.
  - The run happened at about 08:30 UTC, which is why the value was so close to 1800. The probability of SystemClock
    hitting exactly 1800 is about 1/3600.
  - I reverted the mutation from a byte copy. `git diff --quiet` is clean afterwards.
- **AC3: judged by log.** I ran the spec green on unchanged HEAD:
  - 0 matches for `*** FAILED|TESTS FAILED|RUN ABORTED`;
  - `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`;
  - `Tests: succeeded 10, failed 0`;
  - the renamed test is listed as passing.
  - I used `loop.txt` (20/20 iterations clean, judged by grep) only as a claim. Its logs are gitignored, and my own run
    corroborates it.
- **AC4: D4 sweep, independently re-derived.** I grepped `backend/src/test` for `new PipelineRunService`,
  `PipelineRunGuardConfig(` and `incrementRateIfUnderLimit`. The only specs with exhaustible budgets (limit 1 to 3)
  are:
  - `AutoRunGuardBurstProofSpec`, which already passes `guardClock`;
  - `DatasetWriteAutoRunEndToEndSpec:206` (tightGuard limit 1), which already pins `FakeClock` (HEL-1374);
  - this spec.
  
  The rest are not boundary-sensitive:
  - the limit-0 cases are denied in every bucket;
  - the limit-1000 and limit-100 cases, and the defaults from `fromEnv`, never expect a rejection, and a split only
    adds headroom;
  - `ApiRoutesPipelineRunGuardSpec` tests the source-fetch `InMemoryRateLimiter` (first-request-anchored), which is a
    different class.
  
  The sweep is complete and its conclusion holds.
- **C2.** `git diff base...HEAD -- backend | grep -i embedded` returns nothing, so no EmbeddedPostgres startup line
  changed.
- **The title change is name-only.** `git diff 874f276b1 HEAD -- backend` is one hunk at :218, and it changes only the
  test-name string.
- **Housekeeping.**
  - My first sbt invocation accidentally started a thin-client server.
  - I shut it down with `sbt --client shutdown`.
  - The one remaining sbt java process (pid 3303031, a `runMain` started by another lane) is not mine, and I left it
    alone.

### Verdict: CONFIRM

### Non-blocking notes
- `files-modified.md` still lists `loop-logs/` and `loop-exit.txt` as change artifacts. The second was removed in
  2baefd86d and the first is gitignored. This is stale wording only.
- `evaluation-2.md` is untracked in the worktree and is not committed on the branch. The orchestrator should decide
  whether it is meant to ship with the change dir, as `evaluation-1.md` does.
