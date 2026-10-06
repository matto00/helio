## Why

The run-side payload trim (HEL-1276) deletes a `node_payload_history` row inside the node's snapshot transaction;
its `ON DELETE SET NULL` cascade row-locks every `output_snapshot_history` point linked to that payload, in index/ctid
order. The hourly retention pass (HEL-1272 `thinAndPurge` and the payload `purge`) deletes the same points/payloads in
its own order. The two can lock-invert and deadlock; if the run transaction is the victim the node and the whole run
fail, i.e. retention housekeeping fails a user's run.

## What Changes

- The run-side trim becomes a participant in the existing HEL1272 retention lock: it takes the lock in SHARED mode
  with a non-blocking try (`pg_try_advisory_xact_lock_shared`) and trims only when it gets it. If the retention pass
  holds the lock, the trim is skipped (never waited on) and the existing retention pass's per-node newest-N rule removes
  the excess later.
- The retention pass is unchanged (it already takes the same key EXCLUSIVE with a try and skips when unavailable), so
  concurrent runs never serialize on each other and a run never waits on retention.
- A deterministic two-connection probe reproduces the deadlock on main, and a regression test (red without the fix)
  proves a run's node write completes while the retention pass holds its lock and locks on the linked points.
- RLS/role proof on the two-role EmbeddedPostgres topology.
- Code-only; no migration.

## Non-goals

- Changing the retention pass's thinning/age/count semantics or its skip-on-contention behaviour.
- Changing `NodeSnapshotRepository`, the V115/V116 schemas, or the FK action (HEL-1326 owns the schemas).
- Fixing retention-pass starvation under sustained run load (documented as a residual risk).

## Capabilities

### New Capabilities

### Modified Capabilities
- `node-payload-history`: the per-node count cap is enforced at write time only when retention is not concurrently
  running; otherwise it is deferred to the next retention pass. Retention housekeeping never fails or blocks a run.

## Impact

- `backend/.../persistence/pipelines/NodePayloadHistoryRepository.scala` (trim guard).
- New/extended backend specs under `backend/src/test/scala` (EmbeddedPostgres, two-role).
- No API, schema, frontend or config change.
