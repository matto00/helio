## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `407d0671858cc6961372972a7bcd67d29d8200df`. The base was resolved live with
`resolve-review-base.sh` and gave `99d6fedd71dacd14d308a3c9f52053efaf72210d`. origin/main is 3 commits ahead
(HEL-1389/1381/1388). None of them adds a migration; their only backend change is one new `OutputRoutesSpec` test,
and it uses an already-seeded owner. origin/main has no V119, so there is no version collision.

Owner rulings (Q1–Q4, delete-both, the multi-root CASCADE reach) were treated as fixed and not re-litigated.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/data-sources-owner-fk/HEL-1347`.
- **AC1: inventory.** `docs/user-reference-inventory.md` lists 28 FKs. I compared it with the live dev DB (Flyway
  119) using `pg_constraint` where `confrelid='users'`, and all 28 rows match with the same ON DELETE (`a`=NO ACTION,
  `c`=CASCADE). Nothing is undocumented and nothing documented is absent. I also searched `information_schema` by
  column name (`owner|user|grantee|actor|created_by|completed_by|_by|principal|email|...`). The only non-FK user
  references are `audit_events.actor_user_id`/`actor_token_id`, `dashboards/panels.created_by`,
  `connectors.completed_by` and `pipeline_runs.triggered_by_token_id`, and the doc lists every one.
  - The cascade-chain claims check out against `pg_constraint`:
    - roots → steps, outputs and binary_refs (CASCADE)
    - outputs → panels, alert_rules, alert_events and output_snapshot_history (CASCADE)
    - `parent_step_id` is NO ACTION
    - `connectors.credential_id` is RESTRICT
    - `triggered_by_token_id` is SET NULL
  - The audit residue claim is accurate. `audit_events` has three triggers (DELETE/UPDATE row and statement,
    TRUNCATE), all `tgenabled='A'` (ALWAYS).
  - The inventory spec test parses the doc table and compares it with a fully migrated DB, so the doc cannot
    silently drift.
- **AC2: data_sources FK decision and orphans.** Owner ruled CASCADE. V119 does five things:
  - it guards references first;
  - it deletes NULL-owner and orphan sources by exact id array, plus orphan image_uploads;
  - it sets NOT NULL;
  - it adds both `ON DELETE CASCADE` FKs;
  - it brackets five tables with NO FORCE/FORCE.

  The migration number is V119, which meets "V117 or later". The dev DB has 0 orphan or NULL-owner sources and FORCE
  is on for all 5 tables.
- **AC3: audit residue documented.** See the "Permanent audit residue" section of the inventory doc.
- **Spec delta.** Every scenario in `specs/user-reference-integrity/spec.md` maps to a named test in
  `V119OwnerFkMigrationSpec`, as listed below.

  Migration scenarios:
  - cleanup under the prod role shape
  - two-root abort
  - join, upsert-target and form-panel aborts
  - clean no-op

  Insert-rejection scenarios: 23503, 23502, and the image upload 23503.

  User-delete scenarios:
  - cascade delete
  - own-pipeline reject
  - cross-owner last-root reject
  - 2+-step-lane reject

  Inventory scenario: the doc-vs-schema comparison.
- **C2: the prod role shape is actually exercised.** The spec creates `helio_migration_test` as
  `NOSUPERUSER NOBYPASSRLS` and asserts `(rolsuper, rolbypassrls) == (false,false)`. It makes that role the schema
  owner and runs V1..118 as it, so the role owns every table. V119 then runs over a JDBC URL that connects as that
  role. Counts are read over a separate superuser connection.
  - My fresh run in a throwaway detached worktree at 407d0671:
    `testOnly V119OwnerFkMigrationSpec FlywayNonSuperuserMigrationSpec` gave `Suites: completed 2, aborted 0` /
    `Tests: succeeded 16, failed 0`.
  - The cleanup scenario logged `HEL-1347: deleted 2 orphaned or ownerless data_sources rows` and
    `deleted 1 orphaned image_uploads rows`.
  - The real-dump `FlywayNonSuperuserMigrationSpec` path logged `deleted 2 ...` as the same role.
- **Mutation (my own, chosen to differ from the evaluator's re-runs).** I restored the file after each one and
  confirmed the restore with `cmp`.
  - M2: drop `ON DELETE CASCADE` from `data_sources_owner_id_fkey` → RED, 4 failures (cleanup constraint
    assertion, cascade-delete, multi-root reach, inventory doc).
  - M5: drop `'lookup'` from the guard's `op IN (...)` list → **survives, 15/15 green**. The non-blocking note below
    covers this.
  - The evaluator's own re-runs (drop the `NO FORCE` on pipeline_roots or panels → RED at :144) and the executor's
    10 recorded mutations cover the bracket, each guard clause, the closing FORCE and the doc row.
- **C3: no fixture assertion was weakened.** I read the full diff of every touched existing spec.
  - Ten fixture specs each add exactly an import plus a `UserSeeding.seedUsers(...)` call that seeds real `users`
    rows. No constraint was relaxed and no assertion was changed.
  - `V94OutputsMigrationSpec` and `DatasetRowsReaderBehaviorPreservingSpec` are pinned to 118. Both test older
    migrations, so this is justified.
  - `FlywayNonSuperuserMigrationSpec` is pinned to 118 for its existing V106 assertions, then additively migrates to
    latest with new V119 assertions.
  - Two tests were deleted under the owner's "delete-both" ruling. Their premise (a NULL-owner row) can no longer
    exist.
  - Fresh run of all 16 affected or real-dump specs (the 10 fixture specs, RlsOwnerTables, RestSourceConnectorMigration,
    V94, DatasetRowsReader, SchemaFieldRealDumpInvariant, V118): `Suites: completed 16, aborted 0` /
    `Tests: succeeded 362, failed 0`.
- **No production NULL-owner write path.** In `DataSourceRepository.scala:113`, `None` comes only from an empty
  `UserId`, and the only `UserId("")` is on the read path (:49). Uploads are always written with the session user.
- **Guard completeness.** Only `dataset_rows` and `pipeline_roots` have FKs into `data_sources`, both CASCADE. The
  guard's reference kinds exactly match `DataSourceReferenceRepository` (root, join/lookup/union `secondaryInput`,
  upsertTarget, form panel). `pipeline_steps.config` is `text`, so `strpos` is well-typed.
- **Full suite.** The evaluator pasted `sbt testFull` EXIT=0 (6408 succeeded, 0 failed, 4 canceled) at the same
  HEAD. The 4 canceled tests are opt-in `HELIO_MEASURE` measurement specs this diff does not touch. That evidence is
  unambiguous, and the targeted re-runs above corroborate it.
- **UI:** none. No `frontend/**` changes, so step 4 was skipped.
- **mtime evidence:** no mtime-ordering claims were relied on.

### Verdict: CONFIRM

### Non-blocking notes
- The guard's op list is only partly pinned. Removing `'lookup'` (and by symmetry `'union'`) from
  `V119...sql:56` leaves the spec green, because only the `join` and `upsertsource` step kinds have fixtures. This
  has zero practical prod risk: the owner measured 0 orphans in prod, dev is already at 119, and the deletion target
  set is empty everywhere it will still run. It is still a surviving mutation on a data-deleting guard, so for
  future guard migrations, add one fixture per enumerated op.
- `RestSourceConnectorMigration`'s ownerless-row branch is now unreachable dead code (the evaluator also noted
  this). It is a candidate for a small follow-up.
- The inventory's "Dangling" list does not mention `resource_permissions` rows whose `resource_id` names a deleted
  source. Today only `dashboard`/`pipeline` grant types exist in dev, so nothing is affected. Worth a line for
  HEL-1301.
- `V119OwnerFkMigrationSpec.scala` is 413 lines, just over the ~400-line split threshold. Mention this in the PR.
