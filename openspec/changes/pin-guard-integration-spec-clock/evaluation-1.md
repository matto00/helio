## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `874f276b14717213e0443d641191089c8a1b856f` against live-resolved base `5ba82b39f5de50eb414b9f95f4f06bf4b89634cb`.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (pin `guardClock`): `PipelineRunGuardIntegrationSpec.scala:122-125` adds `PinnedGuardClock`
  (`2026-01-01T00:30:00Z`), and it is passed from both `newService` (:133) and `newGatedService` (:181). This is the
  HEL-1374/1439 pattern.
- AC2 (red first, then green):
  - `probe-red.txt:342-348` shows a 10s window on unchanged SystemClock wiring. sub1 and sub2 finished 1301/1215 ms
    before the boundary, and sub3 started 100 ms after it. The test failed with "expected Left(TooManyRequests), got
    Right". The dumped rows are `(2026-10-10 00:26:50, 2)` and `(2026-10-10 00:27:00, 1)`: two `window_start` values
    one window (10s) apart, each at or under limit 2. Both are real-date buckets, which proves SystemClock drove
    them. This meets C1's confirmation criterion. The evidence is self-authenticating (row content, not mtimes).
  - `probe-green.txt:211-217`: the same aimed boundary (sub3 starts at -100 ms) gives one row,
    `(2025-12-31 16:30:00 [PST] = 2026-01-01T00:30Z, 2)`, plus a rejection and a pass. The boundary really was crossed
    and the pinned bucket held.
- AC3 (loop judged by log): `loop-exit.txt` records exit codes only. The judgment comes from `loop.txt`, which uses
  pattern grep. I re-grepped the 21 local `loop-logs/iter-*.log` files myself:
  - 0 files match `TESTS FAILED|*** FAILED|RUN ABORTED`;
  - 21/21 contain `Tests: succeeded 10, failed 0`;
  - 21/21 contain `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, so the HEL-1468 guard ran.
  - Note: `loop-logs/` and `testfull.log` are gitignored (`.gitignore:27 *.log`), so the committed `loop.txt` summary
    has no committed backing logs. See the suggestions below.
- AC4 (sweep): my own grep of `backend/src/test` found the same results.
  - `pipelineRunGuardRepo =` appears in exactly 6 files: the target, the two precedents that already pass
    `guardClock`, `AutoRunGuardNoRetryStormSpec` (limit 0), and `FireTimeRunConfigGateSpec` (limit 1000).
  - The positional `Some((new PipelineRunGuardRepository(ctx), config))` at `PipelineRunServiceTerminalOrderingSpec:411`
    uses limit 1000 or 0.
  - `incrementRateIfUnderLimit` has no other direct test callers besides `PipelineRunGuardRepositorySpec`, which
    passes an explicit `now`.
  - `cleanupOldWindows` is only reached through `PipelineSchedulerService`, which this spec does not build. The
    pinned-literal safety claim holds.
  - The classifications in `files-modified.md` are correct and complete.
- Constraints: C1 is honored (see above). C2 is honored: `git diff BASE...HEAD -- '*.scala' | grep -c EmbeddedPostgres`
  = 0, and no probe edits were committed (the Scala diff contains only the clock, the assertion and the comment).
- Tasks: all 2.x/1.x items are marked done and match the diff. No production, schema or API change.

### Phase 2: Code Review — PASS
Issues: none blocking.

- Gates (my own fresh run, in WORKTREE_PATH): `nice -n 19 sbt -J-Xmx3g testFull` printed
  `Tests: succeeded 6537, failed 0, canceled 4`. `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`
  is present, and there are 0 matches for `TESTS FAILED` / `*** FAILED` / `RUN ABORTED`. All 10 tests of the target
  spec ran and passed. No sbt server was left behind (`project/target/active.json` is absent).
- Wiring-guard mutation (I ran this myself in a throwaway detached worktree at 874f276, removed afterwards): I deleted
  both `guardClock = PinnedGuardClock,` lines and ran `testOnly PipelineRunGuardIntegrationSpec`. Result: `*** FAILED
  *** 3321 was not equal to 1800 (PipelineRunGuardIntegrationSpec.scala:228)`, `Tests: succeeded 9, failed 1`.
  So the exact `retryAfterSeconds shouldBe 1800L` assertion is a real wiring guard: it fails whenever `guardClock` is
  dropped, except about 1/3600 of the time.
- Code quality: the imports are top-level (`Clock`, `Instant`), there are no inline FQNs, and the per-spec private
  clock follows existing convention. The stale HEL-1195 "no clock-injection seam" doc comment was correctly
  rewritten. The magic 1800 is explained inline.

### Phase 3: UI Review — N/A
Test-only backend change. No trigger paths were touched.

### Overall: PASS

### Non-blocking Suggestions
- Change-dir hygiene (requested judgment):
  - `testfull.done` is a committed 5-byte "done" sentinel with no evidentiary value. Remove it before archive/merge.
  - `probe-red.txt` (365 lines) and `probe-green.txt` (231 lines) are about 95% sbt/Flyway/EmbeddedPostgres noise with
    raw ANSI escapes. The load-bearing content is the about 10 `[probe]`/assertion/summary lines in each. Prefer
    trimming them to those excerpts, or a short `probe-report.md` (precedent:
    `archive/2026-07-18-fix-run-events-sse-500/probe-report.md`).
  - Committing evidence in the change dir is fine in principle. Committing raw transcripts is not.
  - `loop.txt` cites `loop-logs/*.log`, which are gitignored and will vanish with the worktree. Either persist them
    via `persist-evidence.sh` or state in `loop.txt` that the per-iteration logs are not retained.
- `PipelineRunGuardIntegrationSpec.scala:217`: the test name still reads "...+ a positive retryAfterSeconds", but it
  now asserts an exact 1800. Consider renaming it to "...+ retryAfterSeconds measured from the pinned guard clock".
- The probe source edits (temporary, uncommitted per C2) are not preserved anywhere. Only their output is. This is
  acceptable given the self-authenticating row dump, but a short note of what the probe changed (window shrunk to 10s,
  sleep-to-boundary, row dump) in the probe artifact would help a later reader.
