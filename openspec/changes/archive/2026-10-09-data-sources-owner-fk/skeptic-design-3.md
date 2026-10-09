## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed worktree HEAD `99d6fedd71dacd14d308a3c9f52053efaf72210d`. The planning artifacts are untracked in the change dir. Owner rulings Q1–Q4 were taken as fixed. The dev DB was read only. The cascade probe used session-local `TEMP` tables inside a rolled-back transaction.

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/data-sources-owner-fk/HEL-1347`.
- **`openspec validate --strict`:** "Change 'data-sources-owner-fk' is valid".
- **V119 is free:** after `git fetch`, no `V119`–`V129` file exists on any local or `origin/*` ref, or in any worktree. The latest applied Flyway version on dev is 118.
- **FKs to `users` (`pg_constraint`):**
  - 12 `a` (NO ACTION): alert_events, alert_rules, assistant_conversations, assistant_daily_usage, authoring_conversations, dashboards, invite_codes, outputs, panels, patch_set_applications, pipeline_run_rate_window, pipelines.
  - 14 `c` (CASCADE): agent_memory, agent_preferences, api_tokens, connector_completion_tokens, connector_credentials, connectors, mfa_backup_codes, mfa_login_challenges, product_events, resource_permissions.grantee_id, share_tokens, user_dashboard_zoom, user_mfa, user_sessions.
  - This matches D-Context exactly.
- **`pipeline_runs.triggered_by_token_id`:** `confdeltype = n` (SET NULL). The orchestrator's correction is right and D-Context now says so. The column is nullable and `pipeline_runs` has no CHECK involving it, so a token cascade never blocks a user delete.
- **`connectors.credential_id → connector_credentials`:** `r` (RESTRICT). The design states it as "measured by test", which is an honest hedge.
- **Non-FK user-reference columns:** I searched every uuid/text `*_id`/`*_by`/owner/actor/user column for one without an FK. Besides internal text ids, the only user references are:
  - `audit_events.actor_user_id` and `actor_token_id`
  - `connectors.completed_by`
  - `dashboards.created_by` and `panels.created_by`
  - `data_sources.owner_id` and `image_uploads.owner_id`

  All are in D-Context. AC1 is complete for columns. One nit: `audit_events.resource_id` holds user ids when `resource_type = 'User'` (25320 rows). It is part of the same audit residue and is worth naming in the doc.
- **Dev counts:**
  - 57 orphaned sources with 50 distinct deleted owners, and 2 NULL-owner sources, as claimed.
  - `dataset_rows` under targets: **306** (D-Context says 303). This is shared-DB drift; task 3.11 already measures at apply time.
  - 0 targets are roots, step-referenced (strpos prefilter) or form-panel-referenced. 0 orphan `image_uploads`. 7555 audit rows for deleted actors.
- **D3 guard vs `DataSourceReferenceRepository.scala`:**
  - Same four ops (`:80`) and the same `strpos` prefilter (`:74`). The design keeps only the prefilter, which is conservative: it can only abort, never under-match.
  - Same form-panel predicate (`:96`). The design reads `panels` without joining `dashboards`, so no `dashboards` bracket is needed.
- **RLS (`pg_policies`, `pg_proc`):**
  - Fail loud with the GUC unset: `data_sources_owner` and `image_uploads_owner` use a bare `current_setting`, as does `pipeline_steps_owner` (via `EXISTS pipelines`).
  - Fail silent: `pipeline_roots_select` → `helio_can_access_pipeline` returns FALSE with the GUC unset. `panels_select` → `helio_can_access_dashboard` takes the anonymous branch, which shows a panel only if its dashboard has a grantee-less `viewer` grant.
  - `hel913_prevent_zero_root_pipelines` is owned by `helio_privileged`, SECURITY DEFINER, with `row_security=off`. It fires as an AFTER DELETE statement trigger on `pipeline_roots` and raises only while the pipeline row still exists with zero roots.
  - So D2's bracket rationale is right, and both bracket mutations in D7 would genuinely go red. For the root mutation, the migration succeeds because the two-root fixture never triggers V99. For the panel mutation, the panel is invisible because its dashboard is private, so the source gets deleted.
- **D2's claim that FK validation and RI cascades need no bracket:** consistent with Postgres. RI queries run as the table owner under `SECURITY_NOFORCE_RLS`, and every touched table is ENABLE + FORCE.
- **NOT NULL (D5):** `DataSourceRepository.scala:113` writes `None` only for an empty `UserId`. The planner note covers this. Task 1.8 re-greps for such paths.
- **Real dump (`hel904-real-dump.sql`, parsed):** 141 sources and 594 users. 0 orphans, and exactly 2 NULL-owner sources: `e8c55620…` (TestDataNetflix) and `18dc0d3b…` (MyManualSource).
  - Neither is a pipeline source, step reference or panel reference; only `data_types` rows (8551/8552) point at them. The D3 guard will therefore not trip.
  - No migration between V93 and V118 assigns them an owner (grep of `UPDATE data_sources` in V94 and V106). See CR1.
- **Cascade semantics probe (CR2):** I used temp tables mirroring `pipeline_steps`: `root_id … ON DELETE CASCADE`, `parent_step_id` NO ACTION, and the `CHECK ((parent IS NULL) = (root_id IS NOT NULL))` constraint, which exists on dev as `pipeline_steps_root_id_matches_parentless`.
  - Deleting the user whose root lane has **one** step succeeds. The lane is removed silently and the other lane survives (`DELETE 1`; 2 steps remain).
  - With a **second** step in that lane, the same delete fails: `ERROR: update or delete on table "t_steps" violates foreign key constraint "t_steps_parent_fkey" … Key (id)=(1000) is still referenced`.
  - Dev confirms the shape: 947 steps carry `root_id`, 1118 do not, and 0 have both a parent and a `root_id`.

### Verdict: REFUTE

The V119 core is sound: the guard runs before the delete over every reference kind, the brackets are on exactly the right five tables, the abort is transactional, it is proven under the NOBYPASSRLS owner role, and NOT NULL and the FK naming are right. Two defects would ship as wrong text and a guaranteed-red gate:

1. The plan says an existing load-bearing spec "must still pass" when V119 necessarily breaks it.
2. The cascade-reach statement the owner explicitly asked for is materially wrong about what a user delete silently reaches.

### Change Requests

1. **D7 / task 3.10: `FlywayNonSuperuserMigrationSpec` will go red, and the plan gives no sanctioned remedy.**
   - **Why it breaks:** the spec migrates to latest (`FlywayNonSuperuserMigrationSpec.scala:279-286`). Its HEL-1074 V106 assertions then read the NULL-owner source `18dc0d3b-ad44-48cd-bc1d-f066726fc0f1`:
     - `:434` and `:455` call `.head` on `data_sources WHERE id = '18dc0d3b…'`;
     - `:443` expects its 3 `dataset_rows`.
   - V119 deletes that source and its rows by design (Q3), so this spec fails for a reason task 3.10 does not anticipate. Task 3.10 only says "if the dump trips the D3 guard, stop and escalate", and the guard will not trip.
   - **Required:** amend D7 and task 3.10 to name this breakage and prescribe the fix. Do not leave the executor to improvise an edit to a real-dump spec, which C3 and "fixture change is a symptom" treat as suspect.
   - **Recommended shape:** split the final migrate into `target 118`, then the existing V106 assertions, then `migrate()` to latest. After that, assert that V119 deleted exactly the two NULL-owner dump sources and their `dataset_rows`, and that both constraints exist. This preserves the V106 evidence and makes the real dump a second prod-role-shape V119 proof. Do not change the dump's owner values.
   - Correct D7's parenthetical "2 NULL-owner sources, neither referenced": they are referenced by the spec itself.

2. **D6 / D-Context / task 3.6: the cascade-reach statement is wrong about steps, and the tests as planned could pin the wrong fact.**
   - `pipeline_steps.root_id` is set **only on parentless steps** (CHECK `pipeline_steps_root_id_matches_parentless`), and descendants link through `pipeline_steps_parent_step_id_fkey`, which is **NO ACTION**.
   - A `pipeline_roots` cascade therefore deletes only the lane's first step. Any descendant blocks the whole user delete with 23503 (probe above).
   - **Consequences D6 must state:**
     - (a) "Silently reached: that root's steps, Outputs, alerts, history and panels" is true only when the reached lane has **at most one step**, plus anything hanging off the root or that one step.
     - (b) A lane with two or more steps **blocks** the user delete on `pipeline_steps_parent_step_id_fkey`. Add this to the "Blocked" list. It applies to other users' pipelines (multi-root) and also determines which error the last-root case raises.
     - (c) For the cross-owner last-root case, D7 asserts the V99 `HEL-913` message. That holds only if the lane has at most one step. With more, the step cascade's NO ACTION check runs inside the root cascade before V99's statement trigger and raises 23503 instead.
     - (d) The own-pipeline case's 23503 comes from `pipelines_owner_id_fkey` only if that RI trigger fires before the new `data_sources` cascade. RI triggers on `users` fire in trigger-name (constraint-OID) order. The doc should say "rejected" without promising the mechanism, or the test should assert the constraint name it actually observes.
   - **Required in task 3.6:** pin lane shapes explicitly.
     - Cross-owner multi-root with a **one-step** lane: silently reached. Assert that the other user's step, Output, bound panel, alert and history rows are gone and that the pipeline survives.
     - Cross-owner multi-root with a **two-step** lane: blocked. Assert 23503 naming `pipeline_steps_parent_step_id_fkey`, with nothing deleted.
     - Last-root case: either a one-step lane asserting `HEL-913`, or both shapes with their actual errors.
   - The inventory doc's reach section must match these measured outcomes.

3. **Spec scenario / task 3.2: FORCE re-enable is asserted for two tables, but five are bracketed.**
   - The requirement says "every touched table's FORCE ROW LEVEL SECURITY re-enabled", but the scenario checks "FORCE … still on for both tables", and task 3.2 says only "FORCE still on".
   - FORCE exists because the app pool runs as the table owner. A V119 that forgot `FORCE` on `panels`, `pipeline_roots` or `pipeline_steps` would silently disable tenant isolation on that table in prod, and the planned test would stay green.
   - **Required:** the scenario and task 3.2 assert `relforcerowsecurity = true` for all five tables (`data_sources`, `image_uploads`, `pipeline_roots`, `pipeline_steps`, `panels`) after a successful V119. Run this in the guard-abort scenario too, where the rollback should have restored it. Add a mutation to 3.8: drop one closing `FORCE` and the assertion goes red.

### Non-blocking notes

- D-Context's "303 `dataset_rows`" is now 306 on the shared dev DB. Do not carry hard-coded dev numbers into the doc or V119's header; task 3.11 measures them.
- Name `audit_events.resource_id` (with `resource_type = 'User'`) in the audit-residue section alongside the actor columns.
- D6's "Dangling (non-FK)" list could also mention `node_snapshots`, `node_payload_history` and `output_snapshot_history`. Their `root_id`/`node_step_id` text columns are left pointing at a cascaded-away root or step. They are not user references and not blocking.
- The `pipeline_steps` bracket has no mutation in 3.8. It is fail-loud (42704), so a drop surfaces as a wrong error message in the step-guard scenarios, which assert the `HEL-1347:` text. That is acceptable, but list it so the evidence is explicit.
- Strictly speaking, `array_agg` over zero rows yields NULL, not an empty array. `= ANY(NULL)` and `unnest(NULL)` both behave as empty, so the clean no-op path is safe. The executor should keep the guard total `COALESCE`d so `IF total <> 0` never sees NULL.
