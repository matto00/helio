## Context

`PipelineRunExecutor` checks `runStateInternal` once before the success chain (the "early check"), then
`unblockedChain` applies write-backs and `PipelineRunSucceededWrites.onUnblockedRunSuccess` runs the chain. HEL-1518
added `PipelineRunRepository.runGuardAction` (pipeline `FOR KEY SHARE`, then run `FOR SHARE`; admits an open run or
one whose own `succeeded` write won) as the first action of each node's snapshot transaction only.

Success-chain write inventory (from `PipelineRunExecutor.onRunSuccess` onward), with today's coverage:

| # | Write | Where | Context | Today |
|---|-------|-------|---------|-------|
| W1 | `upsertsource` write-back | `DataSourceRepository.applyWriteBacks` | app pool, owner, one tx | early check only |
| W2 | node snapshot + history + payload | `NodeSnapshotRepository.overwriteRows(With)` | privileged tx | guarded (HEL-1518) |
| W3 | per-Output schema | `OutputRepository.updateSchemaInternal` | privileged, own tx | early check only |
| W4 | trunk binary refs | `BinaryRefRepository.overwriteForNode` | privileged tx | early check only |
| W5 | alert events | `AlertEventRepository.upsertFiringInternal` / `resolveInternal` | privileged, tx per rule | early check only |
| W6 | run terminal `succeeded` | `writeTerminal` | conditional on `completed_at IS NULL` | first-write-wins |
| W7 | `last_run_*`, W8 assertions, W9 auto-run cancel | `afterTerminalWin` | gated on W6 winning | covered by W6 |
| W10 | schema-drift baseline | `updateLastSourceSchema` (app, owner) / `...Internal` | own tx | early check only |
| W11 | insight render trigger | `insightTrigger.afterRunSucceeded` | after `succeeded` publish | only after a published success |

W4, W5 and W10 are eager `Future` vals: they start when `writesChain()` builds them, concurrently with the node fold
and W6, not after W2. Alert evaluation writes only `alert_events` rows (no email, webhook or other external send was
found in `services/alerts`), so a skipped alert write needs no behaviour decision.

Retention: `deleteOldRunsInternal` (called by `deleteOldRuns`, by run admission in `PipelineRunExecutor`, by the
failure path in `PipelineRunService`, and by the dormant `SparkJobSubmitter`) deletes real runs outside
(newest 10 UNION started in the last 24 h) or beyond the 300 newest (HEL-1578). It has no `completed_at` predicate.

## Goals / Non-Goals

**Goals:** W1, W3, W4, W5, W10 write nothing once the run is reaped or gone, under the same guard and lock order;
the prune never deletes an open run; first terminal write wins still holds.

**Non-Goals:** cross-write atomicity; reordering the eager siblings; reaper or retention-count changes; writes made
during engine execution (before the success chain); a migration.

## Decisions

Revised after design-gate round 1 (skeptic-design-1.md). Round 1 put the HEL-1518 row-lock guard into each write's own
transaction; that creates lock cycles with Order O* (`docs/live-draft-preview.md` section 8.3.1). The root cause: the
reaper locks run rows and THEN the pipeline row (its `last_run` CTE runs only after `reaped` is fully consumed), while
a pipeline delete or workspace teardown locks the pipeline row (and, for teardown, `data_sources` (0) and (3)) and
THEN the cascaded run rows. Any transaction that holds a pipeline lock conflicting with the reaper's no-key update,
or a `data_sources` lock, and then waits on the run row (or the reverse) closes a cycle with one of them. HEL-1518's
node guard escapes only because pipeline `FOR KEY SHARE` conflicts with neither the reaper nor (as a first lock) a
delete, and the node transaction takes no (0)/(3) lock. So this change adds NO new run-row or pipeline-row lock.

