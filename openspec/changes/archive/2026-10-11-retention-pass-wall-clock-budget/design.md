## Context

See proposal.md (Why). Current code (origin/main bcb0e8919):

- `PipelineSchedulerService.tick()` builds `historyWork = outputHistoryRetentionService.purgeIfDue(now)`. It zips that work
  with the candidate, cleanup, auto-run and telemetry work, so the tick future completes only after the retention pass.
- `PipelineSchedulerActor` arms the next `Tick` only on `TickCompleted`. A pass of P seconds therefore delays the next
  scheduled fire (and the next auto-run debounce pass) by up to P.
- `OutputHistoryRetentionService.purgeIfDue` claims a slot by CAS on `nextDue`. It stores `now + purgeInterval` before
  the repository call, and only at the end of the pass rewrites `nextDue`:
  - to `now` (more work remaining);
  - to `now + lockRetry` (the lock was held);
  - or leaves it alone (the cycle completed, or a part failed).
- `OutputHistoryRepository.thinPass` runs at most `maxBatches` (default 20) batch transactions, each under
  `pg_try_advisory_xact_lock`. `thinAndPurge` (main code) is a test-only drain, with 32 test call sites.
- HEL-1435's measurements (section 6.2, section 10):
  - worst 20-batch pass is 96.7 s on S4 prod-io-base;
  - a single cold strict-IO batch is 77-172 s on S4;
  - the per-Output floor is one Output's rows (D9).

## Goals / Non-Goals

**Goals:**

- The tick's duration (and so the next fire) no longer includes any retention time.
- State the bound and prove it on the S4 prod-class proxy.
- Keep the lock, the next-due precedence and the continuation semantics exactly as they are.

**Non-Goals:** see proposal.md. In particular, no retention default changes.

## Decisions

### D1. Detach the pass from the tick (chosen) over a per-pass wall-clock budget, or a separate timer actor

`tick()` starts the retention pass and does not include it in the tick's result. The tick still triggers retention, at the
same cadence and through the same `purgeIfDue` interval gate.

- **Wall-clock budget (rejected).** Stopping before a new batch once T seconds have passed bounds the stall at
  T + (one batch). One batch is data-dependent and cannot be smaller than one Output:
  - S4 prod-io-base, longest batch 8.0 s;
  - S4 cold strict, 77-172 s per batch (section 6.2);
  - D9, 30-day outage, a single Output of 3.9 s warm and several times that cold.

  So the bound it could state is "T + an unbounded data-dependent term". It also adds an env var and a clock dependency
  to the repository loop.
- **Detach.** This bounds retention's contribution to the tick at zero, whatever the data shape or IO model. The remaining
  cost is contention: a concurrent pass sharing DB CPU and connections. That cost is measured (D5), not assumed.
- **Separate timer actor (rejected).** It gives the same decoupling, but adds a second timer, a new actor, `Main` wiring and
  a cadence env var. The trigger cadence was never the problem; awaiting the pass was.

### D2. An explicit in-flight guard: at most one pass per process

Today the tick's await is what prevents a second pass from starting while one is running. Once detached, the `nextDue` claim
alone does not prevent overlap:

- a pass longer than `purgeInterval` (a 1-minute interval is allowed; a cold pass takes minutes) would let a later tick
  claim again;
- two in-process passes would interleave the same cursor range.

`OutputHistoryRetentionService` gets an `AtomicBoolean` in-flight flag. **The order is fixed:**

1. Run `inFlight.compareAndSet(false, true)`. If it fails, return `Future.successful(None)` without reading or writing
   `nextDue`.
2. Run `claim(now)`. If the pass is not due, release the flag immediately (`inFlight.set(false)`) and return `None`. Every
   exit that does not start a pass releases the flag before it returns, including a synchronous throw during the claim
   or setup.
3. Otherwise, start the pass, built inside `Future.delegate`. The flag is released when the pass future completes, whatever
   the outcome (success, failure, or a synchronous throw from the repository). The release happens **after** the `nextDue`
   rewrite, so the following tick sees the new due time.

A tick that finds the guard busy therefore never consumes or moves the `nextDue` slot, and a not-due call can never wedge
the guard.

Cross-instance exclusion is unchanged: the advisory lock (HEL-1272), plus a lock-held skip retrying after `lockRetry`
(HEL-1343).

### D3. Failure handling stays, but is observed asynchronously

`tick()` still wraps the detached work in `Future.delegate(...).recover { log }`, so a synchronous throw or a failed future is
logged and never escapes. `tick()` itself returns success independently of the pass. The spec changes from "never fails the
tick" to "never fails or delays the tick".

### D4. `thinAndPurge` moves to test support

