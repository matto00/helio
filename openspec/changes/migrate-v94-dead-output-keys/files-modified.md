- `backend/src/main/resources/db/migration/V117__migrate_v94_dead_output_config_keys.sql` — the repair migration (rename/drop, audit table, NO FORCE/FORCE bracket, guard)
- `backend/src/test/scala/com/helio/infrastructure/persistence/V117DeadOutputConfigKeysMigrationSpec.scala` — new real-dump spec run as a NOBYPASSRLS owner: exact configs/audit rows, idempotency, AC7 validation, audit-table posture
- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsPolicyGuardSpec.scala` — rlsTables gains hel1387_dropped_output_config_keys (deny-all policy)
- `openspec/changes/migrate-v94-dead-output-keys/tasks.md` — ticked


## Dev-DB measurement (read-only, 2026-10-08; 2212 Outputs total)
Per dead key: `timelineOptions` (timeline) 1; `format` on a chart 1. Every other dead key: 0. Rows with any dead key: 2. No unknown (non-D1, non-KnownKeys) keys found.

## Task 1.4 reader grep
No frontend (`read*Config`), backend or helio-mcp code reads any dropped key from Output config. Hits for `seriesColors`/`axisLabels` are panel `appearance.chart`; `timelineOptions` appears only in a TimelineRenderer comment.

## Mutation transcript (task 2.6)
Commenting out `ALTER TABLE outputs NO FORCE ROW LEVEL SECURITY;` -> migration "succeeds" silently, spec FAILED: `69 was not equal to 0 (V117DeadOutputConfigKeysMigrationSpec.scala:177)` (superuser dead-key count). File restored; spec green again.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala` — D9 contract change: it migrates to latest and asserted V94's `format` on every metric_id Output; V117 now drops `format` from kinds that don't accept it (owner Q3), so the assertion is kind-conditional

## Cycle 2
- V117 filters `jsonb_typeof(config) = 'object'` in both the DO loop and the D7 guard (no constraint on `outputs.config` forbids a non-object: V94 declares only `JSONB NOT NULL DEFAULT '{}'`).
- Spec: new edge Outputs `e-array-config` (`["metricLabel"]`: byte-identical, no audit row, migration succeeds), `e-bad-sort` (`"sideways"` -> invalid-value), `e-table-format` (format dropped from a table). The spec's superuser dead-key count also restricts to object configs.
- Mutation (guard removed from the loop filter): Flyway migrate fails with `null value in column "config_value" of relation "hel1387_dropped_output_config_keys" violates not-null constraint`; spec FAILED. Guard restored; spec green.
