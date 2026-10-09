## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed worktree HEAD `99d6fedd71dacd14d308a3c9f52053efaf72210d`. The planning artifacts are untracked in the change dir. Owner rulings Q1–Q4 were taken as fixed. The dev DB was read only, through catalog and SELECT queries.

### What I verified (with evidence)

- **cwd guard:** returned `READY ambient=/home/matt/Development/helio branch=bug/data-sources-owner-fk/HEL-1347`.
- **`openspec validate data-sources-owner-fk --strict`:** "Change 'data-sources-owner-fk' is valid". Dev Flyway max version is 118.
- **Round-3 change requests are addressed in substance, not just re-worded:**
  - **CR1:** D7 and task 3.10 now name the `FlywayNonSuperuserMigrationSpec` breakage and prescribe the fix: migrate to 118, run the V106 asserts there, then migrate to latest and assert V119 deleted exactly the two NULL-owner sources. I checked this against the file. The single `migrate()` at `:280-286` is followed by the V106 block at `:426-469`, which calls `.head` on `18dc0d3b…` at `:452` and `:466` and reads its `dataset_rows` at `:457`. The split is feasible.
  - **CR2:** D6 now states the lane-length rule: only parentless steps carry `root_id`, and `parent_step_id` is NO ACTION. It moves 2+-step lanes into "Blocked" and hedges which error surfaces (RI trigger order). D7 pins the lane length in every user-delete scenario.
  - **CR3:** the spec scenario says "every table the migration relaxed it on". Task 3.2 asserts FORCE on all five tables, and 3.8 adds the "drop the closing FORCE for panels" mutation.
- **Inventory (AC1), re-derived from `pg_constraint`:**
  - 26 FKs to `users`: 12 NO ACTION and 14 CASCADE, exactly the D-Context lists.
  - A catalog scan for user-like columns with no FK (user/owner/actor/_by/grantee/principal/email) finds `audit_events.actor_user_id` and `actor_token_id`, `connectors.completed_by`, `dashboards.created_by`, `panels.created_by`, `data_sources.owner_id` and `image_uploads.owner_id`. The rest are non-references (`flyway installed_by`, `user_agent`, `email`, rollup counts).
  - Complete.
- **Cascade reach (D6), checked against `pg_constraint`:**
  - `pipeline_roots` cascades to `pipeline_steps.root_id`, `outputs.root_id` and `binary_refs.root_id`.
  - `outputs` cascades to `panels`, `alert_rules`, `alert_events` and `output_snapshot_history`.
  - `pipeline_steps_parent_step_id_fkey` is `a` (NO ACTION).
  - `api_tokens` → `pipeline_runs` is SET NULL. `connectors.credential_id` is RESTRICT, which D6 hedges as "measured by test".
  - The D6 statement is accurate.
- **Prod-role safety:**
  - `users` has RLS **off** (`relrowsecurity = f`). So `NOT EXISTS (users)` in the target predicate cannot go fail-silent and mark every source as orphaned. This was the most dangerous possibility, and it is ruled out.
  - `data_sources`, `image_uploads`, `pipeline_roots`, `pipeline_steps`, `panels` and `dataset_rows` are ENABLE + FORCE.
  - `image_uploads_owner` and `dataset_rows_owner` use a bare `current_setting`.
  - No user triggers exist on `data_sources`, `dataset_rows`, `image_uploads`, `users`, `pipeline_steps`, `outputs` or `panels`. The only one in that set is the V99 statement trigger on `pipeline_roots`. So V119's DELETE fires no RLS-sensitive trigger.
  - The `dataset_rows` cascade runs as an RI action, so the table needs no bracket.
- **Column types for the D3 guard:** `pipeline_steps.config` is TEXT, which suits `strpos`. `panels.form_config` is jsonb, so `->>` works. `data_sources.id` and `image_uploads.id` are TEXT, which suits `text[]`.
- **Test-evidence red-ness:**
  - **Two-root guard scenario:** without the `pipeline_roots` bracket, the guard reads 0 roots and the DELETE cascades one of two roots. V99 does not fire, the migration succeeds, and the test goes red.
  - **Form panel on a private dashboard:** without the `panels` bracket, the panel is invisible. The test goes red.
  - **Dropping a guard clause:** each one makes its non-FK scenario succeed, so that scenario goes red.
  - **Dropping the `data_sources` bracket:** gives 42704.
  - **Inventory test:** parses the doc, so doc drift goes red.
  - All of these would go red as claimed.