**D1. W3, W4, W5, W10 run only after the run's own `succeeded` write won.** They join W7-W9 behind
`afterTerminalWin(runId, "succeeded", won)`: W6 is the conditional `completed_at IS NULL` UPDATE, so once it won the
run is terminal-succeeded and can no longer be reaped, and a run that lost (reaped, or deleted) writes none of them.
They take no new lock, so their transactions keep exactly today's lock footprint and Order O* placement. The four
run inside ONE `afterTerminalWin` call (so a lost W6 logs one WARN for the group, D3). W4, W5 and W10 stop being
eager siblings of the node fold. Exact dependency: the gated group starts once the node fold has SETTLED
(succeeded or failed) AND W6 has returned, and only when W6 won; W3 (computed per node during the fold, from that
node's rows) is collected for each node whose write committed and only those schemas are applied. So a node failure
after a won W6 still runs W4, W5, W10 and the committed nodes' W3, exactly as today's eager siblings would, and a
fold failure never prevents them. HEL-1564's `PipelineRunDeletedRecovery` still settles
them as siblings: after a winning W6 a pipeline delete makes their failure not surface, as today. Alternative
rejected: a row-lock guard per write (round 1; deadlocks against teardown and the reaper as above).

**D2. (Withdrawn.)** Round 1's "W3 joins the node transaction" is dropped; it also misstated the no-history branch,
which calls `overwriteRows`, not `overwriteRowsWith`. W3 is covered by D1 instead and the node transactions are
unchanged.

**D3. Logging and affected tests.** With D1 no alert write ever starts for a lost run, so `AlertEvaluationService`
is unchanged. The single `afterTerminalWin` over the gated group logs its existing one WARN for a lost run;
`lateFinisher` logs the answer's WARN. `LateFinisherDeleteAfterWonSpec` "answer 404, publish no succeeded and leave no
run row when a post-fold binary-reference write then fails on the deleted pipeline" gates W6 on a delete completed
inside `beforeBinaryWrite`; under D1 that is a circular wait. It is re-expressed on purpose (D1 changed the
semantics): the delete completes before W6 is released, W6 loses, and the test asserts the binary-reference write
never starts (`binaryEntered` never completes) plus the 404. The reaper spec's example of a later failing write in
"Pipeline deleted while its run executes" becomes a node snapshot write. "HEL-1594 D2" and the "narrowness control"
still hold: HEL-1594 D2 gates the NODE FOLD on `terminalWritten`, deletes the pipeline in `beforeNodeFold` so
the first node guard trips `Missing` and the fold fails; with the group starting on fold SETTLE (not success) after
the won W6, its binary write still starts and `Await.ready(entered)` still completes.

**D4. W1 (write-back) uses a run-scoped advisory guard the reaper respects.** W1 must apply before W6 (a write-back
failure must finalize the run `failed`), so it cannot be gated on the win. Its existing owner `withUserContext`
transaction begins with `pg_advisory_xact_lock_shared(<RunOpenClassId>, hashtext(runId))` (the two-`int4` key form
with a dedicated class id constant: a key space PostgreSQL keeps apart from every single-`bigint` key, such as the
cycle lock (2) `72901101` or the `pipeline-run-concurrency` hashes) and then reads the
run's state (`completed_at IS NULL`, plain read, no row lock); a run that is not open fails the transaction with
`RunNoLongerOpen` before any write. The reaper's WHOLE WHERE becomes `CASE WHEN completed_at IS NULL AND status <> 'dry_run' AND
((heartbeat_at IS NOT NULL AND heartbeat_at < <staleCutoff>) OR (heartbeat_at IS NULL AND started_at < <legacyCutoff>))
THEN pg_try_advisory_xact_lock(<RunOpenClassId>, hashtext(id)) ELSE false END` (a `CASE` fixes the evaluation order,
so the try-lock is taken only for open, non-dry, stale rows and never for historical runs), so it SKIPS a run whose write-back transaction is open and reaps it on a later tick.
Deadlock freedom: the reaper's try-lock never waits, and the write-back takes the shared advisory lock FIRST, holding
nothing else while it can wait (it waits only on a reaper statement that holds the exclusive key, which never waits on
the write-back). Order O* is otherwise untouched: (0), (2), (3) and the step row are taken exactly as today, and the
advisory key is in its own (two-`int4`, dedicated class id) key space. RLS: the run-state read runs on the app pool as the owner (`pipeline_runs_owner`
admits the owner; proven on the RLS-enforcing `Hel1503EditorRunGapsSpec` harness). A pipeline delete or teardown does
not take the key; it is not this guard's concern (write-back rows already survive a pipeline delete by spec).

**D5. A W1 trip is a late finish.** `applyWriteBacks` recovers only `IllegalStateException`, so `RunNoLongerOpen`
reaches `unblockedChain`'s `NonFatal` case, which today records and publishes `failed`. That case gains a first arm
re-raising `RunNoLongerOpen`, so `onRunSuccess`'s existing `recoverWith` maps it to `lateFinisher` (409/404, its WARN,
no event, no terminal write). The executor passes the guard (`None` when no run repository is wired, as fixtures).

**D6. Node writes (W2) are unchanged** (HEL-1518 guard). `runGuardAction`'s scaladoc is not changed.

**D7. Lock order summary.** New locks: only the W1 shared advisory key (first in its transaction) and the reaper's
non-waiting try-lock. Order O*'s doc gains one sentence: the write-back transaction takes the run-open advisory key
before (0); the reaper only try-locks it; dataset writers still touch no pipeline row. Required tests: W1 parked
inside its transaction makes a concurrent reap skip that run (and a later reap after commit reaps it); W1 against a
workspace teardown of a tag holding the pipeline and its target dataset finishes without `40P01`, with a control that
puts the old round-1 row guard first and deadlocks.

**D8. The prune skips open runs.** `deleteOldRunsInternal`'s DELETE filter gains `completed_at IS NOT NULL`. Ranking
(newest 10, 24 h window, 300 cap) is unchanged and still counts open runs; an open run is simply never deleted. A
reaped run has `completed_at` set and is prunable as before. No index: the filter applies to rows already selected by
`pipeline_id` (V136 index). Five existing `PipelineRunRepositorySpec` retention tests seed with `insertRun` (queued,
`completed_at` NULL): ~158 newest-N, ~193 older-than-24h, ~205 cap and ~349 "does not affect dry-run records" (17 rows
instead of 15) go red, and ~338 "silent no-op for a non-owner" goes vacuous (nothing deletable whoever calls). All five
are re-seeded as terminal runs, deliberately, because the semantics changed (not a fixture edited to pass), reason
stated in each test. The old-predicate mutation must turn the new open-run test (3.6) red. The 409 "Run record no longer exists" path stays for other deletions.

**D9. Observable outcome of a reaped run's late writes.** W1: rolled back, 409, no event, no terminal write. W2: as
HEL-1518. W3-W5, W10: never started (W6 lost). The "one clear line" of AC2 is `lateFinisher`'s WARN (it names the run, the pipeline and why the outcome
was discarded); the `afterTerminalWin` skip WARNs (now four, one more for the gated group) are pre-existing
diagnostics, not the answer's log line. Accepted
consequence: when a reap lands after some node's W2 committed, that node's snapshot rows can be newer than its Output
schema until the next run (today W3 follows each node at once); `RowColumnOrder` (schema names present in the rows,
then the other keys) tolerates this, so the effect is cosmetic.
First terminal write wins holds unchanged; nothing outside W1 and the reaper takes a new lock.

## Risks / Trade-offs

- RLS on the app-pool run-state read (D4) is invisible on a superuser test pool: proven on the RLS-enforcing harness.
- A stale run is not reaped for as long as its write-back transaction stays open (an instance stalled inside that
  transaction holds it until the connection ends); still better than HEL-1518's node guard, where the reap waits.
- W3-W5/W10 now land slightly later (after W6 rather than concurrently); `succeeded` is still published only after
  the whole chain, so subscribers see the same final state.
- A future writer that locks the run row after a pipeline/source lock reopens the cycle; D7's doc note records why.

## Planner Notes

- Self-approved: gate-on-win for W3-W5/W10; run-scoped advisory key for W1 with a non-waiting reaper try-lock (a
  small reaper change, replacing round 1's "no reaper change" constraint). No dependency, API, schema or migration.
- Tests are deterministic: test hooks (as in `LateFinisherSpecBase`) reap between the early check and each write;
  lock-order cases wait on `pg_stat_activity` lock waits, never sleeps.
