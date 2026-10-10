## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 467caa46a191873faf06d64976bb5939bb86d96b. The planning artifacts are uncommitted in the worktree.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/autorun-guard-burst-flake/HEL-1439`.
- **Round-1 CR1 (gate on Probe 1) is addressed.** design.md D1.1 makes Probe 1 the deciding probe and caps it at 6
  boundary-aligned attempts. If those fail, the executor stops and escalates without shipping D2. D1.2 labels Probe 2
  as illustration only. tasks.md 1.2/1.3 and Standing Constraint C1 say the same.
- **Round-1 CR2 (self-authenticating red) is addressed.** D1.1 and D4 require a temporary diagnostic that logs each
  fire's `Instant.now()` and dumps the `pipeline_run_rate_window` rows. The red must show two distinct
  `window_start` values.
- **Round-1 non-blocking notes are folded in.** D2 covers the clockA/clockB ordering, D4 names the background load
  (3 `nice -n 19` busy-loop shells, killed by PID), and task 1.1 records which test failed.
- **Hypothesis mechanics, re-derived from live code:**
  - `AutoRunGuardBurstProofSpec.scala:141-148`: `newRunService` passes no `guardClock`.
    `PipelineRunService.scala:106` defaults it to `SystemClock`.
  - `PipelineRunExecutor.scala:129` buckets admissions by `guardClock.now()`.
    `PipelineRunGuardRepository.scala:32-35` floors to 300s buckets.
  - The UPSERT at `PipelineRunGuardRepository.scala:52-58` is gated by `WHERE request_count < limit`, so one bucket
    holds at most 3 admissions.
  - `PipelineAutoRunDebounceFirer.scala` (`fireAutoRun`, `TooManyRequests` branch) logs a guard-rejected fire and
    drops it. The debounce claim is released, and nothing retries the fire.
- **D2 is deterministic.** The fake fire times run from t0+3s to t0+53s (`driveIndependentBursts`, lines 163-180),
  so they all fall in `[2026-01-01T00:00Z, 00:05Z)`. `newScheduler` (lines 150-155) passes no guard repo, so the
  `cleanupOldWindows` branch at `PipelineSchedulerService.scala:~100-108` never runs and cannot delete the fake-dated
  rows.
- **D3:** 3.3 uses `withGuard = false`, so `guardClock` has no effect there.

### Verdict: REFUTE

One defect remains, and it sits in the acceptance signal of the deciding probe. C1 makes that probe binding, and it
is capped at 6 attempts.

### Change Requests

1. **Widen Probe 1's RED criterion to match the real failure arithmetic (design.md D1.1 "RED is confirmed only
   when…", D4 RED, tasks.md 1.2, C1).**
   - Rejected fires are dropped, not retried, and the cap is 3 per bucket. So if a real wall-clock boundary falls
     after fire *j* of the six, the run count is `min(j,3) + min(6-j,3)`:
     - j=1 gives 4
     - j=2 gives 5
     - j=3 gives 6
     - j=4 gives 5
     - j=5 gives 4
   - Only a boundary right after fire 1 or fire 5 produces the literal "4 was not equal to 3" that the artifacts
     require. That is 2 of the 5 inter-fire gaps, each about 200-300 ms of wall time. A boundary anywhere else
     produces "5 was not equal to 3" or "6 was not equal to 3" with the same two-bucket mechanism.
   - As written, an executor who lands a 3+2 or 3+3 split can read it as "not RED". That burns the 6-attempt budget
     and leads to an escalation even though the hypothesis was confirmed.
   - Revise the criterion to: the spec fails with `runCount` (or `rateWindowRequestCount`) **> 3**, and the dumped
     rows for that test's user show two distinct `window_start` values one window apart. Each row must have
     `request_count` <= 3, and the rows must sum to the observed count.
   - Note that exactly 4 matches the CI observation, but 5 or 6 is equally confirmatory. Under this criterion a
     count > 3 with a single `window_start` is not RED. It would refute the hypothesis and calls for
     escalation, which is a useful falsifier to state explicitly.

### Non-blocking notes

- With the 1-2 s burst and sbt/JVM startup jitter, it may be easier to aim Probe 1 at a test-internal anchor: for
  example, have the temporary diagnostic sleep until just before the boundary at the start of 3.1's body, rather
  than timing sbt launch from outside. This is a temporary, uncommitted probe edit that leaves the guard wiring
  unchanged, so it stays within C1. Spell it out if the executor takes this route.
- "Four implies two buckets" in design.md Context is correct but incomplete. More than three implies two buckets.
  Aligning the wording with CR1 is enough.
