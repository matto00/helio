## Context

- `PipelineRunService.scala:106` declares `guardClock: Clock = SystemClock`; `PipelineRunExecutor` passes
  `guardClock.now()` to `PipelineRunGuardRepository.incrementRateIfUnderLimit`, which buckets by epoch-aligned
  `bucketStart(now, windowSeconds)` and admits via an atomic per-bucket UPSERT (`WHERE request_count < limit`).
- `PipelineRunGuardIntegrationSpec.newService` (line ~115) and `newGatedService` (line ~162) omit `guardClock`. Rate
  tests (lines ~213-282) use `rateLimitPerWindow` 1 or 2, `rateWindowSeconds = 3600`, and expect a LATER sequential
  submission to be rejected. A real hour boundary between the admitted and the expected-rejected submission puts the
  latter in a fresh bucket -> admitted -> `tooManyRequests` fails ("expected Left(TooManyRequests), got Right").
- Concurrency tests use `rateWindowSeconds = 60`, limit 100 -- not boundary-sensitive, but share the factories.
- Each test uses a fresh owner (`freshOwner()`), so a fixed instant shared across tests cannot leak budget between
  tests (rate rows are keyed by `(user_id, window_start)`).
- `AutoRunGuardBurstProofSpec` (HEL-1439) and `DatasetWriteAutoRunEndToEndSpec` (HEL-1374) are the precedent.

## Goals / Non-Goals

**Goals:** a real-boundary probe that reproduces the failure on the UNMODIFIED wiring; a deterministic fix; green
under the same forced boundary; a by-log loop proof; a classified sweep of every other guard-wired spec.

**Non-Goals:** production changes; EmbeddedPostgres startup lines (HEL-1445); retries or tolerance changes.

## Decisions

### D1. Probe before fix (systematic-debugging law)

Waiting for a real hour boundary is impractical (up to 60 min per attempt). The deciding probe is still a REAL
wall-clock boundary with guard wiring unchanged (`SystemClock`): temporarily (uncommitted) shrink ONE rate test's
`rateWindowSeconds` (e.g. to 10) and, inside that test, sleep until ~X ms before the next real `epoch % window == 0`
so the boundary falls between the admitted and the expected-rejected submission; log each submission's real
`Instant.now()` and dump the owner's `pipeline_run_rate_window` rows. Budget: at most 6 aimed attempts.
- RED confirmed when the test fails with "expected Left(TooManyRequests), got Right" AND the dumped rows show exactly
  two `window_start` values one window apart, each `request_count <= limit`. A failure with only ONE `window_start`
  refutes the hypothesis -> stop and escalate. 6 attempts with no repro -> stop and escalate with transcripts.
- Shrinking the window is legitimate here because bucketing is window-size-agnostic arithmetic (`(s / w) * w`); it
  only changes how often a real boundary occurs, not how it is handled. A clock-jump guardClock is illustration only
  and never confirms the cause.

### D2. Fix: pin `guardClock` in both factories

Add a test-local fixed clock (mirroring the existing per-spec `FakeClock` convention -- e.g.
`private object PinnedGuardClock extends Clock { override def now(): Instant = <fixed mid-window instant> }`) and
pass it as `guardClock` from `newService` and `newGatedService`. Pin to a fixed mid-hour instant (e.g.
`2026-01-01T00:30:00Z`) and strengthen the "(limit+1)th" test to assert the EXACT `retryAfterSeconds` (1800 for w=3600):
`retryAfterSeconds = windowStart + w - now` is in `[1, w]` for any instant, so `> 0` can never fail, whereas the exact
value fails ~3599/3600 of the time on `SystemClock` -- a permanent wiring guard if `guardClock` is ever dropped
(design-gate round 1 note 1). Safe as a literal because this spec runs no `cleanupOldWindows`. Every test's submissions then share one bucket regardless of wall
clock. Concurrency tests are unaffected (limit 100). Correct the HEL-1195 doc comment ("no clock-injection seam") to
describe the pinned clock; the 3600s values may stay (assertions do not depend on them).

Alternative: shared helper object for FakeClock across specs -- rejected as scope widening (each spec already owns
its own private clock).

### D3. Red/green/loop evidence

- RED: D1 transcript (failing assertion line, per-submission wall times, two `window_start` rows).
- GREEN: the same aimed real-boundary probe, applied to the FIXED spec (pinned guardClock), passes while the logged
  wall times prove the real boundary was crossed between submissions.
- LOOP: 20 iterations of the fixed spec under `nice -n 19`, `-J-Xmx3g`, at most 4 workers; each iteration green by
  LOG grep (no `TESTS FAILED` / `*** FAILED` / `RUN ABORTED`, expected test count passed), never by exit code; also
  grep for the `[hel1468-guard]` line to confirm the HEL-1468 guard ran.

### D4. Sweep

Enumerate every spec constructing `PipelineRunService` with a non-null `pipelineRunGuardRepo` and no `guardClock`
(planning found: `AutoRunGuardNoRetryStormSpec` limit 0, `PipelineRunServiceTerminalOrderingSpec` limit 1000/0,
`FireTimeRunConfigGateSpec` limit 1000), plus direct `incrementRateIfUnderLimit` callers and
`InMemoryRateLimiter`/`RateLimitDirective` specs. For each, state boundary-sensitive or not with the reason
(a budget of 0 is denied in every bucket; a budget far above the test's submission count cannot be exhausted in
either bucket). `FireTimeRunConfigGateSpec`'s budget check sums `request_count` across all windows, so a split cannot change it.
`InMemoryRateLimiterSpec`/`RateLimitDirectiveSpec` are a different class (first-request-anchored window, not
epoch-aligned, no clock seam) -- classify them as such. Fix only boundary-sensitive ones, with the same D2 pattern; list the rest with reasons in
files-modified.md.

## Risks / Trade-offs

- [Aiming at a short real window is timing-fiddly] -> log wall times; 6-attempt cap then escalate.
- [Pinned instant shared across tests] -> safe because owners are fresh per test; confirm no test reuses an owner.
- [HEL-1445 merge conflict] -> no edits on EmbeddedPostgres lines; the later merger reconciles.

## Planner Notes

- Self-approved: test-only, `skip_specs: true`, no new dependency/API/architecture -> no escalation.
- Driver statements (HEL-1439 pattern, sweep candidates) are treated as claims; the premise was verified at Setup.
