## Context

HEL-1093 introduced `pipeline_auto_run_debounce` (V110): a dataset write UPSERTs one row per eligible downstream pipeline (`fire_at` pushed forward, `claimed_at = NULL`). Every `PipelineSchedulerService.tick` runs `PipelineAutoRunDebounceFirer.processAutoRunDebounce(now)`, which:

1. atomically claims due rows (`claimDue`: `UPDATE ... SET claimed_at = now ... RETURNING`);
2. if `runRepo.hasActiveRunInternal(pid)` holds, skips the fire;
3. otherwise re-evaluates the verdict (HEL-1384) and submits through `PipelineRunService.submit` as the owner. On `Left(TooManyRequests)` it logs at INFO;
4. **always** calls `releaseClaim`, a compare-and-delete on the claimed token.

Steps 2 and 3 therefore delete the row. The trailing write is lost unless another write arrives. This was confirmed by reading main at 54f2943cd (premise-validation.md). HEL-1093 design.md "Risks" explicitly accepted both drops, and the live spec scenario (HEL-1097) forbids any re-attempt for the same denied write. The owner ruled on 2026-10-11 (escalation HEL-1504-1791759145023-49a06d):

- **Q1:** keep-pending-fire-after-run.
- **Q2:** retry-after-capped-N-then-drop-with-warn.
- **Q3:** no writer signal in this ticket (HEL-1171/1172).

## Goals / Non-Goals

**Goals**

- A write whose fire meets an active run leads to exactly one run after that run completes.
- A write whose fire is guard-rejected is re-attempted after Retry-After, at most N times. Exhausting N drops the auto-run with a WARN.
- A deterministic repro that is red on main, using the `Clock` seam and an embedded Postgres with no sleeps. It covers three cases: an in-flight run, the per-user rate limit, and the owner concurrency cap.

**Non-Goals**

- Any writer-facing signal or write-response change (Q3).
- Changing fire-time verdict denials (HEL-1384). Those still drop the row, because a denied pipeline must not retry-storm.
- Reaping orphaned `completed_at IS NULL` runs (pre-existing; it blocks scheduled runs identically).
- Reducing write-to-run latency (HEL-1167).
- Any bypass of HEL-505.

## Decisions

### D1. Active run → un-claim, keep the row (Q1)

Add `PipelineAutoRunDebounceRepository.unclaim(pid, claimedAt)`:

```sql
UPDATE pipeline_auto_run_debounce SET claimed_at = NULL
WHERE pipeline_id = ? AND claimed_at = ?
```

It compares on the same token as `releaseClaim`. If a fresh write landed mid-claim, `claimed_at` is already NULL and this matches zero rows, which is harmless because the fresh write already re-armed the row.

`fire_at` is left unchanged (still `<= now`), so every later tick re-claims the row and re-checks `hasActiveRunInternal`. The first tick after the run completes falls through to the normal fire path. The `guard_retry_count` is not touched.

Cost: one claim UPDATE plus one indexed `exists` per pending pipeline per tick while the run is active. The firing side stays at one run per pipeline. Alternatives were rejected by the owner:

