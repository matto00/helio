## Context

Inventory (live dev schema at Flyway 118, cross-checked against migrations V10/V14/V54/V91/V93/V94):

- **No FK:** `data_sources.owner_id` (V14, nullable), `image_uploads.owner_id` (V54, NOT NULL), `audit_events.actor_user_id`
  / `actor_token_id` (V91, append-only by design), TEXT provenance `dashboards.created_by`, `panels.created_by`,
  `connectors.completed_by` (V103, TEXT principal).
- **Indirect (via another user-owned table):** `pipeline_runs.triggered_by_token_id → api_tokens` `ON DELETE SET NULL`
  (measured: `confdeltype = 'n'`); `connectors.credential_id → connector_credentials` `RESTRICT` (both parents cascade
  from `users`; behaviour inside one user-delete cascade is measured by test, D7).
- **FK `NO ACTION`:** dashboards, panels, pipelines, outputs, alert_rules, alert_events, assistant_conversations,
  assistant_daily_usage, authoring_conversations, patch_set_applications, pipeline_run_rate_window, invite_codes.
- **FK `CASCADE`:** connectors, connector_credentials, connector_completion_tokens, api_tokens, user_sessions, user_mfa,
  mfa_backup_codes, mfa_login_challenges, share_tokens, agent_memory, agent_preferences, product_events,
  user_dashboard_zoom, resource_permissions.grantee_id.
- Dependents of `data_sources`: `dataset_rows.data_source_id` CASCADE, `pipeline_roots.data_source_id` CASCADE; the
  V99 statement trigger `hel913_prevent_zero_root_pipelines` (SECURITY DEFINER) raises if a `pipeline_roots` delete
  leaves a pipeline with zero roots.
- RLS: `data_sources`, `image_uploads`, `pipeline_roots`, `dataset_rows` are ENABLE + FORCE. `data_sources_owner` uses a
  bare `current_setting('app.current_user_id')` (raises 42704 when unset). Prod Flyway runs as `helio`: table owner,
  NOSUPERUSER, NOBYPASSRLS (MISTAKES.md "RLS policies never run in dev or CI"; V114/V117 headers).
- Dev (drifts): ~57 orphaned + 2 NULL-owner data sources, 0 orphan image uploads. No app code deletes users.

Owner rulings (escalation `HEL-1347-1791524129422-7b8815`, chat, 2026-10-09): Q1 CASCADE, Q2 delete orphans in the
migration (approved prod deletion, prod count checked before release), Q3 delete NULL-owner rows too, Q4 include
`image_uploads`.

## Goals / Non-Goals

Goals: V119 + both FKs + NOT NULL, proven as `helio`; documented inventory and cascade reach. Non-goals: see proposal.

## Decisions

**D1 — One migration `V119__data_sources_image_uploads_owner_fk.sql`.** V117/V118 exist on origin/main; no branch or
worktree carries V119+ (checked 2026-10-09). Additive; never edited after apply.

**D2 — RLS bracket on five tables.** `ALTER TABLE ... NO FORCE ROW LEVEL SECURITY` at the top and `FORCE` at the
bottom (V117 precedent) for `data_sources`, `image_uploads` (the deletes; `data_sources_owner` raises 42704 when the GUC
is unset) and `pipeline_roots`, `pipeline_steps`, `panels` (read only by the D3 guard). Two are fail-*silent* as `helio` with no GUC:
`pipeline_roots` (guard counts zero roots) and `panels` (`helio_can_access_dashboard` shows only dashboards with a public
grant, so form panels on private dashboards vanish). Without their brackets the guard passes vacuously and V119 deletes
sources still in use. `pipeline_steps` raises 42704 (fail-loud), bracketed for the same reason. The V99 trigger is NOT the reason for the bracket: since V100 (HEL-974) its function is owned by
`helio_privileged` with `SET row_security = off`, so it already sees every row. Do not set `app.current_user_id`; do not
rely on BYPASSRLS. FK validation and RI cascade actions run as the table owner without RLS, so the constraint steps need
no bracket of their own.

