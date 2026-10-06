## Context

See proposal.md - Why. Ground truth on main 835b57d93:

- Run side: `PipelineRunService` (~1458-1463) composes `NodePayloadHistoryRepository.writeAction` ->
  `insertAndTrim` (INSERT payload, then `DELETE ... WHERE id = (SELECT id ... ORDER BY captured_at DESC, id DESC
  OFFSET keep LIMIT 1)`) -> `OutputHistoryRepository.insertAction`, all inside
  `NodeSnapshotRepository.overwriteRowsWith` = one `ctx.withSystemContext` transaction (privileged pool, D9).
- The trim's `ON DELETE SET NULL` (V116) runs an RI `UPDATE output_snapshot_history SET payload_id = NULL WHERE
  payload_id = $1`, row-locking every point linked to the payload (one per opted-in Output on the node) in scan
  (ctid) order, after first row-locking the payload row.
- Retention side: `OutputHistoryRepository.thinAndPurge` and `NodePayloadHistoryRepository.purge` are two separate
  privileged transactions, each starting with `pg_try_advisory_xact_lock(PurgeAdvisoryLockKey)` (EXCLUSIVE, try,
  skip on false) and then multi-row DELETEs on `output_snapshot_history` / `node_payload_history` in their own order.
- The run side takes no advisory lock, so a run trim and a retention pass can each hold one linked point the other
  needs -> deadlock; the run tx may be the victim -> node and run fail.

## Goals / Non-Goals

**Goals:** a global lock order "HEL1272 advisory lock before any retention-relevant row lock" on both sides; a run
never waits on retention; concurrent runs never serialize on the guard; code-only.

**Non-Goals:** retention SQL/semantics changes; schema/FK changes (no V117); `NodeSnapshotRepository` changes;
retention-pass starvation under sustained load (risk below).

## Decisions

### D1. Run-side trim takes the HEL1272 key SHARED with a try; skip the trim on false

In `insertAndTrim`, between the INSERT and the trim DELETE, run
`SELECT pg_try_advisory_xact_lock_shared(OutputHistoryRepository.PurgeAdvisoryLockKey)`. True -> run the trim as
today. False -> skip the trim (debug log), return the new payload id; the retention pass's existing per-node
newest-N DELETE removes the excess on a later pass. The lock is transaction-scoped (released at the node tx's
commit/rollback), same key the retention pass already uses, so no retention code changes and a rolling deploy with
old/new instances stays correct.

Why this closes the cycle: every retention statement runs only after its tx holds the key EXCLUSIVE; shared and
exclusive on one key conflict, so while retention runs no run can trim, and while any run is trimming retention's
try fails and it skips. The run's other statements touch only rows retention never locks (node_snapshots; its own
uncommitted payload/points, invisible to retention; FK KEY SHARE on outputs). Shared-shared does not conflict, so
runs never block each other on the guard. Neither side ever waits on the key (both are try), so the key itself
cannot participate in a deadlock.

Alternatives considered:
- EXCLUSIVE try-lock on the run side: concurrent runs would skip each other's trims (key held to node commit), so
  the write-time cap would routinely be missed under ordinary concurrency. Rejected.
- Blocking shared lock: no deadlock, but a run would wait for a whole retention pass (multi-table DELETEs). Violates
  "never blocks a run". Rejected.
- Defer the trim to the purge entirely (delete the run-side trim): simplest, but between hourly passes a 1-minute
  cron node can accumulate ~60 extra payloads x up to the 1 MiB byte cap, breaking HEL-1276's storage bound and the
  spec's write-time cap. The chosen design degrades to exactly this only for the rare write that overlaps a pass
  (at most one extra payload per overlapping write). Rejected as the default.
- Consistent ROW lock order (pre-lock linked points `ORDER BY id FOR UPDATE`, make thin/purge delete in id order):
  the payload purge locks payload-then-points while the run would lock points-then-payload, so it needs every
  retention statement rewritten to a common order; runs still wait on retention. Rejected: invasive, still blocking.
- Savepoint + catch 40P01: Slick has no savepoint DBIO; still waits deadlock_timeout; retention may be the victim
  instead and lose its pass. Rejected.

### D2. Deterministic two-connection probe + regression test (EmbeddedPostgres, two-role)

Fixture: owner-or-beta pipeline, one node, two opted-in Outputs (so one payload has >=2 linked points), a payload
config whose `maxRuns` makes the next write trim exactly one existing payload `P_old` linked to points X1, X2.
Connection A plays the retention pass: BEGIN, `pg_try_advisory_xact_lock(key)` (true), DELETE the linked point the
cascade locks LAST (pick by `ctid` order, asserted, not assumed). Then the run side executes the real
`writeAction` in a privileged transaction as a Future. Synchronize on observable state, never sleeps: poll
`pg_locks`/`pg_stat_activity` for an ungranted lock (bounded deadline) vs. the Future completing.

- Probe (documents the hazard; stays green after the fix): the run side issues the PRE-FIX trim SQL verbatim
  (unguarded) on connection B; once B is observed waiting, A deletes the other point -> assert SQLSTATE 40P01 on
  one of A/B. This is the reproduction.
- Regression (red without the fix): run side uses the real repository method. Assert the run Future completes
  successfully while A still holds its lock/row (no ungranted lock observed), then A deletes the remaining point and
  commits with no error; payload count = keep+1; then a real `purge` -> count = keep. Red evidence: revert D1, run
  the spec, capture the failure transcript, restore.
- Positive control: with no retention tx open, the same write trims to keep (cap enforced at write time); two
  concurrent run-side writes both trim (shared-shared).

### D3. Role topology

Both connections run as `SET ROLE helio_privileged` (BYPASSRLS, explicit grants only - the real run/retention
pool), with `helio_app_test` (NOSUPERUSER, no BYPASSRLS) set up exactly as `NodePayloadHistoryRlsSpec`. The spec
asserts in-test `current_user`, `rolsuper = false` for the run-side session, that the guard function is executable
by that role, that the SET NULL cascade under FORCE RLS on `output_snapshot_history` completes as that role, and
that the app role still cannot see a stranger's payload/points after the run. No superuser-run assertion counts as
proof. Place the specs under `backend/src/test/scala/com/helio/infrastructure/persistence/` next to the existing
RLS specs (plain `AnyWordSpec`, not a route spec).

## Risks / Trade-offs

- [Retention starvation] retention's try-exclusive fails whenever any node tx holds the shared key (from the trim
  to commit, sub-second); `claim()` then consumes the interval -> pass skipped for an hour. Effect is
  over-retention only, never a failure. -> Take the key immediately before the trim (not at tx start); note a
  follow-up (retry-sooner on skip) in the PR, not filed.
- [Cap overshoot] a write overlapping a pass leaves keep+1 payloads until the next pass. -> Spec scenario states it.
- [Hidden lock] other run-side statements may still meet retention. -> D1's argument is checked by the regression
  test holding real retention-shaped locks, and the skeptic should verify the statement list against code.

## Migration Plan

Code-only. Deploy in any order; old instances' retention already uses the same key exclusive. Rollback = revert.

## Planner Notes

- Self-approved: spec relaxation of "count enforced at write time" (ticket AC names try-lock-skip and defer as
  acceptable; no product decision beyond it).
- `PurgeAdvisoryLockKey` is `private[persistence]`, reachable from the same package; no visibility change needed.
- `NodeSnapshotRepository.scala` and PipelineRunService are not touched (HEL-1326 coordination; no HEL-1282
  exemption table impact).
