## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD bcb0e891923094c1a1e85ecc053f30a73ee6d70f (planning artifacts are untracked in the change dir).

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/retention-pass-wall-clock-budget/HEL-1477`.
- **Premise (tick awaits retention):** `PipelineSchedulerService.scala:94-128`. `historyWork` is zipped into the tick result at line 127. `PipelineSchedulerActor` arms the next `Tick` only on `TickCompleted`. Confirmed.
- **Also from the same code:** `candidatesWork` and `historyWork` are both eager `val`s and run concurrently. So a schedule that is already due at tick start fires without waiting for retention, even on main. What retention delays is the *next* tick: a schedule that becomes due while a pass runs. This matters for CR 3.
- **D1 citations:** checked against the archived HEL-1435 measurements.md. All of these match:
  - 96.7 s worst 20-batch pass, S4 prod-io-base (line 317);
  - 8.0 s longest transaction (line 222);
  - 77-172 s cold strict-IO batch (section 6.2, line 201);
  - D9 30-day single Output 3.93 s (line 288);
  - HEL-1435's own section 10 already says off-tick or a wall-clock budget is the better design.

  The rejection of the wall-clock budget is sound. Its bound is T plus one batch, and one batch cannot be smaller than one Output, which costs 77-172 s cold. Detaching sets retention's awaited contribution to zero. **D1 is justified.**
- **Overlap reasoning (D2):** `OutputHistoryRetentionService.claim` stores `now + purgeInterval` by CAS. With a 1-minute interval, or a cold pass that runs for minutes, a detached pass can outlive its slot and a later tick could claim again. So the in-flight guard is genuinely needed. The design identifies this correctly.
- **Next-due precedence:** the end-of-pass `compareAndSet(claimed, …)` is unchanged by detaching. A `MoreWork` pass sets `nextDue = Some(now)` (the pass's claim time), so the first tick after the pass ends claims. The continuation stays correct.
- **Advisory lock:** unchanged (`thinPass` / `pg_try_advisory_xact_lock`).
- **Shutdown:** the risk is the same in kind as before.
- **Spec delta:** `openspec validate retention-pass-wall-clock-budget --strict` reports "Change 'retention-pass-wall-clock-budget' is valid".
  - The MODIFIED block carries the full original requirement text plus the original "Purge throws" scenario (diffed by eye against `openspec/specs/output-history-retention/spec.md:48-54`).
  - The ADDED in-flight requirement is coherent.
- **Defaults:** no retention default changes and no new env var (C4). The CLAUDE.md `OUTPUT_HISTORY_THIN_MAX_BATCHES_PER_PASS` row (line 82) says "A pass stalls the scheduler tick", and task 2.4 updates it. This is not a product call: the ticket offers both designs.
- **`thinAndPurge` scope:** `grep -rn thinAndPurge backend/src`. The method is at `OutputHistoryRepository.scala:139`, with 32 test references. **There is also a comment in `backend/src/main/resources/db/migration/V120__history_retention_captured_at_indexes.sql:3`**, which is the basis of CR 1. Flyway validation is on (V100:54 notes there is no `validateOnMigrate(false)`).
- **Maintenance-hook specs:** `PipelineSchedulerServiceMaintenanceHooksSpec.scala:39-42` asserts the retention ERROR log right after `await(svc.tick())`. Once the pass is detached this is racy, so task 3.3 is necessary and scoped correctly.

### Verdict: REFUTE

### Change Requests

1. **Task 2.3's acceptance signal forces editing an applied Flyway migration.** The signal is "verify `grep -rn thinAndPurge backend/src/main` is empty". But `backend/src/main/resources/db/migration/V120__history_retention_captured_at_indexes.sql:3` mentions `thinAndPurge` in a comment.
   - Editing that file changes V120's checksum, and every DB that has already applied V120 (dev, CI, prod) would fail Flyway validation at boot.
   - Revise 2.3 to scope the grep to `backend/src/main/scala`.
   - State explicitly in tasks.md and design D4 that V120 (and every applied migration) must not be edited, and that the stale comment stays.

2. **The D2 in-flight guard leaves its ordering against `claim` ambiguous, and one reading permanently wedges retention.** The design says "both CAS" and "a tick that finds the guard busy does not consume the nextDue slot", but never says what happens on the not-due path. If the guard is acquired first and the call is not due, the guard must be released immediately; if it isn't, every later call returns `None` forever and retention stops silently.
   - In D2, specify the exact order. Either acquire the guard, then claim, and release the guard when the claim returns `None`; or claim first and roll back the claim when the guard is busy. Specify the release on every non-pass exit.
   - Add to task 3.1 a test that a not-due call leaves the guard free: a not-due call, then advance the clock past the slot, then the pass runs.
   - Also state in 3.1 that the Promise-held test must advance the clock past `purgeInterval` (or use a short interval) before the second `purgeIfDue`. Unfixed code returns `None` at the same `now` because `nextDue` is already `now + purgeInterval`, so a same-instant second call passes on unfixed code and is not a valid red (C6).

3. **D5 metric (b) does not measure the quantity the AC bounds, and the "stated bound" is not a bound.** As noted above, `candidatesWork` already runs concurrently with `historyWork` inside the same tick. So "delay from tick start to the due schedule's run row" is about the same on main and on the branch, and cannot show the before/after difference. The delay the AC refers to belongs to a schedule that becomes due *after* the tick that started the pass. On main that delay is roughly pass time + tick interval.
   - Redefine (b): the schedule's `next_run_at` falls inside the pass window, and the driver runs the actor's loop semantics (tick, wait for completion, then tickInterval) or the real `PipelineSchedulerActor`. Measure due time to run row on main and on the branch.
   - Change the PR's stated bound from a relative sentence to an absolute statement the measurement can check. For example: "fire delay ≤ tickInterval + the tick's own work; measured worst W s with a concurrent S4 pass on prod-io-base vs I s idle".
   - Update 1.2 and 4.1 to match.

### Non-blocking notes

- **Lock-skip interaction.** More scheduled runs will now overlap a pass. A run's write-time payload trim takes the retention lock shared, so a batch that meets it skips, and the pass then waits `lockRetry` (2 min) instead of the next tick. Deep-backlog drains may slow down; correctness is unaffected. Say so in Risks, and note the count of `LockHeld` outcomes in the 4.1 measurement if it is cheap to get.
- **Spec wording.** "continues on the next scheduler tick" in the Tiered requirement, and "on the next scheduler tick" in the Thinning-batches precedence, now really mean "the first tick after the pass ends". Consider clarifying with a MODIFIED block, carrying the full requirement text.
- **Contention bound (c).** The next tick's wall time is a proxy. If easy, also record a fired run's duration with and without a concurrent pass on prod-io-base (0.5 vCPU).
- **Synchronous throw.** The detached `historyWork` must keep `Future.delegate` so a synchronous throw from an overridden `purgeIfDue` is still logged and not thrown out of `tick()`. The existing "outer recover" test covers this once 3.3 migrates it.
