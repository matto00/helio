## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed HEAD `54c2f222e09adcaa49fcf0b86bf643a3fc3f3426`. The planning artifacts are uncommitted in the change dir. I read ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-run-sse/spec.md and skeptic-design-3.md, and re-checked the claims against `PipelineRunService.scala` and the migrations. I also ran a Postgres probe in a throwaway cluster under my scratchpad (not the dev DB), described below.

### What I verified (with evidence)

**Round-3 CR1 staged release: addressed, and the logic is sound.**
- In `onUnblockedRunSuccess`, the publish is still first (:1397). `materializedWrites` (:1404 onward), `updateMeta` (:1558) and `updateRun` (:1560) are all eager vals.
- After a full-chain fix, releasing the `pipeline_runs` row lock lets `updateRunTerminal` finish. `NodeSnapshotRepository.overwriteRows` stays blocked on the `node_snapshots` EXCLUSIVE lock, so no event arrives. That is correct, deterministic behaviour.
- A partial fix that publishes after `updateRun` but before `materializedWrites` would publish in stage 2. Stage 2 catches it.
- The fixture requirement is stated: at least one Output bound to an executed node, and a non-null `nodeSnapshotRepo`. Without it, the no-op branch at :1408 is reached.
- The dry_run pre-terminal definition is stated: no `pipeline_runs` row exists yet.
- The dry_run lock is not vacuous before the publish. `pipeline_run_rate_window` (V109) references `users`, not `pipelines`, and no dry-path write touches the `pipelines` row before `insertDryRun` (:1236-1239).

**The new per-relation non-vacuity check (assertion 3) cannot be satisfied for the two row locks.** I checked this directly.
- I started a throwaway cluster (`initdb` in the scratchpad, TCP 127.0.0.1:55433) with this setup:
  - tables `runs` and `parent`, plus `child` with an FK to `parent`;
  - one session holding `SELECT … FOR UPDATE` on `runs` id=1 and `parent` id=1;
  - one session running `UPDATE runs …`, which is the shape of `updateRunTerminal`;
  - one session running `INSERT INTO child …`, which is the shape of `insertDryRun`'s FK check.
- `pg_locks` while both waiters were blocked:
  ```
  2025637|transactionid||ShareLock|f        <- UPDATE waiter: the ungranted lock has relation NULL
  2025637|tuple|runs|ExclusiveLock|t        <- its lock on the relation is GRANTED
  2025636|transactionid||ShareLock|f        <- FK-check waiter: same pattern
  2025636|tuple|parent|AccessShareLock|t
  ```
- `select count(*) from pg_locks where not granted and relation in ('runs'::regclass,'parent'::regclass)` returned **0**.
- This is how Postgres row-lock waits work. The first waiter takes a heavyweight tuple lock, which is granted, and then waits on the holder's `transactionid`. That ungranted lock carries no relation.
- So D4 assertion 3 as written ("an ungranted `pg_locks` entry on that lock's own relation (`'pipeline_runs'::regclass` … `'pipelines'::regclass`)") is false even when the service backend really is blocked on the right lock:
  - it fails on correctly fixed code;
  - the real-run cases and dry_run can never go green;
  - the executor is told "must not weaken the case", so it either stalls or quietly rewrites the check.
- The `node_snapshots` check is fine. `LOCK TABLE … EXCLUSIVE` produces an ungranted `relation` lock with `relation = 'node_snapshots'::regclass`.

**No other new defect found.**
- D1, D2, D3 and D5 are unchanged.
- Tasks 1.2 to 1.4 cover every ticket AC.
- The spec delta matches D1 and D2.

### Verdict: REFUTE

### Change Requests

1. **design.md D4 assertion 3 (and the staged-release step 2 wording if it is shared): replace "ungranted `pg_locks` entry on the relation" with a check that a row-lock wait can actually satisfy.** The recommended shape:
   - (a) Hold each lock on its **own** dedicated JDBC connection. In the succeeded case that means one connection for the `pipeline_runs` row and a separate one for the `node_snapshots` table lock.
   - (b) For each lock, assert that some service backend `w` (pid not equal to any test connection) has that lock's holder pid in `pg_blocking_pids(w.pid)`.
   - (c) Optionally, as a relation tie-in, for the row locks also require a `tuple` lock on `'pipeline_runs'::regclass` / `'pipelines'::regclass` held by `w`. For `node_snapshots`, require an ungranted `relation` lock on `'node_snapshots'::regclass`.

   Using one connection per lock is what keeps the "this specific lock blocks something" property that round 3 asked for. `pg_blocking_pids` against a single connection holding both locks could not tell them apart. A tuple lock alone is not a safe anchor: a second waiter on the same row holds the tuple lock *ungranted* instead, so the check must not depend on granted/ungranted for tuple locks.

### Non-blocking notes
- In the succeeded case, after the fix, `persistAssertions` (an FK insert to `pipeline_runs`) may also queue behind the row lock as a second waiter. The CR1 shape handles that. Just don't assert "exactly one waiter".
- Round-1/2/3 note still stands: a 429 from the rate limit or concurrency cap publishes `queued` and never a terminal event. This is out of scope.
