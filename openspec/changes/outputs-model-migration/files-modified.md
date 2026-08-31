Cycle 3 delta (this executor turn — evaluation-2.md follow-up: real `pg_dump` fixture, markdown-
binding fix, tasks.md bookkeeping). For prior cycles' file lists (cycles 1-31), see
`execution-progress.md`'s per-cycle sections. The cumulative diff is
`git diff main...HEAD --name-only`.

- `backend/src/main/resources/db/migration/V94__outputs_model.sql` — evaluation-2.md's markdown-
  binding fix: every place the migration special-cased `type = 'text' AND type_id IS NOT NULL` to
  mean "data-bound, becomes an Output" now also matches `type = 'markdown' AND type_id IS NOT
  NULL` — the `panels.kind` backfill (section 4), the task 2.9(b) bound-panel-selection predicate
  (section 9's loop `WHERE` clause), the orphan-type "remaining bound panel" check (section 13,
  both the count-logging query and the loop query), and the Output-kind derivation (`out_kind`)
  which now maps BOTH `text` and `markdown` to the `markdown` Output kind, matching
  `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md:76`'s explicit statement
  that the `markdown` Output kind covers "today's data-bound text AND markdown panels."
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala`
  — full rewrite per the human coordinator's explicit, non-negotiable cycle-3 ruling: the fixture
  is now the REAL `pg_dump --data-only` dump (loaded verbatim, replacing — not supplementing — the
  previous ~800-line hand-built fixture), plus generic, data-driven assertions computed from the
  real data (not fixed hand-picked expected values) for every required migration behavior: the
  markdown-binding fix end-to-end, the full stranded-panel predicate (count derived from the real
  data, not hardcoded), aggregation/metric tail-step config for every surviving real
  aggregation/metric panel, invalid-fieldMapping-slot dropping on a real chart panel, companion-type
  schema folding, orphan-pipeline-output-type Output creation, alert-rule resolution (two rows
  seeded on top of the dump, since the dev DB carries zero), row-for-row `node_snapshots` equality
  for EVERY live pipeline that had `data_type_rows` (not just 1-2 hand-picked ones), and the RLS
  smoke tests (re-targeted at real pipelines/owners instead of synthetic ones, with a
  `resource_permissions` grant seeded on top for the sharing-branch proof).
- `backend/src/test/resources/db/fixtures/hel904-real-dump.sql` — NEW. The real `pg_dump
  --data-only --inserts --disable-triggers --no-owner --no-privileges` snapshot of the shared dev
  DB (2026-08-30, schema version V93) for `users`, `data_sources`, `data_types`, `pipelines`,
  `pipeline_steps`, `panels`, `dashboards`, `metrics`, `binary_refs`, `data_type_rows`, and
  `patch_set_applications`. The dump's psql-only `\restrict`/`\unrestrict` meta-commands were
  stripped (not valid SQL, unrecognized by a raw JDBC statement) and the `SET
  transaction_timeout = 0;` line was stripped (the embedded-Postgres test dependency's server
  version predates that GUC). Otherwise loaded byte-for-byte.
- `openspec/changes/outputs-model-migration/tasks.md` — task 2.11 marked genuinely complete (was
  `(partial)` while checked `[x]`, the fourth instance of that bookkeeping defect on this ticket);
  text rewritten to describe the real-fixture replacement and the defects it surfaced.

Cycle 3 delta, second pass (URGENT security fix — same turn):

- `backend/src/test/resources/db/fixtures/hel904-real-dump.sql` — **scrubbed** the real `pg_dump`
  fixture landed above: the coordinator/evaluator confirmed 594 `users` rows carrying live bcrypt
  password hashes and real email addresses (including the repo owner's own personal address),
  plus one `data_sources` row embedding a real local Postgres host/user/database triple. See
  `execution-progress.md`'s "Cycle 3 — fixture credential scrub" section for the exact scrub
  transformation, verification commands, and mutation-testing proof that the scrub did not weaken
  either of `V94OutputsMigrationSpec`'s two defect-catching assertions.
- `backend/src/main/resources/db/migration/V94__outputs_model.sql` — fixed a stale comment
  (section 4, `panels.kind` backfill) that said "markdown/image/divider map straight through
  (content panels, never data-bound)" even though the very next lines special-case `markdown`
  exactly like `text` for a data-bound row. No SQL/behavior change — comment only. (Also confirmed,
  not changed: all five `type IN ('text', 'markdown')` call sites, including line 560's `out_kind`
  derivation, are already symmetric — no further code fix needed there.)

Cycle 4 delta (final-gate round 1, three of four skeptics REFUTEd — see
`final-skeptic-migration-correctness.md`, `final-skeptic-deletion-sweep.md`,
`final-skeptic-wire-contract-diff.md`):

- `backend/src/main/resources/db/migration/V94__outputs_model.sql`:
  - Section 9's aggregate-tail `next_position` computation changed from
    `COALESCE(MAX(position)+1, 0)` to `GREATEST(COALESCE(MAX(position)+1, 0), 1)` — the trunk-last
    step has no pre-existing children, so the bare `COALESCE` fell through to position 0 and put
    the aggregate step ON THE TRUNK (4 of 5 real cases on the dev DB), not on a tail
    (migration-correctness CR 1).
  - `hel904_migration_counts`'s `CREATE TABLE` moved from section 10 to section 8, and a new
    `alert_rules_cascade_deleted_companion_type` count logged there, since section 8's
    `DELETE FROM data_types` cascade-deletes any alert rule/event targeting a companion type via
    the pre-existing `ON DELETE CASCADE` FK — previously silent, unlike every other destructive
    step in this file (migration-correctness CR 3).
  - New section 14a: quarantines (deletes, with a logged count) any `alert_rules`/`alert_events`
    row left with `target_output_id IS NULL` after section 14's retarget (a rule whose type had no
    owning pipeline), then applies the `SET NOT NULL` that ticket scope item 6 requires and that
    was previously never applied — such a row was otherwise unrecoverable once
    `target_data_type_id` is dropped, and both repositories throw reading it
    (migration-correctness CR 2).
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala`:
  - Aggregate-tail test now asserts `position >= 1` for every migration-created tail step
    (migration-correctness CR 4 — the test's own name promised this and never checked it).
  - New test group "V94 data migration step 2.9(g) (computed_fields -> compute pipeline steps)":
    the `computed_fields` -> `compute`-step path had zero direct test coverage before this cycle
    (migration-correctness CR 5); asserts count, op, config keys/values, and parent chain against
    real captured pre-migration data.
  - `node_snapshots` RLS assertion strengthened from a vacuous `size should be >= 0` to
    `should not be empty`, plus a new red-proof (drop/restore `node_snapshots_select`) and a new
    grantee-read test, mirroring the `outputs` table's existing three-part RLS proof
    (migration-correctness CR 6).
- Six package `README.md` manifests updated to describe post-deletion contents instead of the
  deleted DataType/Metric/bound-panel classes (deletion-sweep CR 1):
  `backend/src/main/scala/com/helio/domain/panels/README.md`,
  `backend/src/main/scala/com/helio/api/protocols/pipelines/README.md`,
  `backend/src/main/scala/com/helio/api/routes/pipelines/README.md`,
  `backend/src/main/scala/com/helio/api/protocols/panels/README.md`,
  `backend/src/main/scala/com/helio/api/routes/panels/README.md`,
  `backend/src/main/scala/com/helio/services/panels/README.md`.
- `schemas/patch-sets/patch-set.schema.json` — removed the deleted `dataType` (and non-existent
  `metric`, never present) target kind from `EditTarget.kind`'s enum and the schema's/Edit's
  description strings; the app-level `recognizedKinds` (`PatchSetProtocol.scala`) already rejects
  it — this closed the phantom-deferral gap where `execution-progress.md` had pointed at a
  non-existent section-3/4 task (deletion-sweep CR 2).
- `openspec/changes/outputs-model-migration/specs/workspace-resource-search/spec.md` — corrected
  the "DataTypes and Metrics are no longer a searchable kind" scenario, which asserted the
  opposite of shipped behavior (`WorkspaceResourceType.DataType` and the `"dataType"` wire value
  are retained, only `metric` was removed) — now documents the `dataType` kind as a deliberate,
  named transitional label (wire-contract-diff CR 1).
- `openspec/changes/outputs-model-migration/design.md` — extended the "exactly two" wire-naming
  exemption list to the actual four field-name exemptions plus one wire-value exemption:
  `PipelineAnalyzeProposalResponse.outputDataTypeName`, its `AssistantProposalToolSchemas` mirror,
  and the `"dataType"` `WorkspaceResourceType`/`resourceType` wire value (wire-contract-diff CR 2).
