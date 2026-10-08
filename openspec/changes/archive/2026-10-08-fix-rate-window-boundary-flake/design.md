## Context

`PipelineRunGuardRepository.incrementRateIfUnderLimit(userId, limit, windowSeconds, now = Instant.now())` buckets `now` to `(epochSeconds / windowSeconds) * windowSeconds`. The repository already accepts `now`; `PipelineRunService.executeRun` (line ~1042) never passes one, so every service-level caller is pinned to the wall clock.

`DatasetWriteAutoRunEndToEndSpec`'s owner-attribution case (limit 1, window 60s):
1. submits once as the pipeline owner (exhausts the owner's bucket),
2. triggers an auto-run via a non-owning writer,
3. `pollUntil(scheduler, 5.seconds)(runCount(pid) >= 2)`. The FIRST `tick()` claims the debounce row (debounce 0) and fires the auto-run, which runs the rate-limit check exactly once; `processAutoRunClaim` then releases (deletes) the claim even when the run is guard-rejected (`PipelineSchedulerService.scala` ~130-137, `PipelineAutoRunDebounceRepository.releaseClaim`; the sibling 3.7 case asserts that deletion). Every later tick in the 5s poll finds no row and does nothing,
4. asserts `runCount(pid) shouldBe 1`.

The race window is therefore from step 1's guard check to the FIRST tick's guard check (not the 5s poll): usually sub-second locally, longer under CI contention. If an epoch-minute boundary falls inside it, the auto-run lands in a fresh owner bucket and is admitted: `2 was not equal to 1`. (Corrected after design-gate skeptic round 1.) HEL-1285's CI run spanned 22:55:58–22:56:00. This is a hypothesis until probed (task 1).

The scheduler already takes an injectable `Clock` (`com.helio.domain.util.Clock`, `SystemClock`); `PipelineRunService` does not.

HEL-1341/HEL-1357's wall-clock inventory listed this spec's latency case (row 1) and its 5s/10s poll deadlines (row 14, "Leave") but missed this rate-window race.

## Goals / Non-Goals

**Goals:**
- Probe-confirm the root cause with a measured red on the unmodified test.
- Make the owner-attribution case deterministic with respect to the rate window, without loosening its assertion or its attribution mutation-sensitivity.
- Record whether epoch-aligned windows are intended.
- MISTAKES.md entry for the sbt cross-worktree attach hazard.

**Non-Goals:**
- Converting `PipelineRunGuardIntegrationSpec` (HEL-1195's widened 3600s windows) or `AutoRunGuardBurstProofSpec` (300s window) to the seam — that is HEL-1196's remaining scope.
- Routing `startAt`/terminal timestamps or any other `Instant.now()` in `PipelineRunService` through a clock.
- Any change to rate-limit semantics in production.

## Decisions

### D1 — Reproduce before fixing (measured red)
Before any production/test fix, run the UNMODIFIED owner-attribution case with a temporary, uncommitted probe inserted AFTER the owner's direct submit (and its `runCount(pid) shouldBe 1`) and BEFORE the `triggerAutoRun` call: sleep until the next epoch-minute boundary plus ~200ms. The owner's guard check is then in minute M and the first tick's guard check in M+1. Expected: `2 was not equal to 1`. Control: the same probe position with a sleep of similar length that provably does NOT cross a boundary (e.g. if the next boundary is more than ~3s away, sleep 2s; otherwise first wait past the boundary, then submit — i.e. log both guard-check instants and confirm they share a minute). Log the wall-clock instant at the owner submit and immediately before `triggerAutoRun` in every run so each transcript shows which side of the boundary each check fell on. Run each ≥3 times, serially. If the red does not reproduce, STOP and escalate (Iron Law: systematic-debugging); non-repro is not a default pass.

Rejected placement (skeptic round 1): sleeping until second 57 before the owner submit puts the boundary after the first tick in most runs, so it would go green and prove nothing.

Rejected alternative probe: a guard-repository subclass that shifts `now` — synthetic; the wall-clock placement reproduces the real CI path with no change to test logic.

### D2 — Fix: a guard clock seam on `PipelineRunService` (the narrowest deterministic fix)
Add `guardClock: Clock = SystemClock` as the LAST defaulted constructor parameter of `PipelineRunService` (after `guardConfig`), and pass `now = guardClock.now()` at the single `incrementRateIfUnderLimit` call in `executeRun`. Only the rate-window bucket consults it. Every existing call site compiles unchanged; production uses `SystemClock` (identical to today's `Instant.now()` default).

The owner-attribution case constructs its run service with a test-local fixed `Clock` pinned to an instant in the middle of a 60s window (e.g. `Instant.now().truncatedTo(MINUTES).plusSeconds(30)`). Both the owner's direct submit and the scheduler-fired auto-run then bucket to the same window no matter how long the case takes on the wall clock. The scheduler keeps `SystemClock` (debounce 0 fires immediately; unchanged). Assertion `runCount(pid) shouldBe 1`, the 5s poll, and limit 1 / window 60 all stay as they are.

The pinned instant is derived from `Instant.now()` only so rows look current; correctness does not depend on it (any fixed instant works). Note `cleanupOldWindows` is not invoked by the scheduler in this spec — the executor must verify that (if `tick()` runs the cleanup with `SystemClock`, a pinned instant far in the past could be deleted mid-test; pinning near now avoids that and the executor must confirm by reading `PipelineSchedulerService.tick`).

Why this and not alternatives:
- **Widen the window / retry** — forbidden (statistical, HEL-1196 exists to replace it).
- **Pre-seed the owner's next bucket in the test** — still wall-clock dependent (assumes case duration < window) and couples the test to `pipeline_run_rate_window` internals.
- **Pass `now` per `submit` call** — the auto-run's submit is called by the scheduler, which the test cannot parameterize per call; a constructor seam is the only way to reach that path. It is also exactly HEL-1196's proposed seam, so HEL-1196 shrinks to converting its own tests rather than being duplicated.

This implements HEL-1196's production seam (~3 lines) but not its test conversions; scope widening is not material. Report this to the driver so HEL-1196 can be re-scoped.

### D3 — Post-fix proof
1. The fixed case passes with the corrected D1 probe (boundary between the owner submit and `triggerAutoRun`) in place (≥3 serial runs).
2. Mutation A: construct the test's run service with `guardClock = SystemClock` (seam removed) under the same corrected D1 probe → red `2 was not equal to 1`. Proves the seam is what fixes it.
3. Mutation B (attribution sensitivity preserved): temporarily make the auto-run attribute to the writer (or otherwise confirm the existing mutation the spec's comment describes) → red. Revert.
4. Full spec file green via `testOnly`, plus `PipelineRunGuardIntegrationSpec`, `PipelineRunGuardRepositorySpec`, `AutoRunGuardBurstProofSpec`, `AutoRunGuardNoRetryStormSpec`, `ApiRoutesPipelineRunGuardSpec`, `PipelineSchedulerServiceSpec` (callers/neighbours of `PipelineRunService`'s guard path).
Probes are temporary and never committed; transcripts are saved under the change's `evidence/`.

### D4 — Epoch-aligned fixed windows are intended
HEL-505 design Decision 2 deliberately specified `to_timestamp(floor(epoch / windowSeconds) * windowSeconds)` mirroring `assistant_daily_usage`'s per-day buckets: a single atomic upsert, globally consistent across instances, no reset logic. The known cost of fixed windows (up to 2× limit in a short span straddling a boundary) is an accepted property of fixed-window limiters; a sliding window would need a different storage shape and is a product decision, not a flake fix. No product code changes beyond the testability seam. Recorded as a spec scenario.

### D5 — MISTAKES.md: sbt cross-worktree server attach
Verify on this machine (sbt 2.0.9) before writing: whether a client started in one worktree's `backend/` can connect to a server owned by another checkout, and that `sbt -batch -Dsbt.server.autostart=false` (or the sbt 2 equivalent, e.g. `--server`/`-client` flags — check `sbt --help`) runs in-process against the current directory's build. The entry states what was verified vs. what is reported from HEL-1285's skeptic, gives the safe invocation, and says how to check the project path (the `[info] welcome to sbt` / `loading project definition from <path>` line). Place it next to the existing sbt 2 entry. If the flag does not behave as claimed, document the verified alternative instead, never the unverified one.

## Risks / Trade-offs

- [D1 probe waits up to 60s for the next boundary per run] → serial runs only, a handful each; acceptable cost.
- [D1 cannot reproduce] → escalate, do not fix blind.
- [A future caller relies on `guardClock` for other timestamps] → the param doc states it drives only the rate-window bucket; widening it is HEL-1196's call.
- [Other specs share the same race shape (AutoRunGuardBurstProofSpec, limit 3 / 300s)] → listed as follow-up / HEL-1196 scope, not fixed here.
