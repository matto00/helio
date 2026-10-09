## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed worktree HEAD `99d6fedd71dacd14d308a3c9f52053efaf72210d`. The planning artifacts are untracked in the change dir. Owner rulings Q1–Q4 are fixed and were not re-litigated. The dev DB was read only, through catalog and SELECT queries.

### What I verified (with evidence)

- **cwd guard:** returned `READY ambient=/home/matt/Development/helio branch=bug/data-sources-owner-fk/HEL-1347`.
- **`openspec validate data-sources-owner-fk --strict`:** "Change 'data-sources-owner-fk' is valid".
- **V119 is free:**
  - `git fetch` + `ls-tree origin/main` shows V117 and V118 as the newest migrations.
  - No remote branch carries `V119`/`V12x`.
  - No sibling worktree has an uncommitted V119.
  - Dev Flyway max is 118.
- **Round-4 CR1 is addressed in substance:**
  - D7 now names `V94OutputsMigrationSpec` (`:243` migrate, `:121` = `18dc0d3b…`) and `DatasetRowsReaderBehaviorPreservingSpec` (`:143`, `:160` unpinned migrate as postgres), and prescribes "pin to 118" for both.
  - `FlywayNonSuperuserMigrationSpec` keeps the latest-migrate (`:286`), runs its V106 asserts at 118, and asserts that V119 deleted exactly the two NULL-owner sources.
  - Task 3.10a covers the audit of the remaining specs.
  - I re-derived the dump-loading set myself with `grep -rln hel904-real-dump`. Eight files mention it:
    - Five load it and migrate unpinned: FlywayNonSuperuser, V94Outputs, DatasetRowsReader, V118 (`flyway(None)` `:178`) and SchemaFieldRealDumpInvariant (`:87`).
    - `V117DeadOutputConfigKeysMigrationSpec` loads it but is pinned to 117 (`:175`), so it is unaffected.
    - V96 and V106 only *mention* it in comments; see the notes.
- **Real dump vs V119:**
  - I parsed the dump: 594 users and 141 data sources. 139 are owned by an existing user, 2 have no owner, and 0 are FK-orphans. There are 0 `image_uploads`.
  - The two target ids occur only 4 times: their two `data_sources` rows and two `data_types` companion rows. V94 deletes the companion rows (§ around `:494`).
  - No root, step config or form panel references either id, so the D3 guard cannot trip on the dump.
  - V118 and SchemaField assert only `outputs` counts and the many-steps pipeline's root source. Neither depends on the two doomed sources.
- **Existing seeded specs that migrate through V119** (V96, V98, V106, PipelineStepsOpCheckSeededRows): each inserts its `data_sources` with an `ownerId` that it also inserts into `users`. V119 deletes none of their rows and the guard does not trip.
- **AC1 inventory, re-derived from `pg_constraint`:**
  - 26 FKs to `users`: 12 NO ACTION and 14 CASCADE, exactly as listed in D-Context.
  - The only FKs into `data_sources` are `pipeline_roots` and `dataset_rows`, both CASCADE. There are no FKs into `image_uploads`.
  - `resource_permissions` holds only `dashboard` rows in dev, which is consistent with "data sources are not shareable".
  - The inventory is complete.
- **D3 reference kinds:** they match `DataSourceReferenceRepository.scala:16-20,75-96` exactly:
  - roots;
  - `join`/`lookup`/`union`/`upsertsource` step `config` (TEXT, so `strpos` works);
  - `kind='form'` with `form_config->>'dataSourceId'` (jsonb).
  - There is no other source-id-bearing column; I checked `information_schema` for `*source*`, `*upload*` and `*image*`.
- **Prod-role safety (D2):**
  - `users` has RLS off. So the target predicate `NOT EXISTS (users)` cannot go fail-silent and doom every source.
  - `data_sources`, `image_uploads`, `pipeline_roots`, `pipeline_steps`, `panels` and `dataset_rows` are all ENABLE + FORCE.
  - The policies are as D2 describes:
    - `data_sources_owner` / `image_uploads_owner` use a bare `current_setting`, which fails loud.
    - `pipeline_roots_select` = `helio_can_access_pipeline(pipeline_id)` and `panels_select` = `helio_can_access_dashboard(dashboard_id)`. Both are SECURITY DEFINER functions owned by `helio_privileged`, and both fail silent without the GUC.
    - `pipeline_steps_owner` uses a bare `current_setting` through `pipelines`.
  - The V99 function `hel913_prevent_zero_root_pipelines` is owned by `helio_privileged` with `row_security=off`, as D2 states.
  - The guard reads none of `pipelines` or `dashboards` directly, so the five-table bracket is sufficient.
  - The `dataset_rows` and `pipeline_roots` cascades are RI actions, so they need no bracket.
  - FK validation happens inside the bracket either way.
