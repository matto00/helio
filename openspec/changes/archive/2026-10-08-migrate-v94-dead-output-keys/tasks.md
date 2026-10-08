## Standing Constraints

- [C1] Flyway version is exactly V117 (driver-assigned); if taken on origin/main, stop and escalate.
- [C2] Never apply V117 to the shared dev DB; EmbeddedPostgres only. Dev-DB access is read-only.
- [C3] Prove RLS-safety as a NOBYPASSRLS table-owning role; row-count backstop read over a superuser connection.
- [C4] `sbt testFull`/`testOnly`, never bare `sbt test`; cap parallelism at 3-4, `nice -n 19`; Bash timeout 600000.

### Backend

- [x] 1.1 Write `V117__migrate_v94_dead_output_config_keys.sql`: header with D1 mapping table + rulings; D5 bracket
- [x] 1.2 Audit table `hel1387_dropped_output_config_keys` (D4): IF NOT EXISTS + NO FORCE in-bracket; deny-all policy + GRANT SELECT helio_privileged + FORCE at end (D5)
- [x] 1.3 DO block implementing D1-D3 with the D2 audit-row contract (`config -> key`, action precedence); D7 guard
- [x] 1.4 Grep-verify per dropped key/kind that no reader exists (frontend `read*Config`, backend, helio-mcp); record

### Tests

- [x] 2.1 `V117DeadOutputConfigKeysMigrationSpec` per D8 (real dump, legacy columns set on real panels, role-run)
- [x] 2.2 Edge Outputs: null live, non-null live, invalid shape, wrong kind, legend/tooltip, non-hel904 id, clean control;
  metric_id chart (format dropped) + metric_id metric (format untouched)
- [x] 2.3 Idempotency: re-execute V117 as the role (unchanged); then re-insert a dead key and re-run (succeeds, +1 audit row)
- [x] 2.4 AC7: keys ⊆ KnownKeys(kind) and validate(kind,cfg,{}) Right post-V117 (both shown failing pre-V117); validate(kind,cfg,cfg) Right
- [x] 2.5 Audit table: 0 rows as helio, N as helio_privileged + superuser; add D4 entry to `RlsPolicyGuardSpec` rlsTables
- [x] 2.6 Mutation: remove the NO FORCE bracket → spec red; restore; record transcript
- [x] 2.7 Fix any latest-migrating spec that asserted a dead key (D9), named in files-modified.md
- [x] 2.8 Run the persistence/pipelines suites + FlywayNonSuperuserMigrationSpec via `sbt testOnly`; full gates

### Follow-ups

- [ ] 3.1 (Orchestrator, Delivery) File follow-ups: RestorePriorStored dead-key normalisation; metric `format` object vs string
