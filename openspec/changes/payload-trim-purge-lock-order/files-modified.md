- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodePayloadHistoryRepository.scala` — D1: shared try-lock on OutputHistoryRepository.PurgeAdvisoryLockKey between INSERT and trim; skip on false; scaladoc lock contract
- `backend/src/test/scala/com/helio/infrastructure/persistence/NodePayloadTrimPurgeLockOrderSpec.scala` — two-role EmbeddedPostgres probe (40P01), regression via real writeAction, positive controls, role assertions
- `openspec/changes/payload-trim-purge-lock-order/{probe-40P01.txt,green-with-fix.txt,red-without-fix.txt}` — evidence transcripts

Task 1.2 run-side node-tx statement audit (PipelineRunService -> NodeSnapshotRepository.overwriteRowsWith -> one withSystemContext tx):
ownerLimit SELECT (no row lock); DELETE/INSERT node_snapshots (retention never touches it); INSERT node_payload_history (new uncommitted row; FK KEY SHARE on pipelines);
guarded trim (shared try-lock, then DELETE node_payload_history + SET NULL cascade on output_snapshot_history -- the only retention-visible row locks);
insertAction batch INSERT output_snapshot_history (new rows; FK KEY SHARE on outputs/own payload). No other statement locks rows retention locks.