- **D6 cascade reach, checked against `pg_constraint`:**
  - `pipeline_roots` cascades to `pipeline_steps.root_id`, `outputs.root_id` and `binary_refs.root_id`.
  - `pipeline_steps` cascades to `outputs.node_step_id` and `binary_refs.node_step_id`.
  - `outputs` cascades to `panels`, `alert_rules`, `alert_events` and `output_snapshot_history`.
  - `pipeline_steps_parent_step_id_fkey` is `a` (NO ACTION), so 2+-step lanes block.
  - D6's statements of what is blocked, what is silently reached and what is left dangling are accurate.
- **NOT NULL (D5):**
  - `DataSourceRepository.scala:113` writes `None` only for an empty `UserId`.
  - `backend/src/main` has no raw `INSERT INTO data_sources/image_uploads`.
  - The self-approval is sound.
- **Would each piece of evidence go red against its defect?**
  - **Drop the `pipeline_roots` bracket:** the guard sees 0 roots (the pipeline has no public grant). The two-root DELETE leaves one root, so V99 is silent, the migration succeeds and the HEL-1347 assertion goes red.
  - **Drop the `panels` bracket:** a form panel on a private dashboard is invisible, so the scenario goes red.
  - **Drop the `data_sources` bracket:** gives 42704, so it goes red.
  - **Drop the `pipeline_steps` bracket:** the step scenarios assert the HEL-1347 text, so they go red whether this turns out to be fail-loud or fail-silent.
  - **Drop a guard clause:** that clause's scenario goes red, provided the fixture's own root is a live source. The mutation requirement forces this.
  - **Drop the closing `FORCE` on `panels`:** the `relforcerowsecurity` assertion goes red.
  - **Inventory doc drift:** the parse-based test goes red.
  - **Insert rejections:** they assert a SQLSTATE.
  - **User-delete scenarios:** they assert "nothing deleted" plus the SQLSTATE class, so they do not depend on RI trigger order.
  - All of this evidence is falsifiable.

### Verdict: CONFIRM

The design is sound enough to implement. Earlier rounds' change requests are genuinely resolved, and I found no defect that would ship wrong behaviour or produce evidence that cannot fail.

### Non-blocking notes

- **D7 factual slip:** it says "Seven specs load the dump". Only five do, and they are the ones listed minus V96 and V106.
  - `V96CanonicalizeInferredSchemaTypeMigrationSpec:25` and `V106DatasetRowsMigrationSpec:16` only mention the dump in comments. They seed their own rows with real `users` (`:66/:80` and `:55/:62`), and their unpinned migrates (`:113`, `:95`) run V119 harmlessly as a NOBYPASSRLS role.
  - The D7 remedy "pin V96/V106 to 118" is therefore unnecessary. It also conflicts mildly with task 3.10a's "pin or justify".
  - Prefer "justify, leave unpinned". Those specs incidentally give a second prod-role-shape pass of V119 over owned rows.
- **Connector user-delete outcome (D6/D7):**
  - `connectors.credential_id` is RESTRICT. RESTRICT is checked immediately, not at end of statement, unlike NO ACTION.
  - So the outcome depends on whether the `users` RI trigger for `connector_credentials` or the one for `connectors` fires first. Those fire in trigger-name order, i.e. by the textual order of OIDs, which can differ between environments.
  - The doc should record the observed outcome as "observed in a fresh migrated DB; order-dependent". It should not state it as a guarantee for HEL-1301.
- **No reference guard for `image_uploads`:**
  - V119 deletes orphan `image_uploads` with no guard. A live panel's `image_url` pointing at one would be left dangling.
  - The deleted count is 0 in prod and 0 in dev, and Q4 is ruled, so this does not block.
  - Mention it in the migration header or the doc next to the user-delete dangling-`image_url` note.
- **Fixture fallout (task 3.9) may be wide:** 172 test files touch `data_sources`/`DataSourceRepository`. Many are pure unit specs or already seed a user because `pipelines.owner_id` has an FK. Every fixture edit must still be listed per C3.
- **Keep dev numbers out:** keep the hard-coded dev counts in D-Context (57 / 2) out of V119's header and the doc, as task 3.11 already says.