The drain becomes a helper under `backend/src/test/scala/com/helio/testsupport/`. It is built only on the public `thinPass`
and keeps the same signature defaults and the same `RetentionPassOutcome` mapping. All 32 call sites move to it.
`OutputHistoryRepository` loses the method and its "TEST-ONLY" doc. No other test-only member is added to production code
(C1). The `thinAndPurge` mention in the comment of `V120__history_retention_captured_at_indexes.sql` is **not**
edited. Changing an applied migration changes its Flyway checksum, and Flyway validation would then fail at boot on every
database that ran V120.

### D5. Measurement: the before/after tick latency on the HEL-1435 proxy (scratch only)

The measurement reuses `backend/scripts/perf/hel1435-container.sh` profiles and the S4 and S2 seeds, with these changes:

- new names `hel1477-*`;
- port 55477;
- a scratch DB `helio_hel1477_scratch` (the seed's refusal guard is kept, retargeted);
- the driver refuses any other URL.

The driver extends `HistoryThinMeasure` with a mode that builds the real `OutputHistoryRetentionService` and a real
`PipelineSchedulerService`, with one due interval schedule on a trivial static pipeline. Profile: `prod-io-base`, plus
`desktop` for continuity. It records:

| Metric | Measured where | Expected |
|---|---|---|
| (a) tick wall time with retention due on S4 | main (premise) | about the 20-batch pass time |
| (a) tick wall time with retention due on S4 | the branch | |
| (b) fire delay of a schedule that becomes due **during** a pass: tick-then-interval loop driven exactly like
`PipelineSchedulerActor` (next tick armed `tickInterval` after the previous tick completes, default 30 s), schedule due
a few seconds after a pass starts; delay = run row `created_at` − schedule's `next_run_at` | both | main ≈ pass remainder + interval |
| (c) the next tick's wall time while a pass is still in flight | branch | contention cost |
| (d) tick wall time with retention unwired | both | idle baseline |

Repetitions are 3 where feasible; any deviation is labelled.

(e) If cheap: a fired run's own duration with and without a concurrent pass (0.5 vCPU contention).
Note metric (a)'s due-at-tick-start schedule fires promptly on main too (the zip runs the candidate work concurrently), so
(b) — not (a) — is the AC metric. The stated bound in the PR is absolute: **fire delay ≤ tick interval + the tick's own
(non-retention) work**, with the measured worst case of (b) on S4 prod-io-base vs main. Results go in this change's `measurements.md` with raw logs under `evidence/`.

Host safety:

- `nice -n 19`;
- MemAvailable at or above 15 GB before each phase;
- one container;
- one sbt JVM at `-J-Xmx3g`;
- teardown of the container and volume by exact name, recorded.

### D6. Polish

The row-limit split test asserts the exact batch composition (which Outputs, in which batch, in what order) for the 30/30/5
fixture. Each assertion must fail under a mutation that ignores the row limit; the mutation is recorded.

measurements.md (archived HEL-1435) gets two edits:

- one sentence stating that `SET LOCAL work_mem` was not needed (0 spill at R=25,000, section 6.1);
- the "first clone of each pair was the colder run" parenthetical is cited to the specific evidence logs if they show it,
  or else dropped.

## Risks / Trade-offs

- [The DB CPU is now shared between a pass and later ticks' runs on 0.5 vCPU] → Measured as (c). Before, the pass already
  ran concurrently with the candidate work of its own tick (the zip). Retention still runs one batch transaction at a time,
  so it holds at most one privileged-pool connection (pool size 5).
- [A pass may be in flight at shutdown] → Unchanged in kind: the actor never awaited a tick at stop. The pass is
  idempotent, and a killed batch rolls back.
- [More scheduled runs now overlap a pass. A run's payload trim holds the retention lock shared, so batches hit lock-held
  skips more often and wait `lockRetry` (120 s) instead of the next tick] → Drains slow down but correctness is
  unaffected (HEL-1343 semantics). The measurement reports any lock-held skips it observes.
- ["Continues on the next scheduler tick" in the spec now means the first tick after the pass ends] → The spec delta
  states this explicitly.
- [Tests that asserted retention effects right after `await(tick())` become racy] → Those tests observe the pass through a
  capturing subclass of the service (its returned future), never through sleeps or real-time `eventually` (C2).
- [The CLAUDE.md row for `OUTPUT_HISTORY_THIN_MAX_BATCHES_PER_PASS` says the pass stalls the tick] → That row is updated to
  the new behaviour (it bounds pass length and DB contention, not the tick).

## Migration Plan

Deploy as normal; no migration. Rollback is a revert. No env var gates the change, because it alters no retention result,
only when the tick completes.

## Planner Notes

- Self-approved:
  - detach (D1) over the budget, per the measurements cited above;
  - no new env var;
  - the in-flight guard lives in the service.
- Not a product call: the ticket offers both designs, and no retention default or retention result changes.
- If D5's premise measurement on main does **not** show the tick awaiting the pass (pass time not reflected in tick
  time), stop and escalate rather than build.