- re-arming a full debounce window (adds latency);
- comparing the write time against the run start (subtle; the run's source-read moment is not recorded).

### D2. Guard rejection → re-arm after Retry-After, capped (Q2)

V125 adds `guard_retry_count INT NOT NULL DEFAULT 0`. Add `PipelineAutoRunDebounceRepository.rearmAfterGuardRejection(pid, claimedAt, fireAt, maxRetries): Future[RearmOutcome]`. It runs one compare-on-token statement, in the same transaction, that either:

- re-arms (`fire_at = fireAt, claimed_at = NULL, guard_retry_count = guard_retry_count + 1`) when `guard_retry_count < maxRetries`, returning `Rearmed(attempt)`; or
- deletes the row when the count is already at `maxRetries`, returning `Exhausted(count)`.

A token mismatch returns `Superseded`, meaning a fresh write took over.

The firer passes `fireAt = now + max(1, retryAfterSeconds)`. The floor of 1 s guarantees that a `retryAfterSeconds = 0` edge cannot cause a same-tick re-claim. Per tick, `claimDue` claims each row at most once anyway.

- On `Exhausted`, the firer logs at WARN with the pipeline id, owner id, attempt count and the guard's reason.
- On `Rearmed`, it logs at INFO.

All HEL-505 rejection kinds take this path, because they all surface as `ServiceError.TooManyRequests` from `submit`: the rate limit (Retry-After = window remainder) and the concurrency cap (advisory `PIPELINE_RUN_CONCURRENCY_RETRY_AFTER_SECONDS`, default 15; the owner-keyed cap, since auto-runs submit as the owner).

**Budget cost of a retry (design-gate round 1, CR1).** A rate-limit rejection consumes no budget: `incrementRateIfUnderLimit` increments only on `Right`. A concurrency-cap rejection inside `submit` DOES consume one rate slot, because `PipelineRunExecutor` commits the rate increment (`:133-136`) before the cap check (`:150-167`). Unmitigated, each cap-blocked pipeline would burn about 2 of the owner's 10 slots per minute. With helio-news's 3 views, that is about 6 of 10, which would starve the owner's manual runs.

**Mitigation (D2a): a read-only pre-flight cap check in the firer.** Before calling `submit` (after the D1 active-run check and the HEL-1384 verdict), the firer counts the owner's non-terminal real runs with a new `PipelineRunRepository.countOwnerInFlightRealRunsInternal(ownerId)`. It uses the SAME predicate `insertRunIfUnderConcurrencyCap` counts (`status NOT IN ('succeeded','failed','dry_run')`, real runs, owner-keyed; the executor must reuse or extract that predicate, not re-type it). If that count is `>= guardConfig.maxConcurrent`, the firer does not call `submit`. It takes the D2 re-arm path with `retryAfterSeconds = guardConfig.concurrencyRetryAfterSeconds`, and this counts as one attempt against N.

This is strictly more conservative than the guard and never admits a run the guard would reject. `submit` remains the authoritative check, so it is not a bypass. The residual is a TOCTOU window in which the cap fills between the pre-check and `submit`. In that window one rate slot is consumed, the same as today's single attempt. That is bounded at one slot per attempt, and only when the race is actually lost.

Spec note: the `pipeline-run-guard` capability says an auto-run is rejected "exactly as a manual API submission would be". Under D2a, a capped auto-run is held back *before* `submit` and so avoids the rate-slot cost. That is stricter than the guard, never looser, and it is intentional; the PR body states it.

Worst case after mitigation: a cap-blocked pipeline consumes zero rate slots while it stays blocked, plus at most one slot per lost race. The firer therefore needs `guardConfig.maxConcurrent` and `concurrencyRetryAfterSeconds`, which are threaded from the same `PipelineRunGuardConfig` instance `PipelineRunService` uses.

### D3. Counter reset on a fresh write

`upsertDebounce`'s `ON CONFLICT ... DO UPDATE` also sets `guard_retry_count = 0`. A new write is a new obligation, and the HEL-1097 spirit holds: only writes start new attempts. This stays bounded, because attempts are spaced at least Retry-After apart and occur at most once per tick per pipeline. The GREATEST push-forward means a write during a Retry-After wait never pulls the fire earlier than the retry time.

### D4. N default = 10, env `PIPELINE_RUN_AUTO_RUN_MAX_RETRIES`

This is a reversible default chosen by this lane, because the owner did not set N.

- **Rate limit (default 10 runs/60 s):** a rejection's Retry-After is the remainder of the current window, so the first retry lands in a fresh window and normally succeeds. 10 tolerates up to about 10 consecutive windows (around 10 minutes) of the owner saturating the limit through other triggers.
- **Concurrency cap (advisory 15 s):** retries are spaced `max(Retry-After, tick interval)` apart, and the tick defaults to 30 s. So 10 retries cover about 5 minutes of the owner holding `maxConcurrent` real runs. That is far longer than a cheap auto-runnable pipeline's run, and the cost verdict already restricts auto-runs to cheap runs. Under D2a these retries consume no rate slots.
- **Rate limit, timing:** each retry lands in a fresh window (the window is at least the 30 s tick), so N = 10 is about 10+ minutes of continuous saturation.
- **Worst case:** 10 extra guard checks per write per pipeline over minutes, which is negligible.

The value is read once via a new `PipelineRunGuardConfig.autoRunMaxRetries` field, following the existing fromEnv convention. A value that is non-numeric or `< 0` falls back to 10. `0` means "never retry", which restores the old drop-with-WARN behaviour. The firer reads it from `PipelineRunService.guardConfig` (now a public val), the same instance the guard enforces, so the cap, the advisory Retry-After and the retry allowance cannot drift apart; the fixture default comes from the `PipelineRunGuardConfig` case-class default (10). A new CLAUDE.md env-table row documents it. The value goes under "Defaults chosen" in the PR body.

### D5. Ordering inside one claim

The order within one claim is unchanged: `hasActiveRunInternal` first (D1), then the verdict (HEL-1384, which still deletes on denial), then submit. Only these outcomes change:

- `TooManyRequests` → D2.
- active run → D1.

Success, other `Left`s and unexpected failures keep `releaseClaim`'s compare-and-delete. An unexpected failure is not retried, which avoids a retry loop on a deterministic error.

### D6. Repro, red first

A new spec, `DatasetWriteAutoRunDroppedFireSpec`, uses `VerifiedEmbeddedPostgres.start`, Flyway, a mutable `Clock` seam for both the scheduler and the guard clock, and a real `PipelineRunService` (pattern: `AutoRunGuardNoRetryStormSpec`). It drives `tick()` directly and reads `pipeline_auto_run_debounce` and `pipeline_runs` rows. There are no sleeps and no log assertions.

- **(a) In-flight run.** Insert an active `pipeline_runs` row (`completed_at NULL`) and write. Advance the clock past the debounce and tick: no new run, and the row is still present. Complete the active run, advance and tick: exactly one new auto-run.
- **(b) Rate limit.** Saturate the owner's window and write. Advance and tick: no run, and the row is re-armed. Advance past the window and tick: exactly one run.
- **(c) Concurrency cap.** Set the owner at `maxConcurrent` in-flight real runs on *other* pipelines and write. Tick: no run, the row is re-armed, and `pipeline_run_rate_window.request_count` for the owner is unchanged across the rejected attempt (this proves D2a). Complete one run, advance past the advisory and tick: exactly one run.
- **Fixture rule for "in flight" and "complete" (CR2).** The two guards read different columns. `hasActiveRunInternal` reads `completed_at IS NULL`; the cap reads `status NOT IN ('succeeded','failed','dry_run')`. Every in-flight fixture run is inserted with `status = 'running'` AND `completed_at = NULL`. "Complete the run" means calling `PipelineRunRepository.updateRunTerminalInternal` (or `updateRunTerminal`) with a terminal status `succeeded`, which sets BOTH. A fixture must never set only one of the two columns.
- **(d) Cap.** Hold the guard rejecting and tick N+1 times, advancing past each Retry-After: the row is gone after N re-attempts, there are no runs, and later ticks do nothing.

Before the fix, (a), (b) and (c) are red at the "row still present / eventually one run" assertions on main. The executor records that red run as evidence before implementing. `AutoRunGuardNoRetryStormSpec` encodes the reversed scenario. It is rewritten to assert the bounded-retry contract (d), not deleted.

**Existing specs that encode the old drop and must be rewritten (CR3), not deleted:**

- `AutoRunGuardNoRetryStormSpec`: rewritten to the bounded-retry contract (d).
- `DatasetWriteAutoRunEndToEndSpec`'s guard-rejection case (around line 254, `stillClaimed shouldBe false` under `rateLimitPerWindow = 0`): rewritten to assert the row is re-armed with `guard_retry_count = 1` and `fire_at` pushed by Retry-After. Because the limit is 0, this case is also the natural cap-exhaustion fixture.

The executor must also grep `backend/src/test` for every other assertion on `pipeline_auto_run_debounce` row absence after an active-run or guard-reject fire, and list what it found in the commit.

## Risks / Trade-offs

- **An orphaned active run** (a process killed mid-run, `completed_at` never set) keeps a D1 row pending indefinitely. The cost is one cheap check per tick and no runs. This is the same pre-existing blocker scheduled runs already have. Reaping orphans is out of scope and a possible follow-up.
- **Duplicate run.** With D1 the in-flight run may already have read the write, and the follow-up run is then redundant. It is at most one extra cheap run, which is the owner's chosen trade.
- **Multi-instance.** All transitions are compare-on-token on the claimed row, and overlapping instances serialize via `claimDue`. One corner: a claim is stale-reclaimable after 300 s. If an instance stalls more than 300 s between claim and its D1 `unclaim`, a second instance may reclaim the row and fire once the run completes, while the first instance's late `unclaim` matches no token. The net effect is at most the same single follow-up run, never two concurrent runs, because the D1 active-run check and the cap still gate each one. With D1 polling every tick, a long active run never leaves a single claim held for 300 s: each tick's claim is released within that tick.
- **TOCTOU in D2a.** Covered above: at most one rate slot per lost race.

## Migration Plan

V125 is additive (`ADD COLUMN ... DEFAULT 0`, a metadata-only default in PG ≥ 11). Rollback is safe because old code ignores the column. Re-check that V125 is still free on origin/main before committing.
