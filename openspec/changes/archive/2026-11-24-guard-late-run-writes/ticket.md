# HEL-1541: After HEL-1518: close the reap-vs-write window for alerts, binary refs, schema baseline and Output schema; stop the prune deleting in-flight runs

## Description

origin_kind: followup
origin_ticket: HEL-1518

HEL-1518 moved the "is the run still open?" check into each node's snapshot/history/payload transaction. The guard
locks the pipeline row `FOR KEY SHARE`, then the run row `FOR SHARE`.

It deliberately did not cover four other success-chain writes:

* `AlertEvaluationService.evaluateForOutput`
* `binaryRefsUpsert`
* the schema-drift baseline write (`updateLastSourceSchema` / `Internal`)
* the per-Output `updateSchemaInternal`

These are protected only by the early open-check. A reap that lands after that check can still let them through. That
needs a heartbeat already older than `PIPELINE_RUN_STALE_AFTER_SECONDS` (default 600). The write-back path
(`applyPendingWriteBacks`) also runs before the node writes, behind only the early check.

There is a second problem. `deleteOldRunsInternal` keeps the newest 10 real runs per pipeline, and it can delete a run
row that is still in flight. If that happens between two node writes, the next guard sees the run as missing while the
pipeline still exists. The run then stops writing nodes, publishes nothing, and answers 409 "Run record no longer
exists; its outcome was discarded".

This is very rare. One fix to consider: exclude non-terminal runs from the prune.

## Acceptance Criteria (from the driver brief, restated)

1. Every success-chain write of a real run is enumerated (from the executor's success path) and classified as covered
   by the in-transaction run guard or not; every uncovered write that can land after a reap is brought under the same
   guard (same lock order: pipeline `FOR KEY SHARE`, then run `FOR SHARE`) or an equivalent one. At minimum: alert
   evaluation, binary refs, schema-drift baseline, per-Output schema, and the `upsertsource` write-back.
2. A reaped run's late writes write nothing and log one clear line; HEL-1511's "first terminal write wins" still holds.
3. The retention prune never deletes a non-terminal (queued/running) run.
4. Red-first deterministic tests (no sleeps; reap ordered between the early check and each write via a test hook or
   transaction ordering) for each covered write and for the prune skipping an in-flight run; per-write guard-removal
   mutations and the old prune predicate turn each red.
5. Full backend `sbt testFull` passes (in shards). No migration unless measured to be needed (next free: V149).
6. Any write that needs a behaviour decision (e.g. an external, un-sendable side effect) is escalated, not decided.
