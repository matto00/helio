## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 467caa46a191873faf06d64976bb5939bb86d96b (planning artifacts uncommitted in the worktree).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=bug/autorun-guard-burst-flake/HEL-1439`.
- **Ticket ACs** (Linear HEL-1439, matches ticket.md): probe-confirmed root cause (reproduce under load or forced
  window boundary, no retries); fix the time dependence; red + green + a 30x loop under `nice -n 19`, <=4 workers.
  All three ACs map to tasks (1.2/1.3 → AC1, 2.1 → AC2, 1.2/2.2/2.3 → AC3). No scope drift; `skip_specs: true` is
  right for a test-only change.
- **Hypothesis mechanics hold against live code:**
  - `AutoRunGuardBurstProofSpec.scala:141-148` `newRunService` passes no `guardClock`; `PipelineRunService.scala:106`
    defaults it to `SystemClock`.
  - `PipelineRunExecutor.scala:129` buckets the guard with `guardClock.now()`;
    `PipelineRunGuardRepository.scala:32-35` `bucketStart` floors epoch seconds to the window (300s here).
  - `PipelineRunGuardRepository.scala:52-58`: the single-statement UPSERT `... WHERE request_count < $limit` means
    4 admissions in ONE (user, window_start) bucket is impossible. So "4 was not equal to 3" (3.1 or 3.2) needs
    either two buckets or a submit path that skips the guard. I checked the alternatives: the debounce firer
    (`PipelineAutoRunDebounceFirer.scala:84`) fires through `PipelineRunService.submit` → `executeRun`, so every
    fire is guarded. The stale-claim reclaim needs 300 fake seconds and the test spans 53. Double-claims in 3.2
    are still bounded per bucket. Each test seeds a fresh random user, so rate rows don't leak across tests.
    By elimination, a wall-clock bucket split is the only remaining mechanism. The design states the same
    reasoning.
- **D2 fix is deterministic:** the fake fire times are t0+3, t0+13, ..., t0+53 (`driveIndependentBursts`,
  spacing 10, debounce 2+1). With the FakeClock as `guardClock`, all six land in bucket
  `[2026-01-01T00:00:00Z, 00:05:00Z)` whatever the wall clock or load. `DatasetWriteAutoRunEndToEndSpec.scala:137-142`
  already uses this exact seam (HEL-1374), so the pattern exists and compiles today.
- **D2's `cleanupOldWindows` concern, settled from code:** `newScheduler` (spec lines 150-155) does not pass
  `pipelineRunGuardRepo`, so `PipelineSchedulerService.scala:102-108` skips cleanup entirely. Fake 2026-01-01
  rows cannot be swept mid-test. This hazard would only become real if the executor wired the guard repo into
  the scheduler, and they must not. Task 1.4 only has to record this.
- **D3:** 3.3 passes `withGuard = false`, so `guardClock` has no effect there.

### Verdict: REFUTE

The diagnosis and the fix are sound. The defect is in the probe plan's falsifiability, which is the thing this
ticket's AC1 exists to enforce.

### Change Requests

1. **Gate on Probe 1, not on "neither" (design.md D1, last paragraph; tasks.md 1.2/1.3).** Probe 2 makes the
   guard clock jump one full window between admissions 3 and 4, then expects >3 runs. That is the guard's
   intended behaviour across windows, so Probe 2 passes no matter what caused the CI failure. It cannot refute
   the hypothesis. As written ("If neither reproduces, STOP"), a successful Probe 2 alone lets the executor ship
   D2 on an unconfirmed hypothesis. Revise D1 so that:
   - Probe 1 (real wall-clock boundary, UNMODIFIED guard wiring) is the required confirmation.
   - Probe 2 is labelled a mechanism illustration, not confirmation.
   - If Probe 1 does not reproduce after a stated number of boundary-aligned attempts (pick a number), the
     executor stops and escalates. It must not ship D2 on Probe 2 alone.
2. **Make Probe 1's red self-authenticating (design.md D1 / D4 RED, tasks.md 1.2).** "4 was not equal to 3"
   alone does not show WHY there were four. Require the RED transcript to include the
   `pipeline_run_rate_window` rows for the test's user: `SELECT window_start, request_count ...`, dumped by a
   temporary, uncommitted diagnostic print in the probe run. These rows must show two distinct `window_start`
   values that straddle the boundary (e.g. 3 + 1). Also require each fire's wall-clock `Instant.now()` to be
   logged next to it. This replaces "the timing looked right" with content evidence, per the evidence
   discipline's preference for self-authenticating proof over timing inference.

### Non-blocking notes

- 3.2 builds `runServiceA`/`runServiceB` (spec lines 224-225) before `fannedClock` exists (line 232). Pass
  `clockA`/`clockB` (always equal to the fanned value), or reorder the construction. Either way works; just
  don't write code that references `fannedClock` before it is defined.
- Probe 1 alignment: the 3.1 burst takes only a second or two of wall time, so the boundary has to fall inside
  one test's six fires, not just somewhere in the JVM run. The temporary per-fire timestamp log (CR 2) is the
  practical way to tune N.
- 2.3 "alongside other load" is vague. Name the load used (e.g. a concurrent `stress-ng`/second sbt test at
  nice 19) so the loop is reproducible.
- Task 1.1 should record which test (3.1 vs 3.2) failed in PR #883's CI log, if the log is still retrievable.
