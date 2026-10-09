## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `407d0671858cc6961372972a7bcd67d29d8200df` against live-resolved base `99d6fedd71dacd14d308a3c9f52053efaf72210d`
(origin/main). Working tree clean at review time.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (inventory every user-reference column + ON DELETE): `docs/user-reference-inventory.md`. The FK table is
  machine-checked against a fully migrated DB (`V119OwnerFkMigrationSpec` "list exactly the foreign keys..."). Non-FK
  and indirect refs (audit_events actor columns, TEXT `created_by`/`completed_by`, `triggered_by_token_id`,
  `connectors.credential_id`) are listed separately.
- AC2 (data_sources CASCADE vs RESTRICT, orphan handling, V117+): owner-ruled CASCADE and in-migration deletion
  (C1). Implemented as V119, with image_uploads included per Q4.
- AC3 (audit_events residue documented): "Permanent audit residue" section.
- All tasks 1.1–3.11 are marked done and match the diff. No scope creep: the only non-ticket edits are fixture seeding,
  real-dump spec pinning, and the two owner-ruled ("delete-both") test deletions.
- Spec delta `user-reference-integrity` matches the implemented behaviour. Each scenario is covered by a named test.
- CONSTRAINTS C1–C5 are all honoured (details under Phase 2).

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates (fresh, my own run at 407d0671, the commit after the executor's last full run):**
- `nice -n 19 sbt testFull`, EXIT=0: `Total number of tests run: 6408` / `Suites: completed 458, aborted 0` /
  `Tests: succeeded 6408, failed 0, canceled 4`. This matches the executor's claim.
- **The 4 canceled tests existed before this change and are opt-in measurement specs, not regressions:**
  `DatasetWriteSubmitLatencySpec` "reports p50/p95 before vs. after (report-only; HELIO_MEASURE=1)" x3 (cancel reason
  "Measure was false set HELIO_MEASURE=1", :214), and `OutputFilteredMetricMeasurementSpec` "add no more than 500 ms
  (median of 20)" x1 ("enabled was false set HELIO_MEASURE=1", :50). This diff touches neither file.
- `check:scala-quality` clean (no inline FQNs; only informational soft-size warnings), `format:check` clean,
  `check:openspec` clean, `check:spec-structure` passed, `check:test-temp-dir-hygiene` clean,
  `check:repo-integrity` rc=0.

**C2: V119 is proven under the prod role shape.** The spec creates `helio_migration_test` as
`NOSUPERUSER NOBYPASSRLS` and asserts `(rolsuper, rolbypassrls) == (false, false)` in beforeAll. The schema is owned by
that role, and migrations 1..118 run as that role, so it owns every table. V119 is then applied over a
`user=helio_migration_test` JDBC URL. The testFull log shows Flyway connecting as
`jdbc:postgresql://localhost:.../v119_N?user=helio_migration_test` and applying V119 there, with
`HEL-1347: deleted 2 orphaned or ownerless data_sources rows` and `deleted 1 orphaned image_uploads rows` in the
cleanup scenario. All counts are read over a separate superuser connection that RLS cannot filter.
`FlywayNonSuperuserMigrationSpec` also takes the real hel904 dump through V119 as the same role and asserts exactly
the 2 NULL-owner sources are deleted, owned sources and rows are unchanged, and FORCE is on for all 5 tables.

**C5 / mutation spot-checks (my own runs).** I ran these in a throwaway detached worktree at 407d0671, so the
delivery worktree was never modified. Afterwards I confirmed with `cmp` that the scratch V119 was byte-identical to
the delivery worktree's, the delivery worktree's sha256 was unchanged, and the scratch worktree was removed.
- Drop `ALTER TABLE pipeline_roots NO FORCE ROW LEVEL SECURITY;`: RED, 14 passed / 1 failed. The failure is "abort,
  deleting nothing, when an orphan is one of TWO roots of a pipeline": `Expected exception
  org.flywaydb.core.api.FlywayException to be thrown, but no exception was thrown (V119OwnerFkMigrationSpec.scala:144)`.
- Drop `ALTER TABLE panels NO FORCE ROW LEVEL SECURITY;`: RED, 14 passed / 1 failed. The failure is "abort, deleting
  nothing, when an orphan is a form panel's source (on a dashboard with no public grant)", with the same assertion at :144.
- Both reproduce the executor's recorded results exactly. I did not re-run the other 8 claimed mutations.

**C3: fixture audit (driver ask).** Each of the 10 fixture specs changes by exactly +2 lines: a top-of-file
`import com.helio.testsupport.UserSeeding` and one `UserSeeding.seedUsers(db, <existing owner ids>)` call. Seven calls
are in beforeAll; `PipelineAnalyzeProposalRoutesSpec` seeds inside the one test that creates the other user. No
assertion, expectation, or test body was removed or loosened in any of them: DataSourceRepositorySpec,
DataSourceServiceSpec, DataSourceServiceCsvUrlSpec, CreateSourceEnvelopeSpec, SchemaInferenceRegressionSpec,
DataSourceServiceRestartPersistenceSpec, UpsertSourceConfigSpec, UploadRoutesSpec, PipelineStepRoutesSpec,
PipelineAnalyzeProposalRoutesSpec. The constraint is not weakened anywhere.
- Other edits to existing specs, each consistent with the design or an owner ruling:
  - `V94OutputsMigrationSpec` and `DatasetRowsReaderBehaviorPreservingSpec`: final migrate pinned to 118, as D7
    requires.
  - `FlywayNonSuperuserMigrationSpec`: pinned to 118 for the V106 assertions, then additive V119 assertions. No
    existing assertion was removed.
  - `RlsOwnerTablesSpec` and `RestSourceConnectorMigrationSpec`: one test each deleted, per the owner's "delete-both"
    ruling. Both premises (a NULL-owner row) are now unrepresentable.
- Unpinned real-dump specs, re-verified:
  - V118 spec: migrates `flyway(None)` at :178 but asserts nothing on data_sources/dataset_rows afterwards.
  - SchemaFieldRealDumpInvariantSpec: joins roots to sources, and the deleted sources have no roots.
  - V117 spec (also loads the dump, but is not in the design's list): pinned to 117, so unaffected.

**Migration review.**
- The guard covers every reference kind `DataSourceReferenceRepository` knows: roots, join/lookup/union
  `secondaryInput`, `upsertsource` existing-source target, and form panel `dataSourceId`.
- The guard runs before any DELETE, and the DELETE targets exactly the guarded id array.
- FORCE is restored on all 5 tables, including after a guard abort through transactional rollback. That case is
  asserted in `expectGuardAbort`.
- No NULL-owner write path exists in main: `DataSourceRepository.scala:113` maps `None` only from an empty `UserId`.

**Dev DB (read-only probe, no writes by me):** Flyway max 119 (success), 0 NULL-owner and 0 orphan data_sources, 0
orphan image_uploads, both FKs present with `confdeltype = 'c'`, and FORCE on for all 5 tables. Note that the dev
apply ran as superuser `matt`, so it is not C2 evidence. The C2 evidence is the spec above.

### Phase 3: UI Review — N/A
No UI trigger matched. The diff touches no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`;
the spec delta is under `openspec/changes/**`.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `V119OwnerFkMigrationSpec.scala` is 413 lines, over the ~400-line "propose a split" threshold in CONTRIBUTING.md. Its
  scenarios are already grouped by `should` block. Mention a possible split (migration scenarios / user-delete
  scenarios / inventory) in the PR description.
- `RestSourceConnectorMigration`'s ownerless-row defensive branch can no longer be reached after V119 (owner_id is NOT
  NULL). The removed test's comment acknowledges this. Removing the branch could be a small follow-up; it is
  deliberately out of scope here.
- In the PR body, state that the 4 canceled tests are HELIO_MEASURE opt-in measurement specs, so reviewers do not
  read "canceled 4" as a regression.
