## Context

`pipeline_auto_run_debounce` (V110, V125) holds one row per pipeline with a pending dataset-write auto-run:
`fire_at`, `claimed_at`, `guard_retry_count`. `AutoRunTriggerService.evaluateAndSchedule` calls
`PipelineAutoRunDebounceRepository.upsertDebounce` on `DataSourceService`'s successful-write branch, i.e. after the
row write has committed. `PipelineAutoRunDebounceFirer` claims due rows on the scheduler tick, unclaims while the
pipeline has an active run (HEL-1504), re-arms or drops on a guard rejection, and otherwise `releaseClaim`s
(compare-and-delete on `claimed_at`). A real run is admitted in `PipelineRunExecutor.executeRun`
(`insertRunIfUnderConcurrencyCap` / `insertGranteeRunIfUnderOwnerCap`, `ConcurrencyCapResult.Inserted`), then
`runAdmitted` lists Outputs and calls `backend.execute`, which is where source rows are first read. A `succeeded`
terminal write goes through `PipelineRunSucceededWrites.onUnblockedRunSuccess` -> `afterTerminalWin(runId,
"succeeded", won)`, which runs its body only if this run won the first-terminal-write race against the HEL-1511
reaper. Blocked runs and write-back failures persist as `failed`.

The row has no record of when its writes happened, and `fire_at` cannot stand in for one: `GREATEST` means a later
write computed on a lagging instance clock leaves `fire_at` unchanged, so it is not a per-write token.

## Goals / Non-Goals

**Goals:** a successful real run removes the pending auto-run of writes it read; writes after it keep theirs; every
decision is made from DB state; guards and HEL-1504's firer mechanics untouched (the HEL-1504 in-flight requirement
gains a carve-out, D7); the HEL-1729 e2e workaround removed.

**Non-Goals:** the pre-existing firer race (`hasActiveRunInternal` read, then `submit`); dry runs and previews;
changing `submit` or the admission lock transaction (HEL-1734 is extending those concurrently).

## Decisions

**D1. A globally unique write generation per debounce row (V144).** V144 creates sequence
`pipeline_auto_run_debounce_write_seq` and adds `write_generation BIGINT NOT NULL DEFAULT
nextval('pipeline_auto_run_debounce_write_seq')`. `upsertDebounce` sets `write_generation =
nextval(...)` on both insert and conflict-update, so every write that arms (or re-arms by a write) the row gets a new
value. V144 also grants `USAGE, SELECT ON SEQUENCE pipeline_auto_run_debounce_write_seq TO helio_privileged`
explicitly (the V113/V115/V128 rule; `upsertDebounce` runs as `helio_privileged`, and a missing grant would make
every upsert fail inside `DataSourceService`'s `.recover`, silently arming nothing in prod while superuser tests stay
green). The conflict SET uses `EXCLUDED.write_generation` (the DEFAULT already drew a fresh value). `unclaim`, `claimDue` and `rearmAfterGuardRejection` do not touch it: they are not writes. A sequence, not a
per-row counter, because the row is deleted and recreated (`releaseClaim`): a per-row counter restarting at 0 would let
a snapshot of the old row's 0 match a new row's 0 (ABA) and cancel an unread write. Sequence values are never reused.
Alternative rejected: a `last_write_at` timestamp compared with a run start time (clock comparisons across instances
and between statement time and commit time; the token is simpler and exact).

**D2. Snapshot immediately before admission (before any source read).** In `executeRun`, for a real run only, read
`SELECT write_generation FROM pipeline_auto_run_debounce WHERE pipeline_id = ?` via `withSystemContext` (new repo
method `pendingWriteGeneration`, `Future[Option[Long]]`) just before the `insertRunIfUnderConcurrencyCap` /
`insertGranteeRunIfUnderOwnerCap` call, and pass it through `runAdmitted` to the success path. A `CapExceeded`,
`NotAuthorized` or `PipelineGone` admission simply discards it. Placing it before admission means a write that lands
after the run started (admission commit) is never cancelled, matching the ticket line literally; a write landing in
the short snapshot-to-admission gap keeps its own auto-run (conservative). Ordering argument: a generation visible at
the snapshot was written by an upsert that ran after its dataset write committed, and `backend.execute` reads source
rows only after the snapshot, so every write behind the snapshotted generation is visible to the run (READ
COMMITTED: each later statement sees every commit before it). The snapshot is a separate statement, not inside the
admission transaction, so the HEL-1734 lock protocol is untouched. If the read fails, log WARN and use `None` (cancel
nothing). Dry runs take no snapshot.

**D3. Cancel only on a winning `succeeded` terminal write, awaited before success is reported.** Inside the
`afterTerminalWin(runId, "succeeded", won)` path of `onUnblockedRunSuccess`, when the snapshot is `Some(g)`, run
`DELETE FROM pipeline_auto_run_debounce WHERE pipeline_id = ? AND write_generation = g` (new method
`cancelIfGeneration`). The cancel future is sequenced into `writesChain()`'s `chain` (and its `deletedRecovery`
siblings), so it completes before `succeeded` is published and before the HTTP response returns; it carries its own
WARN-and-continue `recover`, so a cancel failure never fails the run (the auto-run then fires redundantly, as today).
It deliberately ignores `claimed_at`: if the firer holds a claim, its later `releaseClaim` / `unclaim` /
`rearmAfterGuardRejection` simply match zero rows (already no-op / `Superseded`). A crash between the terminal write
and the cancel leaves the row: only today's redundant run.

