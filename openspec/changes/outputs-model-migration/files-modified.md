# Files modified — HEL-904 (cumulative across all cycles)

Cycle 31 delta (this cycle) — evaluation-1.md fixes (data-loss corruption fix, RLS gap
closure, hygiene):

- `backend/src/main/resources/db/migration/V94__outputs_model.sql` — Critical Path item 1:
  section 10's "unbound panel" predicate broadened from `type_id IS NULL` to `kind = 'output'
  AND output_id IS NULL` (a strict superset covering the 58 real dev-DB panels whose `type_id`
  resolves to no pipeline), renamed its logged count to `stranded_output_panels_deleted`, and
  added `panels_output_kind_requires_output_id` CHECK constraint so this class of gap fails the
  migration loudly instead of silently corrupting rows in the future. Section 13 (orphan
  pipeline-output types) got a mirror observability fix: logs `orphan_data_types_no_pipeline_skipped`
  for the 77 dev-DB `data_types` rows with no owning pipeline (no functional change needed there
  — the join already correctly excludes them from getting a spurious `table` Output).
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala`
  — Critical Path items 1-3: (1) added `dt-stranded`/`panel-stranded`, a genuinely
  `pg_dump --data-only`-derived fixture (literal real dev-DB row content, not hand-invented) proving
  the stranded-panel fix with 3 new assertions; updated the 2.9(c) test group's step-key/count
  assertions for the broadened predicate. (2) task 2.11 remains partially hand-built — full
  `pg_dump` fixture replacement is still outstanding, flagged honestly in tasks.md, not silently
  closed. (3) added 3 new RLS assertions completing the AC: owner/other-tenant on `node_snapshots`
  with its own red-proof, and a genuine grantee-read proof (real `resource_permissions` grant) on
  both `outputs` and `node_snapshots`, exercising the sharing branch of `helio_can_access_pipeline`
  for the first time in this suite.
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala`,
  `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardPanelAclSpec.scala`,
  `backend/src/test/scala/com/helio/infrastructure/persistence/PaginationSpec.scala`,
  `backend/src/test/scala/com/helio/infrastructure/persistence/RlsPrivilegedDmlSpec.scala`,
  `backend/src/test/scala/com/helio/infrastructure/persistence/RlsSharingAwareTablesSpec.scala`
  — fixed a regression the new CHECK constraint surfaced (systematic-debugging: root-caused via
  the constraint-violation error naming the exact row): each of these pre-existing fixtures raw-
  INSERTed a panel with `kind = 'output'` and no `output_id`, purely to exercise generic
  ownership/RLS/pagination behavior unrelated to output-binding semantics. Changed `kind` from
  `'output'` to `'text'` (content-only, no `output_id` required) — behaviorally identical for what
  each of these tests actually asserts.
- `backend/src/main/scala/com/helio/domain/panels/OutputPanel.scala` — deleted the stale second
  scaladoc paragraph ("not yet registered in Panel.Registry ... left for the next increment") —
  every claim in it is now false; the full cutover landed in an earlier cycle.
- `backend/src/main/scala/com/helio/infrastructure/persistence/metrics/README.md`,
  `backend/src/main/scala/com/helio/services/metrics/README.md`,
  `backend/src/main/scala/com/helio/api/routes/metrics/README.md` — deleted (each directory held
  only a README describing a class deleted earlier in this ticket).
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/README.md`,
  `backend/src/main/scala/com/helio/services/pipelines/README.md` — updated to describe
  `Output`/`NodeSnapshot`/`OutputRepository`/`NodeSnapshotRepository` instead of the deleted
  `DataType`/`DataTypeRepository`/`DataTypeService` family.
- `openspec/changes/outputs-model-migration/tasks.md` — task 2.11 and 2.13 status updated to
  honestly reflect this cycle's partial/complete state (2.13 is now fully complete; 2.11 remains
  partial with the specific remaining gap named).

For all prior cycles' file lists (cycles 1-30 — dozens of files spanning the full domain-model
migration, repository/service/route deletions, schema reshape, and test retargeting), see
`execution-progress.md`'s per-cycle sections. This file reflects only the delta of the current
cycle per the executor instructions to overwrite on re-runs; the cumulative diff is
`git diff main...HEAD --name-only` (375 files).
