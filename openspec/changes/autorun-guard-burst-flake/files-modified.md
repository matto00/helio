- `backend/src/test/scala/com/helio/services/pipelines/AutoRunGuardBurstProofSpec.scala` — pass the test's own FakeClock (clockA/clockB in 3.2) as `guardClock` to `PipelineRunService` so rate-window bucketing is deterministic, independent of the real wall clock.
- `openspec/changes/autorun-guard-burst-flake/**` — change artifacts and this evidence record.

## Evidence

### 1.1 CI history
- PR #883 (HEL-1390, branch bug/chart-aggregate-tail-slots/HEL-1390): CI run 37912176680 attempt 1, job `backend (0)` failed (attempt 2 passed). Failing test is **3.1** (the single-instance one, "six independently-fired writes (each its own debounce window) ..."), `4 was not equal to 3 (AutoRunGuardBurstProofSpec.scala:202)`, i.e. `runCount(pid) shouldBe 3`. 3.2 was not the failing test.
- Wall times from the CI log: spec started 09:39:57.2Z, the two guard rejections (fires 5 and 6) logged 09:40:01.23 and 09:40:01.55, failure 09:40:01.6. The burst straddled the real 09:40:00 five-minute boundary: consistent with 3 admitted in the 09:35 bucket + 1 in 09:40 (corroboration only; CI logs carry no window rows).
- Other occurrences: the 40 most recent failed CI runs were listed (scratch list hel1439-failed-runs.txt) but only this run was inspected in depth; no other occurrence was confirmed (not exhaustively searched).

### 1.2 Probe 1 (deciding; temporary diagnostics + in-test aim to a real epoch%300 boundary, guard wiring UNCHANGED; attempt 1 of 6)
Aim: sleep until boundary-1500ms (env HEL1439_LEAD_MS, probe only, not committed). Test 3.1 finished entirely before the boundary (mid-window run PASSING: 6 fires 04:59:58.74..04:59:59.69, runs 1,2,3,3,3,3, window rows `[(21:55:00-07, 3)]`). Test 3.2 started 04:59:59.77, boundary 05:00:00 fell mid-burst:
```
fire 1 start 04:59:59.8187 end 04:59:59.9199 runs=1
fire 2 start 04:59:59.9574 end 05:00:00.0581 runs=2
fire 3 start 05:00:00.1012 end 05:00:00.1863 runs=3
fire 4 start 05:00:00.2272 end 05:00:00.3508 runs=4
fire 5 start 05:00:00.4015 end 05:00:00.4863 runs=4
fire 6 start 05:00:00.5408 end 05:00:00.6161 runs=4
PROBE window rows: Vector((2026-10-09 21:55:00-07,1), (2026-10-09 22:00:00-07,3))
[info] - should six independently-fired writes split across TWO PipelineSchedulerService instances ... *** FAILED ***
[info]   4 was not equal to 3 (AutoRunGuardBurstProofSpec.scala:261)
```
Two `window_start` rows exactly 300s apart (21:55 and 22:00 -07), each <=3 (1 and 3), summing to 4 = observed count. C1 criteria met on attempt 1. Full transcript: scratchpad hel1439-p1-RED-keep.log (not committed). 3.3 (guard off) passed with 6 as expected.

### 1.3 Probe 2
Not run (illustration only per C1; Probe 1 is the confirmation).

### 2.2 GREEN: same forced-boundary aiming against the fixed spec (HEL1439_LEAD_MS=350), `Tests: succeeded 3, failed 0`
Boundary crossed mid-burst in all three tests: 3.1 fires 1 at 05:09:59.83, fires 2-6 at 05:10:00.04..05:10:00.44; 3.2 fires 1-3 before and fires 4-6 at 05:15:00.02..05:15:00.17; 3.3 fires 1-4 before, 5-6 after 05:20:00. Rate-window rows with the fake clock: single row `2025-12-31 16:00:00-08` count 3 for 3.1 and 3.2 (exactly one bucket despite the real boundary).
(3.2 fire times: 05:14:59.68, .78, .90 | 05:15:00.02, .10, .17.)

### 2.3 30x loop (fixed spec, `nice -n 19`, -J-Xmx3g, one sbt at a time, 3 `nice -n 19` busy-loop shells PIDs 1514475/1514476/1514477 killed by PID afterwards)
Every iteration's log: no `TESTS FAILED`/`*** FAILED`/`RUN ABORTED`, and contains `Tests: succeeded 3, failed 0`; the three test names present in the log (verified e.g. iteration 17). Summary:
```
iter 1..30 exit=0 failmarkers=clean succeeded3=1   (30/30)
```

### 2.4 Follow-up candidates (NOT changed here; other guard-wired specs on default SystemClock guardClock)
- `PipelineRunGuardIntegrationSpec.scala` — exact budgets of 1-2 per window with `rateWindowSeconds = 3600` (lines ~216-276, also 60s windows with large limits at 304-367): a real hour boundary between two submissions in one test would split the bucket (probability ~ test duration / 3600s; its comment at ~198 shows partial awareness).
- `AutoRunGuardNoRetryStormSpec.scala` — limit 0: immune (always denied).
- `FireTimeRunConfigGateSpec.scala`, `PipelineRunServiceTerminalOrderingSpec.scala`, `ApiRoutesPipelineRunGuardSpec.scala` — limits 100-1000: a bucket split cannot change an admission outcome; FireTimeRunConfigGateSpec sums `request_count` across buckets so it is also boundary-insensitive.
- `SseReconnectGapProbeSpec.scala` — uses production-default limits (10/60s) with 2 runs: boundary-insensitive.
- Already pinned: `DatasetWriteAutoRunEndToEndSpec.scala` (HEL-1374).