**D4. Failure path (the ticket's open question). Recommendation: a run that does not succeed cancels nothing, so the
write's auto-run "comes back" in the strongest sense: it was never removed.** This covers `failed`, blocked
(persisted `failed`), write-back failure, and a run reaped as abandoned (its `afterTerminalWin` loses, so D3 never
runs). Rationale: the write's effect has not been materialized, so its auto-run is still owed; a transient failure
gets the retry the write would have had anyway; and because nothing is deleted before success there is no in-memory
"restore" that a crash could lose. While the failing run is active the firer keeps the row pending (HEL-1504 unclaim)
and fires it after the run ends: exactly the pre-change behaviour, so this adds no new user-visible semantics. The
alternative (delete at run start, re-insert on failure) was rejected: a crash between delete and failure loses the
auto-run, and the restore would depend on per-instance state.

**D5. Multi-instance safety.** Every decision is a DB statement: the snapshot reads the row, the cancel is a
compare-and-delete on a sequence-unique token, and the upsert's `nextval` serializes on the row's `ON CONFLICT` lock.
The only value carried in process is the run's own snapshot token, used only by the same process that completes that
run (the same pattern as the firer's `claimed_at` token); losing it (crash) can only skip a cancel, never cause one.

**D6. e2e workaround removed.** Each `cancelPendingAutoRun` call in `e2e/hel1277-output-history-scrubber.spec.ts` is
immediately followed by a synchronous manual `runPipeline` that succeeds, so D3 now removes the row the preceding
`putRows` armed. Remove the three calls and the helper in `e2e/support/historySeed.ts` (and any import left unused).

**D7. Spec interaction.** The base HEL-1504 requirement "An auto-run that finds the pipeline already running fires
after that run completes" is MODIFIED with a carve-out: a pending auto-run whose writes a successful real run read
(snapshot generation unchanged) is cancelled instead of firing after the run. The firer code is unchanged: it still
unclaims while the run is active, and the cancel then removes the row. The coalescing requirement ("coalesce into
exactly one eventual run") is an upper bound and is left unmodified: cancelling yields zero auto-runs for writes a
successful run already materialized, which the new ADDED requirement states explicitly.

## Risks / Trade-offs

- A write committed but not yet upserted at snapshot time leaves a row that the run read: one redundant auto-run, the
  same as today (conservative direction only).
- Post-terminal window: the `succeeded` write sets `completed_at` before the cancel DELETE; a firer tick landing in
  those milliseconds sees no active run and fires the already-due row (one redundant auto-run, today's behaviour; not
  worth a lock). Tests asserting "no auto-run after a tick" drive the tick after the run returns.
- Rolling deploy: while old-revision instances still serve writes, their `upsertDebounce` does not draw a new
  generation on the conflict path, so a write they handle after a new instance's snapshot could be cancelled unread.
  Bounded to the rollout and self-healing on the next write or run.
- A run whose snapshot races a firer that already decided to submit can still produce today's concurrent auto-run
  (pre-existing race, Non-Goal).
- V144 must be renumbered to max+1 before merge if main has moved past it (driver ledger: V141-V143 reserved).

## Test plan (backend, EmbeddedPostgres; every test red first, mutations recorded in the executor's notes)

1. Cancel: write arms row -> real run succeeds -> row gone, no `auto-run` run after a tick. Red on base (row
   survives).
2. Write during the run: a test `PipelineExecutionBackend` whose `execute` calls `upsertDebounce` (deterministic
   seam, no timing race) arms a write after the snapshot and before success -> row survives with
   the new generation and fires. Base is green trivially, so its red comes from a recorded mutation (cancel by
   `pipeline_id` only, ignoring generation).
3. Failure path: write arms row -> real run fails -> row survives and fires. Red via recorded mutation (cancel on any
   terminal write, or snapshot-then-delete at start).
4. Grant: `has_sequence_privilege('helio_privileged', 'pipeline_auto_run_debounce_write_seq', 'USAGE')` from the
   migration chain via `ProductTelemetryDbHarness` (NOSUPERUSER), following `PipelineRootWriteGrantsSpec`; red by
   removing the GRANT.
5. Dry run cancels nothing; refused admission cancels nothing; ABA: row deleted and recreated between snapshot and success is not cancelled (red via a
   per-row-counter mutation); upsert (insert and conflict path) changes the generation; unclaim and
   rearm (Rearmed, Exhausted, Superseded) leave the `write_generation` column value unchanged (asserted).
6. In-flight carve-out: write armed before the run, debounce due mid-run, firer tick during the run (via the test
   backend seam) -> row unclaimed (HEL-1504), then cancelled at success, no second run. Red on base.
7. Existing HEL-1093/HEL-1504/HEL-505 suites still pass unchanged.

## Planner Notes

- Self-approved: V144 additive migration (driver-allotted number); hook placement in `PipelineRunExecutor` and
  `PipelineRunSucceededWrites`, not in `submit` (HEL-1734 overlap minimized; report this call site to the driver).
- Local migration testing needs a lane-private DB `helio_hel1739` (drop it at Delivery); the shared dev DB must not
  receive V144.
