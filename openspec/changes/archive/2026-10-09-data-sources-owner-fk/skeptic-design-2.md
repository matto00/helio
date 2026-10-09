## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed worktree HEAD `99d6fedd71dacd14d308a3c9f52053efaf72210d`. The planning artifacts are untracked in the change dir.
Owner rulings Q1–Q4 and the relayed prod measurement were taken as fixed. This review covers only whether the plan implements them soundly.

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/data-sources-owner-fk/HEL-1347`.
- **Round-1 change requests (CR1–CR3):** all three are addressed in the text.
  - D2 now gets V100 right. `pg_proc` shows `hel913_prevent_zero_root_pipelines` owned by `helio_privileged` with `row_security=off`.
  - D7 has a two-root fixture and asserts the `HEL-1347:` message.
  - D3 now guards every reference kind.
- **D3 matching mirrors `DataSourceReferenceRepository`:**
  - The ops are `join`, `lookup`, `union` and `upsertsource`, as in `DataSourceReferenceRepository.scala:93-95`.
  - The step prefilter is `strpos(s.config, id)`; the panel check is `pn.kind = 'form' AND form_config->>'dataSourceId'`.
  - Column types on dev: `pipeline_steps.config`/`op` are text NOT NULL; `panels.form_config` is jsonb; `data_sources.id` is text; `owner_id` is uuid. A `text[]` target set and `strpos` are type-correct.
- **No other data-source id carrier:** I searched every `%source%` column. The only id carriers are `dataset_rows`, `pipeline_roots` and `resource_permissions`, and the last holds `dashboard` rows only. There are no connector, debounce or alert references. The reference-kind list is complete.
- **Inventory of FKs to users:** re-queried `pg_constraint`. There are 12 `NO ACTION` and 14 `CASCADE`, exactly as D-Context claims.
- **Dev guard counts:** 59 targets (orphan + NULL). Of those, 0 are pipeline roots, 0 are form-panel references, 0 are step references, and there are 0 orphan `image_uploads`.
- **V119 is free:** no `V119`–`V129` on any local or `origin/*` branch after `git fetch`.
- **`openspec validate --strict`:** "Change 'data-sources-owner-fk' is valid".
- **RLS policies (dev `pg_policies`):**

  | Table | Policy | Behaviour when the GUC is unset |
  |---|---|---|
  | `data_sources`, `image_uploads` | bare `current_setting` | fails loud (raises) |
  | `pipeline_steps` | `EXISTS(pipelines … bare current_setting)` | fails loud |
  | `pipeline_roots` | `helio_can_access_pipeline`, which returns FALSE | fails silent |
  | `panels` | `panels_select` → `helio_can_access_dashboard` | **fails silent** (see CR1) |

  `users` has RLS off. All five touched tables have RLS ENABLE + FORCE.
- **FK tree under the new cascades:** walked recursively from `pg_constraint`.
  - `pipeline_roots` cascades to `pipeline_steps`, `outputs` and `binary_refs`. `outputs` cascades to `panels`, `alert_rules`, `alert_events` and `output_snapshot_history` (see CR2).
  - `api_tokens` ← `pipeline_runs.triggered_by_token_id` is `NO ACTION`.
  - `connector_credentials` ← `connectors.credential_id` is `RESTRICT`.
- **User-reference columns with no FK:** `audit_events.actor_*`, `dashboards/panels.created_by`, `data_sources/image_uploads.owner_id`, and **`connectors.completed_by` (TEXT)**. V103:14 documents `connectors.completed_by` as "records the authenticated principal" (see CR3).
- **Root ownership is app-checked:** `PipelineProposalService.validateSourceReference` uses `findByIdOwned`. Dev has 0 cross-owner roots. Cross-owner roots are therefore a legacy or edge shape, but D6 and the spec treat them as possible.

### Verdict: REFUTE

The V119 core is sound: guard-before-delete, transactional abort, NOT NULL, FK naming, indexed cascade, and proof under the prod role shape. Three defects remain, and two of them would ship as permanent text: the V119 header comment and the inventory doc that satisfies AC1.

### Change Requests

1. **D2/D7: the `panels` bracket is a fail-silent guard dependency, just like `pipeline_roots`, and nothing in the plan proves it.**
   - **Why it fails silently:** with `app.current_user_id` unset, `helio_can_access_dashboard` takes its anonymous branch. A form panel is then visible only if its dashboard has a grantee-less public `viewer` grant. Without the `panels` NO FORCE bracket, the D3 panel count reads 0 for every private dashboard, and V119 silently deletes a source that a live form panel references.
   - **D2 needs correcting.** It says "`pipeline_roots` is the dangerous one" and lists `panels` as merely "read only by the D3 guard". Do not carry that claim into V119's header.
   - **D7/task 3.8 needs one more required mutation:** drop the `panels` bracket, and the form-panel guard scenario goes red.
   - **D7/task 3.3 needs an explicit fixture rule:** the form panel's dashboard must have **no** public grant in `resource_permissions`. Otherwise the anonymous branch sees the panel and the mutation stays green.

2. **D6 understates the cascade reach. This text becomes `docs/user-reference-inventory.md`.**
   - **The reach is deeper than stated.** D6 and D-Context say a user delete reaches "data_sources → dataset_rows/pipeline_roots". But `pipeline_roots` CASCADE continues to `pipeline_steps`, `outputs` and `binary_refs`, and `outputs` CASCADE continues to `panels`, `alert_rules`, `alert_events` and `output_snapshot_history`.
   - **The consequence for other users:** in the multi-root cross-owner shape that D6 and the spec already treat as possible, deleting user A silently removes, in user B's workspace:
     - a root;
     - that root's lane steps and Outputs;
     - their alert rules and events, and snapshot history;
     - the **panels on B's dashboards** bound to those Outputs.

     V99 does not stop this, because the pipeline keeps at least one root.
   - **The D6 "known gap" mentions only non-FK dangling ids.** It must state this FK-cascade reach as well, and say whether cross-owner roots are producible today. Today root creation is checked by `findByIdOwned`, so they would be legacy or edge only.
   - **The list of what blocks a user delete is incomplete.** It omits `pipeline_runs.triggered_by_token_id` (`NO ACTION`, reached via the `api_tokens` cascade). That FK blocks deleting any user whose API token triggered a run, including a run on another user's pipeline.
   - **`connectors.credential_id` is `RESTRICT`.** Within a user-delete cascade it may reject depending on cascade order. Either measure that or state it as unverified. Do not imply that CASCADE "fires for throwaway users" without that caveat.
   - **Task 3.6** should add a scenario for the multi-root cross-owner case. It should assert what actually happens (the other user's lane, Output and panel are deleted) so the documentation is pinned by a test.

3. **The AC1 inventory omits a user-reference column.** `connectors.completed_by` (TEXT, V103: "records the authenticated principal" or `anonymous`) is a user reference with no FK. It belongs in the D-Context inventory and the doc, alongside `dashboards/panels.created_by`. `pipeline_runs.triggered_by_token_id` should also appear as an indirect user reference via `api_tokens`.

### Non-blocking notes

- **D4:** say that the DELETE targets the guarded `text[]` (`id = ANY(targets)`) rather than re-evaluating the predicate. The two are equivalent in one transaction absent concurrent user deletes, but the array removes any doubt that the deleted set is exactly the guarded set.
- **Image uploads have no reference guard.** An image panel's `image_url` pointing at an orphan upload is deleted unguarded. Dev and prod have 0 orphan uploads, so this is moot today. Stating it in D3 would make the asymmetry deliberate rather than accidental.
- **Task 3.7:** the doc will list FK and non-FK columns. Make the parser's distinction explicit, for example a column marking `FK: none`, so that the FK-set equality assertion is well defined.
- **Worktree HEAD lags `origin/main` by one commit** (HEL-1389, no migrations). This is harmless for V119.
