## Context

`AutoRunGuardBurstProofSpec` (HEL-1097, last touched by HEL-1384) drives six independently-fired debounce windows
through `PipelineSchedulerService.tick()` with a `FakeClock` starting at `2026-01-01T00:00:00Z`, against a guard
budget of `rateLimitPerWindow = 3`, `rateWindowSeconds = 300`, and asserts `runCount(pid) == 3` and
`SUM(pipeline_run_rate_window.request_count) == 3`.

`newRunService` constructs `PipelineRunService` WITHOUT `guardClock`, so it defaults to `SystemClock`
(`PipelineRunService.scala:106`). `PipelineRunExecutor` calls
`pipelineRunGuardRepo.incrementRateIfUnderLimit(user, limit, windowSeconds, guardClock.now())`, which buckets by
`bucketStart(now, windowSeconds)` -- i.e. wall-clock-aligned 5-minute buckets. The scheduler's FakeClock only
governs debounce due-ness; admission bucketing follows real time.

The guard's own UPSERT (`INSERT ... ON CONFLICT DO UPDATE ... WHERE request_count < limit`) is atomic per bucket, so
more than three admissions with a budget of three are impossible inside ONE bucket. More than three implies two buckets: the test's
six fires straddled a real :x0/:x5 minute boundary. The run spans several seconds (more under CI load), so the hit
probability per run is roughly test-duration / 300s -- consistent with "seen once, passed on re-run".

HEL-1374 fixed the identical class of flake in `DatasetWriteAutoRunEndToEndSpec` by passing a pinned `guardClock`.

## Goals / Non-Goals

**Goals:** a probe that reproduces "4 was not equal to 3" on the UNMODIFIED spec; a deterministic fix; red/green and
a 30x by-log-green loop under load.

**Non-Goals:** production changes (unless the probe refutes the hypothesis and shows a real race); other specs.

## Decisions

### D1. Probe before fix (systematic-debugging law)

1. **Probe 1 -- the deciding probe (forced real wall-clock boundary, guard wiring UNCHANGED).** Add a temporary,
   uncommitted diagnostic print to the spec that logs the real `Instant.now()` of each fire and, after each test,
   the test user's `pipeline_run_rate_window` rows (`window_start`, `request_count`). Start the spec via a wrapper
   that sleeps until ~N seconds before the next `epoch % 300 == 0`, with N tuned from the logged per-fire times so
   the boundary falls INSIDE one test's six fires (they take ~1-2s). Budget: at most **6 boundary-aligned attempts**.
   Aiming may be done inside the test (a temporary sleep before the first fire until just before the boundary) --
   still real wall clock, guard wiring unchanged. A rejected fire is dropped, not retried, so a boundary after fire j
   gives `min(j,3) + min(6-j,3)` runs (4,5,6,5,4 for j=1..5); the literal "4 was not equal to 3" is only the j=1/5
   case. RED is confirmed when the run count (or rate-window count) is **greater than 3** AND the dumped rows show
   exactly two `window_start` values one window (300s) apart, each `request_count <= 3`, summing to the observed
   count. A count above 3 with only ONE `window_start` REFUTES the hypothesis (stop and escalate). Also show one
   mid-window-started run passing. If 6 attempts do not reproduce, STOP and escalate with the transcripts -- do not
   ship D2.
2. **Probe 2 -- illustration only, NOT confirmation (temporary, not committed).** A guardClock that jumps one window
   between admissions 3 and 4 yields >3 runs. This is the guard's intended per-window behaviour, so it passes
   regardless of the CI cause; it only illustrates the mechanism and can never by itself justify D2.

### D2. Fix: drive the guard with the test's own deterministic clock

Pass `guardClock` into `newRunService` and give it the same FakeClock the scheduler uses (3.1, 3.3). In 3.2 the run
services are built before `fannedClock` exists: pass `clockA`/`clockB` (which move together) or reorder construction. The fake time spans `t0+3s .. t0+53s` inside the single bucket
`[00:00:00, 00:05:00)`, so all six fires land in one window deterministically, independent of wall clock or load.

Alternative considered: a separate pinned guard clock (HEL-1374 style). Rejected as second-best here because this
spec already owns a fake timeline; one clock for both debounce and guard is the more faithful model of production,
where both read the same time. Either is acceptable if the executor finds a concrete reason (e.g. `cleanupOldWindows`
interaction) -- record it.

`cleanupOldWindows` cannot interfere: `newScheduler` passes no guard repo, so the cleanup branch
(`PipelineSchedulerService.scala:102-108`) never runs in this spec (verified at the design gate).

### D3. Keep the RED case (3.3) meaningful

3.3 must still produce 6 runs with the guard omitted; passing the clock there is harmless but keep its falsifiability
note accurate.

### D4. Red/green evidence

- RED: probe 1 on the unmodified spec (real transcript: failing assertion line, per-fire wall times, and the
  `pipeline_run_rate_window` rows showing two `window_start` values).
- GREEN: the same forced-boundary wrapper against the fixed spec passes (it would have failed before).
- LOOP: 30 iterations of the fixed spec under `nice -n 19`, <=4 workers, `-J-Xmx3g`, alongside named background load
  (3 `nice -n 19` busy-loop shells, PIDs recorded and killed by PID afterwards -- never pkill); each
  iteration judged green by its LOG (no `TESTS FAILED`/`*** FAILED`/`RUN ABORTED`, and the spec's 3 tests reported
  passed), never by exit code alone (HEL-1468).

## Risks / Trade-offs

- [Probe 1 timing is fiddly] -> probe 2 is deterministic; both together confirm cause and mechanism.
- [Similar specs share the pattern] -> enumerate guard-wired specs still on `SystemClock` with exact budget
  assertions; report as follow-ups, do not widen scope.
- [CI-history claim unverified] -> search recent failed CI runs' logs for other occurrences and report findings.

## Planner Notes

- Self-approved: test-only fix, `skip_specs: true`, no escalation needed (no new dependency/API/architecture).
- The driver's "rate window rolling over" suspicion is treated as a hypothesis until D1 confirms it.
