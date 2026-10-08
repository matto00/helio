## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 60fdb87ded6dd8d571767199b8d3fa05f6b093c7. The change-dir artifacts are uncommitted (`?? openspec/changes/fix-rate-window-boundary-flake/`).

### What I verified (with evidence)

**Round-1 CR1, the mechanism correction, is addressed.**
- `proposal.md` "Why" and `design.md` Context step 3 now state four things:
  - The auto-run's guard check happens once, on the first tick.
  - The claim is released even on rejection.
  - The race window runs from the owner submit's guard check to the first tick's guard check.
  - No per-run rate is claimed. The "~8%" estimate is gone.
- I checked this against the code:
  - `PipelineSchedulerService.processAutoRunClaim` (PipelineSchedulerService.scala:126-133) calls `releaseClaim` after `fireAutoRun` whatever the outcome.
  - `PipelineAutoRunDebounceRepository.releaseClaim` (lines 62-76) is a compare-and-delete on the `claimed_at` token. No concurrent write happens in this case, so it deletes the row.
  - Later ticks find nothing to claim. The mechanism as written matches the code.

**Round-1 CR2, the D1 probe placement, is addressed.**
- D1 and task 1.1 place the probe after the owner submit and its `runCount(pid) shouldBe 1`, and before `triggerAutoRun`. That is DatasetWriteAutoRunEndToEndSpec.scala, after line 208 and before line 212.
- The probe sleeps until the next epoch-minute boundary plus about 200ms.
- The probe is temporary and uncommitted (C4). It only inserts a wait between existing steps.
- A control (task 1.2) uses a similar-length sleep that does not cross a boundary, with logged instants proving it.
- The stop-and-escalate rule on non-repro is retained (task 1.3, C2).
- The second-57 placement is explicitly rejected with the reason.

**Round-1 CR3, the D3 re-target, is addressed.**
- D3.1 and D3.2, and task 3.2, both require "the corrected D1 probe placement" for two runs:
  - the post-fix boundary run (expected green);
  - Mutation A, `guardClock = SystemClock` (expected red).

**Fresh checks on the code:**
- **The seam point exists.** `PipelineRunService.scala:1042` calls `incrementRateIfUnderLimit(user.id, limit, window)` without `now`, and `guardConfig` is the last constructor parameter (line 107). A trailing defaulted `guardClock` therefore compiles at every call site. `domain/util/Clock.scala` exists.
- **The test can wire a pinned clock.** `newRunService` (spec lines 136-142) is the only constructor used by this case. The fix can add a clock parameter there without touching the sibling cases.
- **Scheduler cleanup does not run here.** The scheduler's `pipelineRunGuardRepo` defaults to `null` (PipelineSchedulerService.scala:34), and `newScheduler` (spec lines 149-153) does not pass one. `tick()` (lines 81-87) therefore skips `cleanupOldWindows` in this spec. This settles the D2 "executor must verify" item, and task 2.2 can just cite it.
- **Pin semantics hold.** Both guard checks read `guardClock.now()`. With a fixed clock they bucket identically, so the fix is deterministic. Attribution mutation-sensitivity is preserved: a writer-attributed fire would land in the writer's fresh bucket and be admitted, giving `runCount` 2.
- **Unchanged since round 1 and still sound:**
  - the scope boundary with HEL-1196;
  - D4, epoch-aligned windows are intended (HEL-505 Decision 2);
  - the spec-delta scenario, which documents existing `bucketStart` behaviour;
  - the D5 MISTAKES.md plan.
- **Every ticket AC maps to a task:**
  - the measured red → 1.1 and 1.2;
  - deterministic control with the assertion unchanged → 3.1 and C1;
  - green across a boundary, red without the clock → 3.2;
  - the decision on windows → D4 and the spec delta;
  - the MISTAKES.md entry → 4.1.

### Verdict: CONFIRM

### Non-blocking notes

- **The D1 control wording is slightly muddled.** "Otherwise first wait past the boundary, then submit" reads as if the wait comes before the owner submit, while the probe position is after it. The logged-instants requirement settles which side of the boundary each check fell on, so this cannot produce false evidence.
  - Better: also log the instant immediately after the first `tick()` returns. The pre-`triggerAutoRun` instant only approximates T1, the first tick's guard check.
  - For the control, choose the sleep so that both T0 and the post-tick instant are at least a few seconds clear of a boundary.
- **D2 still phrases the cleanup check as open.** It is resolved above (the scheduler's guard repo is `null` in this spec), and task 2.2 can record it directly.
