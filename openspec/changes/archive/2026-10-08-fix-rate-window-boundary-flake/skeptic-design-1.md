## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 60fdb87ded6dd8d571767199b8d3fa05f6b093c7 (artifacts uncommitted in the change dir).

### What I verified (with evidence)

- **Bucketing is epoch-aligned.** `PipelineRunGuardRepository.bucketStart` (PipelineRunGuardRepository.scala:32-35) computes `(epochSeconds / windowSeconds) * windowSeconds`. `incrementRateIfUnderLimit(..., now: Instant = Instant.now())` (line 47) already accepts `now`. Confirmed.
- **No service-level seam.** `PipelineRunService.executeRun` calls `incrementRateIfUnderLimit(user.id, limit, window)` with no `now` (PipelineRunService.scala:1042). The constructor's last param is `guardConfig` (line 107), so appending a defaulted `guardClock` keeps every call site compiling. `Clock`/`SystemClock` exist at `domain/util/Clock.scala` and are already imported by the test. Confirmed.
- **HEL-1196 scope (Linear, Backlog).** It asks for a seam through `PipelineRunService` plus conversion of `PipelineRunGuardIntegrationSpec`'s six tests. D2 adds only the seam, which matches HEL-1196's intent, and leaves the test conversions with HEL-1196. Judgment call (1): a constructor seam is the narrowest deterministic fix. The auto-run's `submit` is called inside `PipelineSchedulerService.fireAutoRun`, and a per-call `now` cannot reach it. Accepted.
- **Judgment call (3), clock interactions.**
  - `PipelineSchedulerService.tick` does call `pipelineRunGuardRepo.cleanupOldWindows()` with the default `Instant.now()` and a 3600s retention (PipelineSchedulerService.scala:81-86). It only does this when the scheduler was given a guard repo, and this spec's `newScheduler` (DatasetWriteAutoRunEndToEndSpec.scala:150-154) passes none, so cleanup never runs here. Even if it did, a pin within about 30s of now is far inside the retention.
  - Debounce `fire_at`/`claimDue` use `triggerAutoRun`'s `Instant.now()` and the scheduler's `SystemClock`. `guardClock` does not affect either.
  - `Retry-After` is derived from the same `now`, so production is unchanged.
  - D2's pin does not interfere with anything else. Accepted.
- **Attribution mutation-sensitivity survives the fix.** With a pinned clock, a writer-attributed auto-run would hit the writer's fresh bucket in the same pinned window, be admitted, and `runCount` would be 2. Accepted.
- **Judgment call (4), the spec scenario is honest.** The delta repeats the existing requirement verbatim (I diffed it against `openspec/specs/pipeline-run-guard/spec.md`) and adds one scenario that describes current code (`bucketStart`). HEL-505's archived design (`2026-09-23-expensive-op-guards/design.md:66-70`, Decision 2, "DB-backed fixed-window counter, PK bucketed by window boundary") chose this deliberately. No invented requirement. Accepted.
- **Judgment call (2), the D1 reproduction. This is where the design fails.** I traced the actual control flow of the owner-attribution case:
  1. `runService.submit(...)` (test line 207) is awaited. `executeRun` chains through `backend.execute` to a terminal outcome (PipelineRunService.scala:1100-1112), so the owner's run is terminal when the call returns. The owner's guard check happens at time **T0**.
  2. `triggerAutoRun(..., Instant.now())` with `debounceSeconds = 0` gives `fire_at = now`.
  3. The **first** `scheduler.tick()` inside `pollUntil`:
     - `claimDue(now)` claims the row.
     - `hasActiveRunInternal` is false, because the owner's run is terminal.
     - `fireAutoRun` calls `submit` as the owner. That is the auto-run's single guard check, at time **T1**.
     - `releaseClaim` then **deletes** the debounce row, even on a guard rejection (PipelineSchedulerService.scala:130-137; PipelineAutoRunDebounceRepository.scala:71-76; asserted by the sibling 3.7 test, `stillClaimed shouldBe false`).
  4. Every later tick in the 5s poll finds no debounce row and does nothing.

  So the race window is **T0 to T1**: the tail of the owner run's DB work, `runCount`, `triggerAutoRun`, and the first tick. That is typically sub-second, maybe a second or two on loaded CI. **It is not the 5s poll.** The CI span of 22:55:58 to 22:56:00 fits a short T0-to-T1 gap.

### Verdict: REFUTE

The fix (D2), the scope (proposal), the D4 decision and the spec delta are sound. The reproduction and proof plan (D1/D3, tasks 1.1/1.2/3.2) rests on a wrong failure mechanism. As written, it would produce either a spurious C2 escalation or green "evidence" that proves nothing.

### Change Requests

1. **Correct the mechanism in `proposal.md` "Why" and `design.md` Context step 3.**
   - The auto-run's guard check happens exactly once, on the first tick. The debounce row is claimed, then deleted by `releaseClaim` even on rejection.
   - The race window is from the owner submit's guard check to the first tick's guard check, not the 5s `pollUntil`.
   - Remove or re-derive the "~5s of 60s ≈ 8% per run" estimate, which assumes the wrong span.
   - Cite PipelineSchedulerService.scala:130-137 and PipelineAutoRunDebounceRepository.scala:71-76.
2. **Redesign the D1 probe (design D1, tasks 1.1/1.2) so the boundary falls between T0 and T1.**
   - "Sleep until second 57 before the owner submit" puts the boundary about 3s after T0. By then the first tick has already rejected the auto-run and deleted the row, so the unmodified case would almost certainly go **green**. C2 would then force an escalation on a real bug.
   - Specify a deterministic placement instead. For example: after the owner submit (test line 207/208) and before `triggerAutoRun` (line 212), sleep until the next epoch-minute boundary plus a small margin (e.g. +200ms).
   - The control is the same probe with a sleep of similar length that does **not** cross a boundary.
   - State that the probe only inserts a wait between existing steps and changes no test logic, and that it is uncommitted.
   - Keep the "if 1.1 does not reproduce, stop and escalate" rule, now against the correct probe.
3. **Re-target the D3 proof (task 3.2) to the corrected probe.**
   - The post-fix "green across a boundary" run and Mutation A (`guardClock = SystemClock`, expected red) must both use the boundary-between-T0-and-T1 placement.
   - Under the current second-57 placement, Mutation A would go green with the seam removed. The mutation proof would then show nothing about the seam.

### Non-blocking notes

- D2's "executor must verify `cleanupOldWindows`" can be recorded now: this spec's scheduler gets no guard repo, so cleanup is skipped. Task 2.2 can just cite that.
- Choosing a pin "mid-window" (truncate to the minute, then +30s) is fine. Any fixed instant works, because both checks read the same pinned value.
- D5 (MISTAKES.md sbt entry) correctly insists on verifying on sbt 2.0.9 before writing and on separating verified from reported claims. No objection.