- **Real-dump fixture:** two NULL-owner sources (`e8c55620…`, `18dc0d3b…`) with 0 `image_uploads`. Only companion `data_types` rows (8551/8552) reference them, and V94 folds those away. No `pipelines` row references them, so the D3 guard will not trip on the dump.
- **Other existing specs that V119 will break:** I surveyed every spec that migrates to a target and then to latest.
  - The specs that seed sources (`V96…`, `V98…`, `V106…`, `PipelineStepsOpCheckSeededRowsSpec`) seed real `users` rows. The FK/NOT NULL fallout is task 3.9's domain.
  - **Two real-dump specs read `18dc0d3b…` after migrating to latest and are not covered by the plan.** See CR1.

### Verdict: REFUTE

The V119 core is sound: guard, brackets, FORCE restoration, NOT NULL, FK naming, and the prod-role proof. The cascade-reach statement now matches the catalog. One defect is the same class as round-3 CR1, which was fixed for only one of the three affected specs.

### Change Requests

1. **D7 / task 3.10: two more existing real-dump specs will go deterministically red, and the plan prescribes no remedy for them.** Like `FlywayNonSuperuserMigrationSpec`, each loads `hel904-real-dump.sql`, migrates to **latest**, and then reads the NULL-owner source `18dc0d3b-ad44-48cd-bc1d-f066726fc0f1`, which V119 deletes by the Q3 ruling:
   - **`backend/src/test/scala/.../V94OutputsMigrationSpec.scala`:**
     - `beforeAll` migrates to latest at `:237-242`.
     - The test "fold a real single-companion source's fields into data_sources.inferred_schema" (`:758-768`) runs `SELECT inferred_schema … WHERE id = $singleCompanionSourceId` (`:121` = `18dc0d3b…`) with `.head`. That gives a NoSuchElementException, so the test is red.
   - **`backend/src/test/scala/.../DatasetRowsReaderBehaviorPreservingSpec.scala`:**
     - Before migrating, it captures every static source and asserts `18dc0d3b…` is among them (`:143`).
     - It then migrates to latest (`:160`) and calls `repo.readDatasetRows` for each id with `getOrElse(fail("readDatasetRows returned None for migrated source …"))`. For the deleted source that `fail` runs, so the test is red.

   Task 3.9 does not cover these. Its remedy is "seed a real users row", and C3 forbids changing the dump's owner values, so these two would hit the unsanctioned real-dump-spec improvisation that round-3 CR1 was raised to prevent.

   **Required:**
   - Name both specs in D7 and task 3.10 with the prescribed fix. The natural fix is to pin each spec's post-dump migrate to `target 118`. Both specs exist to prove V94 and V106 behaviour respectively, not V119, so they lose nothing.
   - Add a step to task 1.1 or 3.10: grep every spec that loads `hel904-real-dump.sql`, or seeds a NULL-owner or orphan source, and then migrates to latest (`grep -rln 'hel904-real-dump\|MigrationVersion.fromVersion'` under `backend/src/test`). List the result in `files-modified.md`, so a third such spec cannot surface only at `sbt testFull`.
   - Keep `FlywayNonSuperuserMigrationSpec` as the single place that asserts V119's real-dump deletion. It is the one that runs as the prod-shaped role.

### Non-blocking notes

- **Guard-abort scenarios:** also assert `relforcerowsecurity` on all five tables after the failed migrate (round-3 note). This is cheap and shows that the rollback restores FORCE.
- **`pipeline_steps` bracket:** it still has no dedicated mutation. That is acceptable, because dropping it gives 42704 and the step scenarios assert the `HEL-1347:` text. Record that red in the executor's mutation notes anyway.
- **D-Context hard-codes dev counts** (57 / 303-306 / 7555). Keep them out of V119's header and the doc, as task 3.11 already says.
