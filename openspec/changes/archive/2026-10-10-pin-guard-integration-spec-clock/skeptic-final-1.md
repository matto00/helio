## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `874f276b14717213e0443d641191089c8a1b856f` against the live-resolved base `5ba82b39f5de50eb414b9f95f4f06bf4b89634cb` (`resolve-review-base.sh`, exit 0). The change is test-only: one Scala spec plus the change-dir artifacts. There is no UI, so step 4 is N/A.

### What I verified (with evidence)

- **Diff (ground truth).** In `PipelineRunGuardIntegrationSpec.scala`:
  - adds top-level imports `com.helio.domain.util.Clock` and `java.time.Instant`;
  - adds a private `PinnedGuardClock` fixed at `2026-01-01T00:30:00Z`;
  - passes `guardClock = PinnedGuardClock` in both `newService` (:133) and `newGatedService` (:181);
  - rewrites the stale HEL-1195 "no clock-injection seam" comment;
  - changes `retryAfterSeconds should be > 0L` to `shouldBe 1800L` (:228).

  Nothing else changed.
- **AC1 (pin guardClock): met.** `PipelineRunExecutor.scala:129` feeds `guardClock.now()` into `incrementRateIfUnderLimit`. `PipelineRunGuardRepository.scala:49` computes `retryAfter = windowStart + w - now`. For 00:30:00 with w=3600 that is 1800, so the literal is correct. `cleanupOldWindows` is not reachable from this spec, so the pinned literal (a 2026-01-01 instant) is safe.
- **AC2 red (C1): genuine real-wall-clock red.** `probe-red.txt:342-348`:
  - sub1 and sub2 finished 1301/1215 ms before a real 10s boundary, and sub3 started 100 ms after it;
  - the test failed with `expected Left(TooManyRequests), got Right(...)` at `PipelineRunGuardIntegrationSpec.scala:191`. That line number matches the pre-fix file layout (the fixed file's helper is at ~:203), which corroborates unchanged wiring;
  - the rows are `(00:26:50, 2)` and `(00:27:00, 1)`: two real-date `window_start` buckets exactly one window apart, each within the limit.

  Only SystemClock can produce real-date buckets, so this is self-authenticating content, not mtime ordering.
- **AC2 green: the boundary really was crossed.** `probe-green.txt:211-230`: sub3 started at msToBoundary=-100, there is a single row `(2025-12-31 16:30:00 PST = 2026-01-01T00:30Z, 2)`, `retryAfterSeconds=10` (pinned instant on a 10s grid), and 1 test passed with `[hel1468-guard] failed=0`.
- **Mutation (my own run, reverted).** I deleted both `guardClock = PinnedGuardClock,` lines and ran `nice -n 19 sbt -J-Xmx3g -batch -Dsbt.server.autostart=false "testOnly ...PipelineRunGuardIntegrationSpec"` at 08:07:20Z. Result: `*** FAILED *** 3150 was not equal to 1800 (PipelineRunGuardIntegrationSpec.scala:228)`, `Tests: succeeded 9, failed 1`, exit 1. 3150 is exactly 3600 − 450 s past the hour. The project-path line names this worktree. I reverted with `git checkout --`, and `git diff --stat` is empty afterwards.
- **Green after the revert (my own run).** Same command, exit 0: `Total number of tests run: 10`, `Tests: succeeded 10, failed 0`, `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`. Tests actually executed; this was not a cache replay.
- **AC3 (loop judged by log).** I grepped all 21 `loop-logs/iter-*.log` myself:
  - 0 matches for `TESTS FAILED|*** FAILED|RUN ABORTED` in every file;
  - each file has exactly 1 `Tests: succeeded 10, failed 0`;
  - each file has exactly 1 `[hel1468-guard] ScalaTest summary: failed=0 aborted=0`.

  The logs contain the real per-test lines and EmbeddedPostgres start/shutdown, so these were real executions. `testfull.log` (untracked) shows `Tests: succeeded 6537, failed 0, canceled 4` with `[hel1468-guard] failed=0`.
- **C2.** The diff touches no `EmbeddedPostgres` line (`:59` is unchanged), and no probe edits are committed.
- **AC4 / D4 sweep.**
  - `grep pipelineRunGuardRepo =` matches exactly 6 files. The 4 files other than the target and the 2 precedents are classified correctly: `AutoRunGuardNoRetryStorm` (limit 0), `FireTimeRunConfigGate` (1000), and the positional `TerminalOrdering` (1000/0).
  - `PipelineRunGuardRepositorySpec` passes an explicit `now`.
  - `PipelineAutoRunDebounceRepositorySpec` only mentions the guard spec in a comment.
  - Route-level consumers that expect a 429 are a different class and are not exposed: `ApiRoutesPipelineRunGuardSpec` (source-fetch) and `ProductEventRoutesSpec` use `InMemoryRateLimiter`, a first-request-anchored window (`InMemoryRateLimiter.scala:30-38`), with a pipeline-run limit of 100.
  - The sweep is complete for the ticket's class: an epoch-aligned pipeline-run guard with no clock.
- **OpenSpec / repo hygiene, run fresh.** All exit 0:
  - `check:openspec`: "openspec/ is clean"; the change is "complete but in flight";
  - `check:spec-structure`, `check:repo-integrity`, `check:no-credential-leak` (0 violations), `check:scala-quality`, `check:test-temp-dir-hygiene`, `format:check`.
- **Evidence hygiene.**
  - **Committed:** `probe-red.txt`, `probe-green.txt`, `loop.txt`, `loop-exit.txt`, `testfull.done`.
  - **Untracked:**
    - `loop-logs/*.log` and `testfull.log` are ignored via `.gitignore:27 *.log`;
    - `workflow-state.md` is ignored via `.git/info/exclude`;
    - `evaluation-1.md` is untracked.

  Nothing committed trips any hygiene check. `.txt` evidence has archive precedent (e.g. `archive/2026-10-08-fix-rate-window-boundary-flake/evidence`).
- I treated the evaluator's report as claims. Its mutation result (3321 ≠ 1800) is consistent with mine (3150 ≠ 1800) at a different wall time, as expected.

### Verdict: CONFIRM

### Non-blocking notes

- `testfull.done` is a committed 5-byte `done\n` sentinel with no evidential value. Drop it before merge.
- `loop-exit.txt` commits exit codes only, which the ticket says are not the judge. `loop.txt` is the real by-log summary, but the logs behind it are gitignored and will disappear with the worktree. Either persist them, or say in `loop.txt` that they are not retained.
- `probe-red.txt` and `probe-green.txt` are about 95% build, Flyway and ANSI noise. Trimming them to the `[probe]`, assertion and summary lines, plus a 3-line note on what the temporary probe changed (10s window, sleep-to-boundary, row dump), would make them readable at archive time.
- `PipelineRunGuardIntegrationSpec.scala:217`: the test title still says "a positive retryAfterSeconds", but it now asserts exactly 1800.
- Outside this ticket's class, unverified: `ClaudeRoutesChatGateSpec` and `AssistantConversationRoutesSpec` assert a beta per-UTC-day chat cap through `ChatAccessService`, which is built with no visible clock argument. If that day bucket is wall-clock UTC, a run crossing UTC midnight could split it. Consider a separate audit ticket. It is not required here.
