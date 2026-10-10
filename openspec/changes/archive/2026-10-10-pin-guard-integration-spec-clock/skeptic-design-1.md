## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 5ba82b39f5de50eb414b9f95f4f06bf4b89634cb (planning artifacts are uncommitted in the change dir).

### What I verified (with evidence)

- **Premise / root cause holds in live code.**
  - `PipelineRunService.scala:106` has `guardClock: Clock = SystemClock`. `PipelineRunExecutor.scala:129` passes
    `guardClock.now()` to `incrementRateIfUnderLimit`.
  - `PipelineRunGuardRepository.bucketStart` (lines 32-36) is `(epochSeconds / windowSeconds) * windowSeconds`, so
    buckets are epoch-aligned. The UPSERT is keyed on `(user_id, window_start)` with `WHERE request_count < $limit`.
  - `PipelineRunGuardIntegrationSpec.newService` (115-122) and `newGatedService` (162-170) both omit `guardClock`.
    The six rate tests (213-280) use limit 1 or 2 with `rateWindowSeconds = 3600` and expect a later sequential
    submit to come back `TooManyRequests`. The HEL-1195 comment (194-210) says there is "no clock-injection seam",
    which is no longer true.
- **D1 probe is a valid red.** It shrinks the window on unchanged `SystemClock` wiring and aims at a real
  `epoch % w == 0` boundary. That uses the same production path with only the boundary frequency changed, because
  the bucketing arithmetic does not depend on window size. The pass/fail rule is falsifiable: it needs the failing
  assertion AND two `window_start` rows one window apart, each at or under the limit. One row refutes the
  hypothesis. There is an attempt cap with escalation. The design also rules out a clock-jump guardClock as
  confirmation. The table name `pipeline_run_rate_window` matches the repository SQL. The green probe in 2.2 reuses
  the same aimed boundary against the fixed spec, which is the right control.
- **D2 fix is sound.** It follows the existing precedent (`DatasetWriteAutoRunEndToEndSpec:212` pins a mid-minute
  FakeClock passed as `guardClock`; the private FakeClock-per-spec convention appears in 10+ specs).
- **Fresh owners per test: confirmed.** Every test calls `freshOwner()` (`UUID.randomUUID`, line 78), including
  both owner and grantee in the editor test. Rate rows are keyed per user, so a shared pinned instant cannot leak
  budget between tests. Concurrency tests use `rateLimitPerWindow = 100` with at most 8 submits per owner, so
  pinning cannot affect them. Their `retryAfterSeconds` comes from `concurrencyRetryAfterSeconds`, not the clock.
  This spec builds no `PipelineSchedulerService`, so `cleanupOldWindows` (which uses real `Instant.now()`) never
  runs against its pinned-instant rows.
- **D4 sweep list is complete (my own grep of `backend/src/test`).**
  - `new PipelineRunGuardRepository` appears in exactly 7 files:
    - the target spec;
    - the two precedents, which already pass `guardClock`: AutoRunGuardBurstProofSpec and DatasetWriteAutoRunEndToEndSpec;
    - `PipelineRunGuardRepositorySpec`, which passes an explicit `now` to every call (lines 125-250), so it is not exposed;
    - the three sweep candidates.
  - The 26 files with `new PipelineRunService` were cross-checked: only these files pass `pipelineRunGuardRepo`
    (the parameter defaults to null, so the guard is off elsewhere).
  - Boundary-insensitivity of the candidates holds:
    - `AutoRunGuardNoRetryStormSpec:159` has limit 0. The `limit < 1` short-circuit (repo line 50) denies in every
      bucket.
    - `PipelineRunServiceTerminalOrderingSpec:413` has `GenerousGuard` limit 1000. Its rate case at 556 is limit 0;
      the case at 571 is a concurrency-cap case.
    - `FireTimeRunConfigGateSpec:97` has limit 1000. Its budget probe at line 191 is
      `sum(request_count)` across all of the owner's windows, so a split cannot change it either. The design should
      state this explicitly (see notes).
  - `InMemoryRateLimiter` anchors its window on the first request (`Duration.between(windowStart, now)`), not on the
    epoch. It has no clock seam and is not the same class.
- **No contradictions or placeholders.** Proposal, design and tasks agree. The non-goals keep the EmbeddedPostgres
  lines (HEL-1445) and production code out of scope. The loop is judged by log grep plus the `[hel1468-guard]`
  line, per the ticket. Every AC maps to a task: fake clock to 2.1, red/green to 1.1/2.2, loop by log to 2.3,
  sweep to 2.4.

### Verdict: CONFIRM

### Non-blocking notes

1. **The D2 rationale is wrong, though harmless.** "Pin to a mid-window instant (not a window start) so
   `retryAfterSeconds > 0` stays a real assertion" does not hold. `retryAfterSeconds = windowStart + w - now`
   (repo line 49) is always in `[1, w]` for ANY instant, including an exact window start (where it equals `w`).
   So `> 0` cannot fail under any clock. A pinned clock allows a much stronger assertion that is also a permanent
   wiring guard:
   - Assert the exact value in the "(limit+1)th" test, e.g. `err.retryAfterSeconds shouldBe 1800L` for an instant
     30 minutes into an hour with w = 3600.
   - Under the old SystemClock wiring this fails about 3599/3600 of the time. A future refactor that drops
     `guardClock` would then go red immediately, instead of relying only on the one-off 2.2 probe.
   - Recommended; correct the rationale sentence either way.
2. **D4 classification for FireTimeRunConfigGateSpec:** record that its line-191 budget check sums across windows,
   so a split cannot change it, in addition to the "limit 1000" reason.
3. **D4: InMemoryRateLimiterSpec / RateLimitDirectiveSpec:** classify these as "first-request-anchored window, not
   epoch-aligned, no clock seam: different class". Do not call them boundary-insensitive because of their limits.
4. **Pinned instant:** a fixed literal (e.g. `2026-01-01T00:30:00Z`) is fine here because nothing in this spec runs
   `cleanupOldWindows`. Avoid copying the pattern into a spec that ticks a scheduler with the guard repo wired: real
   `Instant.now()` cleanup would purge rows from a past pinned instant.