**D3 — Guard before delete, over every reference kind.** In one `DO` block, collect the target ids into a `text[]`
variable (`array_agg(id) FROM data_sources WHERE owner_id IS NULL OR NOT EXISTS (users)`), then count references of
every kind `DataSourceReferenceRepository` (HEL-1252) knows: `pipeline_roots.data_source_id = ANY(targets)`;
`pipeline_steps` with `op IN ('join','lookup','union','upsertsource')` whose TEXT `config` contains a target id
(`strpos`, deliberately conservative: a false positive only aborts loudly, never deletes); `panels` with
`kind = 'form' AND form_config->>'dataSourceId' = ANY(targets)`. If the `COALESCE`d total is non-zero, `RAISE EXCEPTION` with a
`HEL-1347:` message giving the per-kind counts, before any DELETE. Transactional DDL rolls Flyway back fully, so a deploy
fails before the new revision serves, with an actionable message, rather than V99 aborting mid-delete or V119 leaving
dangling step/panel ids silently. Ruled by the owner: fail loudly. **Pre-release prod measurement (owner, Cloud SQL
Studio, ~2026-10-09T05:45Z, rolbypassrls = t):** ds_total 37, ds_null_owner 0, ds_orphan 0, doomed_dataset_rows 0,
doomed_pipeline_roots 0, img_orphan 0. The target set is empty in prod, so no reference of any kind can point at it; V119
deletes 0 prod rows. The guard and count logging stay for other environments and for drift before release.

**D4 — Delete, log, constrain.** `DELETE` the target data sources (cascades `dataset_rows`), `DELETE` orphaned
`image_uploads`, each `GET DIAGNOSTICS` + `RAISE NOTICE 'HEL-1347: deleted % ...'`. Then
`ALTER TABLE data_sources ALTER COLUMN owner_id SET NOT NULL`, `ADD CONSTRAINT data_sources_owner_id_fkey FOREIGN KEY
(owner_id) REFERENCES users(id) ON DELETE CASCADE`, same for `image_uploads_owner_id_fkey` (Postgres default naming,
as `pipelines_owner_id_fkey`/`dashboards_owner_id_fkey`). Owner indexes already exist (`idx_data_sources_owner_id`,
`idx_image_uploads_owner_id`), so the CASCADE lookup is indexed; no new index.

**D5 — `NOT NULL` in the same migration (self-approved, see Planner Notes).**

**D6 — Cascade reach (stated per the owner's request).** `DELETE FROM users` now reaches `data_sources` →
`dataset_rows` and `pipeline_roots`, and `image_uploads`. A `pipeline_roots` delete cascades further: `pipeline_steps`,
`outputs`, `binary_refs` (all `root_id` CASCADE), and `outputs` → `panels`, `alert_rules`, `alert_events`,
`output_snapshot_history`. Only a lane's FIRST step carries `root_id`; later steps hang off it via
`pipeline_steps.parent_step_id` (`NO ACTION`), so a root whose lane has 2+ steps cannot be cascaded away (23503).
Consequences (expected; each pinned by a test with an explicit lane length, and the doc records the measured result):
- **Blocked (whole statement, nothing deleted):** any user who owns a dashboard, panel, pipeline, output, alert rule/event,
  conversation, patch-set, invite code, daily-usage or rate-window row (`NO ACTION`); any cascade that would remove a
  pipeline's last root (V99 trigger for a 0/1-step lane; 23503 on `parent_step_id` first for a 2+-step lane — the
  error that surfaces depends on RI trigger order, so tests assert "rejected, nothing deleted" plus the SQLSTATE class,
  not a specific constraint); any cascade into a root whose lane has 2+ steps (23503).
