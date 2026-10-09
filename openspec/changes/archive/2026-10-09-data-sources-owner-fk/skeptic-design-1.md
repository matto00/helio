## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `99d6fedd71dacd14d308a3c9f52053efaf72210d` (planning artifacts untracked in the change dir).
Owner rulings Q1–Q4 were taken as fixed. This review covers only whether the plan implements them soundly.

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/data-sources-owner-fk/HEL-1347`.
- **V119 is free:** `git ls-tree` over every local and `origin/*` branch found no `V119`–`V129` migration. Main's latest is V118, and the dev DB's Flyway max is 118.
- **Inventory (design Context) is correct.** I queried `pg_constraint` on the dev DB, read-only. There are 26 FKs to `users`: 12 `NO ACTION` (dashboards, panels, pipelines, outputs, alert_rules, alert_events, authoring_conversations, patch_set_applications, assistant_conversations, assistant_daily_usage, invite_codes, pipeline_run_rate_window) and 14 `CASCADE`. This matches the design exactly. `data_sources.owner_id` is nullable with no FK. `image_uploads.owner_id` is NOT NULL with no FK. `audit_events.actor_*` has no FK. `dashboards/panels.created_by` are TEXT.
- **Dev counts:** 57 orphaned sources across 50 owners and 2 NULL-owner sources, as claimed. 0 orphan sources are pipeline roots and 0 image uploads are orphans, as claimed. Orphan `dataset_rows` is now **306**, not the claimed 303: the shared DB drifts.
- **Only two FKs point into `data_sources`:** `pipeline_roots` and `dataset_rows`, both CASCADE. The only non-internal trigger on the touched tables is `hel913_prevent_zero_root_pipelines_trigger`, `ENABLE ALWAYS`. `users` has RLS off, so a `DELETE FROM users` by `helio` cannot silently match zero rows.
- **RLS:** `data_sources_owner` (V35) and `image_uploads_owner` (V54) use a bare `current_setting('app.current_user_id')`, so they raise when the setting is unset. `pipeline_roots_select` (V98) goes through `helio_can_access_pipeline` (missing_ok), which is fail-*silent*. D2's need for the bracket on all three tables is therefore correct. `pg_db_role_setting` is empty, so no database- or role-level default for the GUC masks this.
- **"RI cascade bypasses RLS" claim:** the RI triggers (`ri_PerformCheck`) run as the referencing table's owner with `SECURITY_NOFORCE_RLS`, so the owner is exempt even when FORCE is on. The claim holds for the `dataset_rows` cascade because `helio` owns both tables. Spec 3.2 seeds `dataset_rows` and runs as the NOBYPASSRLS role, so it measures this directly. Good.
- **NOT NULL self-approval (D5):** grounded. `DataSource.ownerId` is a non-optional `UserId` across the domain model. `DataSourceRepository.scala:113` writes `None` only for an empty `UserId`, and I found no producer of `UserId("")` on a write path. Task 1.8 re-checks this. Clear-cut, as claimed.
- **Real dump (task 3.10):** `hel904-real-dump.sql` holds 2 NULL-owner sources: `e8c55620…` TestDataNetflix (l.1186) and `18dc0d3b…` MyManualSource (l.1187). Each is referenced only by a companion `data_types` row (l.8551–8552). V94 deletes those rows (`DELETE FROM data_types dt WHERE dt.source_id IS NOT NULL AND NOT EXISTS (… pipelines …)`), and no pipeline references either id. So the D3 guard will **not** fire on the dump. V119 will delete these 2 sources there, so expect any data_sources count assertion in that spec to shift.
- **Test infra:** 220 test files use EmbeddedPostgres and none target the shared dev DB. 76 test files insert `data_sources`/`image_uploads`, which is a large fixture surface, but C3 and task 3.9 cover it.

### Verdict: REFUTE

The plan is close. Three defects would end up in the migration or its evidence, and V119 cannot be edited after it is applied.

### Change Requests

1. **D2 makes a false claim about the V99 trigger. Correct it before it reaches V119's header.**
   D2 says the V99 trigger "is SECURITY DEFINER as the table owner, so it is equally RLS-blind as `helio` with FORCE on; the bracket also makes it see real rows." That has been false since **V100** (HEL-974). V100 re-owned `hel913_prevent_zero_root_pipelines` to `helio_privileged` (BYPASSRLS) and added `SET row_security = off`. Dev confirms this: `pg_proc` shows owner `helio_privileged` and proconfig `{search_path=pg_catalog, public, row_security=off}`. The trigger is RLS-independent whether or not the bracket is present.
   - The `pipeline_roots` bracket is still required, but **only** because the D3 guard's own read runs as `helio` through the fail-silent `pipeline_roots_select`.
   - Rewrite D2 to say this, and tell the executor not to carry the false claim into the migration's comment. V99's own stale "HONEST LIMIT" comment is the precedent: a wrong claim in an applied migration is permanent because Flyway checksums comments.

2. **Tasks 3.3/3.8: the abort scenario and its mutation must exercise a case only the D3 guard catches.**
   Because V99 is RLS-independent (CR1), removing the `pipeline_roots` bracket leaves this path: the guard counts zero roots, the DELETE cascades to `pipeline_roots`, and if the orphan was the pipeline's **last** root, V99 raises `HEL-913: …` and Flyway rolls back.
   - With a last-root fixture, a 3.3 that asserts only "migration failed + zero rows deleted" stays **green** under the mutation. That is evidence-shaped non-evidence.
   - Required: the 3.3 fixture must include a pipeline with **two roots**, the orphaned source plus a source owned by a live user. In that shape, without the guard, V119 would silently delete a root and succeed. Only the guard stops it.
   - The scenario must assert the **`HEL-1347`** error text, not just that the migration failed.
   - The 3.8 mutation must be shown red on that multi-root case. Keeping a separate last-root case is fine, but it is not the mutation's proof.

3. **D3's guard and the owner's pre-release count only cover `pipeline_roots`. Non-FK references to a source are ignored.**
   The repo already lists every way a pipeline or panel can reference a data source, in `DataSourceReferenceRepository.scala:16-20`:
   - `root` (pipeline_roots)
   - `join`/`lookup`/`union` → `pipeline_steps.config` `secondaryInput` of kind `source`
   - `upsertTarget` → `pipeline_steps.config` (op `upsertsource`) `target`
   - form panels → `panels.form_config->>'dataSourceId'`

   None of the non-root kinds are FKs. V119 would delete an orphan or NULL-owner source that a live pipeline step or form panel still references, silently, leaving a dangling id. The app's own source-delete path never allows that. Dev has 0 such references (I probed `strpos(pipeline_steps.config, id)` and `form_config->>'dataSourceId'`), but prod is unmeasured, and legacy NULL-owner sources used by real users are exactly the shape the real dump shows.
   - Required: either (a) extend the D3 guard to fail loudly on **every** reference kind in that list, using the same matching that `DataSourceReferenceRepository` uses; or (b) give evidence-backed reasoning why non-root references cannot exist for these rows or do no harm.
   - In either case, add the non-root kinds to the owner's pre-release prod count query. Otherwise the owner approves a prod deletion with one input missing.
   - Add a 3.3-style scenario for whichever you choose.
   - D6 (cascade reach) should also say that a future `DELETE FROM users` CASCADE likewise skips the app's reference check for these non-FK kinds.

### Non-blocking notes

- **Task 3.11:** do not hard-code "303 dataset_rows expected". Dev measured 306 today and drifts. Record measured pre and post counts and check that post equals 0 for the predicate.
- **Task 3.11 / D1:** apply V119 to the shared dev DB only once the file is final. A fix cycle that edits V119 after it is applied there fails this worktree's own boot on a checksum mismatch.
- **Task 3.6:** assert the specific failure for each rejection: SQLSTATE `23503` for the own-pipeline case (`pipelines_owner_id_fkey`), and the `HEL-913` message for the cross-owner last-root case. "Delete failed and rows intact" alone is satisfied by any error.
- **Task 3.7 / D8:** state whether the test parses `docs/user-reference-inventory.md` or compares against a list hard-coded in the spec. If hard-coded, the doc can drift with the test still green. Parsing the doc's table, or at least asserting every FK constraint name appears in the doc text, closes that gap.
- **D3:** say how the target set is "materialised once": a temp table (needs TEMP on the database; `helio` has it via PUBLIC by default) or a DO-block array. Also say that the DELETE targets exactly that set and does not re-evaluate the predicate.
- **Spec delta:** a `## Purpose` heading in a change delta is unusual for OpenSpec. Check that `openspec validate` accepts it.
