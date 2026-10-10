## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 467caa46a191873faf06d64976bb5939bb86d96b. The change dir is untracked, so the artifacts were reviewed as they are on disk.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/autorun-guard-burst-flake/HEL-1439`.
- **Hypothesis wiring matches the live code:**
  - `AutoRunGuardBurstProofSpec.scala:141-148` (`newRunService`) passes no `guardClock`.
  - `PipelineRunService.scala:106` declares `guardClock: Clock = SystemClock`, and line 151 threads it into `PipelineRunExecutor`.
  - `PipelineRunExecutor.scala:129` calls `incrementRateIfUnderLimit(..., guardClock.now())`.
  - `PipelineRunGuardRepository.scala:32-36` sets `bucketStart` to epoch-aligned `(s / w) * w`.
  - The UPSERT at lines 53-58 is atomic per `(user_id, window_start)` with `WHERE request_count < limit`.
  - So more than 3 admissions requires at least two buckets. The design's mechanism is sound.
- **Probe 1 count arithmetic:** `PipelineAutoRunDebounceFirer.scala:45-90` releases a guard-rejected claim and logs it. It does not retry. So `min(j,3)+min(6-j,3)` is correct. The widened RED criterion is a valid and falsifiable test of the hypothesis: count > 3, exactly two `window_start` values 300s apart, each <= 3, summing to the count. A single `window_start` refutes it and escalates. This closes round 2's CR1.
- **D2 fake timeline:** fires land at t0 + i*10 + 3 for i = 0..5, which is 3..53s. All of these fall inside the bucket `[2026-01-01T00:00:00Z, +300s)`, so the claim holds.
- **3.2 construction order:** `clockA`/`clockB` are declared at lines 220-221, before `runServiceA`/`runServiceB` at 224-225, so passing them works. The fanned `set` moves both clocks together (line 233).
- **D2's `cleanupOldWindows` claim:**
  - Cleanup runs only when the scheduler's `pipelineRunGuardRepo` (`PipelineSchedulerService.scala:36`, default null) is non-null (lines 102-108).
  - `newScheduler` (spec lines 150-155) does not pass it.
- **D3 / 3.3:** with the guard repo null, the clock is never consulted for admission. The existing falsifiability note stays accurate.
- **Coverage of the acceptance criteria:**
  - Probe-first root cause, no retries: D1 and tasks 1.2/1.3. Non-goals forbid retries and widening the window.
  - Fix the time dependence: D2 / task 2.1.
  - Red/green: D4 and tasks 1.2/2.2.
  - 30x loop under `nice -n 19` with <= 4 workers, judged green by log grep (HEL-1468): task 2.3 and C1.
- **No scope drift:** the change is one test file, and the similar specs are enumerated as follow-ups only (task 2.4).
- **No placeholders, and no contradictions** between proposal, design and tasks.

### Verdict: CONFIRM

### Non-blocking notes

- The design.md Context still says "Four implies two buckets". More than three is the accurate statement, and D1 already uses it. This is cosmetic.
- Probe 1 aiming can mean a sleep of up to 300s per attempt. Budget the wall time and keep the 600000 ms Bash timeout in mind (run it in the background if needed).
- Task 2.2's GREEN is meaningful only if the wrapper still forces the real wall-clock boundary inside the burst. The executor should log per-fire wall times in 2.2 too, to show the boundary was actually crossed while the run count stayed at 3.