- **Silently reached (the CASCADE ruling's real cost):** if the deleted user's source is *one of several* roots of a
  pipeline owned by someone else AND that root's lane has at most one step, that step, its Outputs, alerts, history and
  bound dashboard panels are deleted from the other user's workspace, and V99 does not fire. Today `POST` root creation requires an owned source
  (`findByIdOwned`), so this needs legacy or direct-SQL data; it is still possible and is tested (3.6) and documented.
- **Dangling (non-FK):** another user's step `secondaryInput`/`upsertsource` target or form panel `dataSourceId`, an
  image panel `image_url` pointing at a deleted upload, and TEXT ids left in snapshot/history rows.
- `connectors.credential_id RESTRICT` within one cascade: measured by test, documented as measured.
Recorded as follow-ups for HEL-1301's account-deletion design. V119 itself never reaches any of this: its guard aborts
on any reference to a target before deleting.

**D7 — Tests.** New `V119OwnerFkMigrationSpec` following `V117DeadOutputConfigKeysMigrationSpec`: EmbeddedPostgres, a
`helio_migration_test` NOSUPERUSER NOBYPASSRLS schema-owning role (+ `helio_privileged` BYPASSRLS, as V117's spec), migrate
to 118, seed via superuser (owned, orphaned, NULL-owner sources with dataset rows; orphaned/owned image uploads), migrate
119 as the role, assert every count over the superuser connection. Separate DBs for:
- **Guard, root kind:** a pipeline with TWO roots (the orphaned source + a source owned by a live user), so V99 would NOT
  fire and only the guard can stop it. Assert the `HEL-1347:` message text and zero rows deleted.
- **Guard, non-FK kinds:** one DB each for a `join` step `secondaryInput` source, an `upsertsource` `existingSource`
  target, and a form panel `dataSourceId` pointing at an orphan — the form panel on a dashboard with NO public grant
  (otherwise RLS would still show it and the panels-bracket mutation could not go red); each asserts the `HEL-1347:`
  message, nothing deleted. The DELETE targets exactly the guarded id array.
- Clean no-op; insert rejections asserting SQLSTATE (23503 FK, 23502 not-null); user-delete scenarios asserting SQLSTATE
  rejection + nothing deleted (SQLSTATE class 23 or P0001, the exact error recorded) for: own pipeline; cross-owner
  last root with a 1-step lane; cross-owner root with a 2-step lane. Cross-owner MULTI-root with a 1-step lane asserts
  the documented silent reach (that step/Output/panel gone, pipeline and other root survive). A user-with-connector
  delete whose actual outcome is asserted and written into the doc. Every scenario names its lane length.
- **FORCE restored on all five bracketed tables** (`relforcerowsecurity` for data_sources, image_uploads, pipeline_roots,
  pipeline_steps, panels) after V119; mutation: drop the closing FORCE for `panels` → red.
- **Inventory:** query every FK referencing `users` (table, column, `confdeltype`) and assert it equals the set parsed
  from the table in `docs/user-reference-inventory.md` (the doc is read, not a hard-coded copy), so doc drift goes red.
- **Mutation evidence required (red runs recorded in the executor's notes):** drop the `pipeline_roots` bracket → the
  two-root guard scenario goes red (migration succeeds and deletes the root); drop the `panels` bracket → the form-panel
  scenario goes red; drop the `data_sources` bracket → V119 fails; drop each non-FK guard clause → its scenario goes red.
  Restore after each. The inventory doc keeps FK columns in a dedicated table so the 3.7 parser reads only that table.
- **Existing real-dump specs (enumerated by the orchestrator, 2026-10-09).** `hel904-real-dump.sql` has 594 users and
  141 data sources; exactly 2 are V119 targets (NULL owner: `e8c55620…`, `18dc0d3b…`), no FK orphans, no references to
  them. Specs that reference the dump and then migrate UNPINNED to latest (design-gate r5: V96/V106 only mention it in
  comments and seed their own real users — leave them unpinned), so they now run V119 over it:
  `FlywayNonSuperuserMigrationSpec:286`, `pipelines/V94OutputsMigrationSpec:243`,
  `DatasetRowsReaderBehaviorPreservingSpec:160`, `V96CanonicalizeInferredSchemaTypeMigrationSpec:113`,
  `V106DatasetRowsMigrationSpec:95`, `V118LegacyMetricFormatMigrationSpec:178` (`flyway(None)`),
  `domain/engine/SchemaFieldRealDumpInvariantSpec:87`. Three read a target id after latest and WILL fail
  (`FlywayNonSuperuserMigrationSpec` :434/:443/:455, `V94OutputsMigrationSpec` :758-768, `DatasetRowsReaderBehavior
  PreservingSpec` :143/:160 onward). Remedy per spec: if it tests an older migration (V94, V96, V106, the V106 reader
  equivalence), pin its final migrate to `118` so V119 is out of its scope; `FlywayNonSuperuserMigrationSpec` (whose job
  is "the whole chain applies as `helio`") keeps migrating to latest but runs its V106 assertions at 118 first, then
  asserts V119 deleted exactly those two sources and nothing owned. The other four are checked for any count/id
  assertion on `data_sources`/`dataset_rows` after latest and pinned or left with a stated reason. Never edit the dump
  (C3). Any further spec failing on V119 in `sbt testFull` is a planning miss: stop and report it, don't improvise.
- Also assert FORCE is on for all five tables after a guard-abort scenario (rollback restores it), and record the
  expected 42704 when the `pipeline_steps` bracket is dropped as an explicit mutation result.
- No hard-coded dev row counts in the V119 header or the docs. The connector-delete outcome (RESTRICT, RI trigger
  order) is documented as observed on a fresh DB, not a guarantee; the unguarded image-upload delete is noted in the header.

**D8 — Documentation.** `docs/user-reference-inventory.md`: the full table above, the cascade-reach statement (D6), and
`audit_events` as permanent residue for deleted/test users (`actor_user_id`, and `resource_id` on `User`-resource
rows; HEL-471 trigger blocks DELETE; intended). Link it from
`docs/README.md`. A test (or the D7 spec) asserts the FK set referencing `users` equals the documented list.

## Risks / Trade-offs

- **Prod data deletion** — owner-approved; gated on the owner's pre-release count. Rows deleted are invisible to every
  user under RLS (owner matches nobody); data sources are not shareable (`resource_permissions` holds dashboards/pipelines).
- **Fixture fallout** — test fixtures that insert `data_sources`/`image_uploads` for a non-existent or NULL owner will
  now fail. Fix by seeding a real `users` row; never by weakening the constraint (MISTAKES/memory: a fixture edit is a
  symptom — here the symptom is of the bug this ticket fixes, so each such edit must be listed in the PR).
- **Shared dev DB** — applying V119 locally deletes the dev orphans by the migration's own predicate (the exact-id rule
  is satisfied: no name patterns). Other worktrees' Flyway history gains V119; HEL-1389/HEL-1381 have no migrations.
- **Storage blobs** of deleted image uploads/CSV sources remain (non-goal, follow-up).
- **Lock** — brief ACCESS EXCLUSIVE on the five bracketed tables during deploy (V117 did the same on `outputs`).

## Planner Notes

- **NOT NULL (D5), self-approved.** The owner asked to decide it and escalate only if not clear-cut. It is clear-cut:
  Q3 deletes every NULL row; prod's `data_sources_owner` WITH CHECK already makes a NULL-owner insert impossible on the
  RLS pool; every sibling owner column is NOT NULL; `DataSourceRepository` writes `None` only for an empty `UserId`,
  which no authenticated path produces. If the executor finds a live code path inserting a NULL owner, escalate.
- **Gate-Chain Implications:** no `.husky/**` or pre-commit script is touched.
