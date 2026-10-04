## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 260943222894a97e2d65447ff9b00a7e7f57df89 (planning artifacts only; no code diff yet).

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/guard-source-delete-config-refs/HEL-1252`.
- **Artifacts validate**: `npx openspec validate guard-source-delete-config-refs --strict` printed "Change ... is valid".
- **D1 inventory, re-derived independently:**
  - Every FK to `data_sources` in all migrations (`grep -i "references data_sources"`): `data_types.source_id` (V4, table later dropped), `pipelines.source_data_source_id` (V22, dropped in V98:320), `pipeline_roots.data_source_id` (V98:81, cascade, which is R1), `dataset_rows.data_source_id` (V106:32, the source's own content). Nothing else.
  - Domain codecs that carry a source id: `SecondaryInput.Source` (join/lookup/union; `SecondaryInput.scala`), `UpsertTarget.ExistingSource` (`UpsertSourceConfig.scala:84`), and `FormPanelConfig.dataSourceId` (`FormPanel.scala:201`). `grep dataSourceRepo|DataSourceId|loadSource` over `domain/steps/` hits only Join/Lookup/Union/UpsertSource/SecondaryInput. ConvertFormat, AnalyzeWithAi and GenerateText carry no source id.
  - `UpsertTarget.NewSource` is rewritten to `ExistingSource(newId)` after the first run (`PipelineStepRepository.scala:131-148`), so R3 already covers sources the engine creates. Leaving NewSource out of the inventory is correct.
  - V97 rewrote every legacy flat `rightDataSourceId`/`otherDataSourceId`/`referenceDataSourceId` row into `secondaryInput` (V97:45-75). Because of that, the rule "decode failure = no reference" will not silently drop a legacy-shaped live reference.
  - Other JSON/config columns I checked: `panels.output_controls` (V112) binds output controls, not sources. `alert_rules` was re-keyed to `target_output_id` (V94:391). `pipeline_auto_run_debounce` (V110) is keyed by pipeline. Connectors are referenced from sources (`config->>'connectorId'`), not the other way round. `pipelines.last_source_schema` (V85) is a schema snapshot. ImagePanel and FormUploadConfig carry no source id.
  - **Result: I found no live reference kind that D1 misses. The four kinds R1-R4 are complete.** The `panels.form_config` correction of the ticket's "`panels.config`" is accurate (V108:30).
- **Current code matches the design's description:** `DataSourceRepository.rootReferences` (L257) reads `pipeline_roots` on the system pool and names pipelines through `PipelineRootRepository.findReadEdgesVisibleTo` (owner, or a grant with `grantee_id = caller`, L107-123). `WorkspaceTeardownRepository.sourceDependentPipelineConflict` runs inside `ctx.withUserContext` against FORCE-RLS `pipelines` (V35:29) and checks roots only. That confirms the RLS-blind teardown gap D4 targets.
- **Visibility functions:** `helio_can_access_pipeline` (V39:28-63) is owner, or a `resource_permissions` row with `grantee_id = v_uid`, and has no anonymous path. `helio_can_access_dashboard` (V36:42-85) is the same for an authenticated user. The public-viewer grant (`grantee_id IS NULL`) applies only on the anonymous branch.
- **D5 caller list is complete.** `grep dataSourceService.delete` finds exactly the route plus PipelineProposalService:72, PatchSetUndoService:117, PatchSetApplyForward:69, PatchSetApplyRollback:119 and FirstRunDashboardService:46. The rollback walks are reverse-ordered (`PatchSetApplyRollback.rollback` uses `appliedInOrder.reverse`; `PatchSetUndoService:100` uses `edits.reverse`), so a created step or form panel referencing a created source is undone before the source. `PipelineProposalService.rollback` deletes the pipeline first, which cascades its steps. `CombinedProposalService` reaches source deletion only through `PipelineProposalService.rollback`, after `DashboardProposalService` has already `deleteInternal`-ed its own dashboard (which cascades panels). I found no ordering hazard beyond what D5 already commits to auditing.
- **D7 harness is real.** `V100ZeroRootGuardNonSuperuserSpec` creates `helio_migration_test LOGIN NOSUPERUSER ... NOBYPASSRLS` and runs two genuinely distinct pools (its scaladoc L39-49). `pipelines`, `pipeline_steps`, `dashboards` and `panels` are all FORCE RLS (V35:29/61, V36:98/144), so ownership of `public` does not bypass the policies. Task 6.3 requires a recorded red against pre-fix teardown, and 6.6 requires mutations. Both proof obligations can genuinely fail.
- **D4 avoiding a migration is sound.** The pre-check runs on the privileged pool with explicit predicates (the same pattern HEL-989 shipped). The exemption "owned by caller AND tagged T" matches what the transaction actually deletes (`pipelinesTable.filter(r => r.ownerId === ownerUuid && r.tag === tag)`). The residual TOCTOU is disclosed and follows the HEL-989 precedent.

### Verdict: REFUTE

The plan is close. The inventory is complete and the architecture is sound. Two specific gaps would let a cross-tenant identity leak, or a spec violation, ship past every proof obligation as written.

### Change Requests

1. **Pin the visibility predicate to the caller as grantee, and add a proof that fails if that filter is dropped.**
   - The spec delta says "owner or any grant on the pipeline / on its dashboard" (specs/datasource-edit-delete/spec.md, requirement paragraph 2). D2 defers "how public-viewer rows are treated" to the executor.
   - "Any grant" read literally (`EXISTS resource_permissions WHERE resource_id = X`, with no `grantee_id = caller`) would name another tenant's pipeline or panel whenever it carries a grant to *anyone*. That is exactly the leak the owner ruling forbids.
   - None of the planned proofs would catch it. Task 6.2's hidden fixtures (as described) carry no grants, and 6.6's mutation widens the predicate to `true` only. A grantee-less predicate passes both.
   - Required:
     - (a) Reword the spec delta and D2 to "owner, or a `resource_permissions` grant whose grantee is the caller". For dashboards, state the decision explicitly: an authenticated caller does **not** get visibility from a public-viewer (`grantee_id IS NULL`) grant, matching `helio_can_access_dashboard`'s authenticated branch (V36:67-84). Or rule the other way, but record the decision rather than deferring it.
     - (b) Add to 6.2 and 6.6 a hidden pipeline carrying a grant to a *third* user, and a hidden form panel whose dashboard carries a grant to a third user plus a public-viewer grant. Assert neither is named. Add a mutation that drops `grantee_id = caller` and turns that test red.

2. **Resolve the log-identification clause against the race path and the new decode-failure log.**
   - The MODIFIED requirement re-ratifies "a referencing resource the caller cannot see SHALL NOT be named or identified anywhere (body, message, logs at info level and above)".
   - Today `DataSourceService.deleteAfterPrecheck` does `log.warn(..., ex)` on the P0001 race path (DataSourceService.scala:668). The V100 trigger's message embeds the orphaned pipeline ids (V100:80-82: `'... pipeline(s) [%] ...', orphaned_pipeline_ids`), so a hidden pipeline id reaches a warn log.
   - D3 declares this path "unchanged", and D4 adds the same P0001 exposure to teardown.
   - D2 also plans a warn-log "with step id only" on decode failure, and that step can belong to a hidden pipeline.
   - Required: D3/D4/tasks must either scrub hidden identities from these warn logs (log the source id and SQLSTATE, not `ex`/trigger text or the step id), or explicitly narrow the spec clause, with the reason recorded. Shipping a spec the code visibly violates is not acceptable at final gate.

### Non-blocking notes

- D2 says decode "via each op's config decoder". Prefer decoding only the reference sub-object (`SecondaryInput.decodeStrict` on `secondaryInput`, `UpsertTarget.format` on `target`). That way a malformed *unrelated* key (e.g. a wrong-typed `joinKey` that `StepCodecUtil.str` rejects) cannot make a real reference disappear. `PipelineStepRepository.scala:166-195` already has a write-edge scan worth reusing for R3.
- D4 should state that the privileged pre-check also runs on `dryRun` (spec: "Dry run surfaces the same conflicts a real call would hit").
- The kept in-transaction RLS root check still exempts on `tag IS DISTINCT FROM T` (tag only, not owner+tag). That is harmless after the pre-check, but say so in a comment, or align it, so a later reader doesn't treat it as the authoritative exemption.
- Task 1.2 / 6.3 red: when the hidden pipeline has a **sole** root, pre-fix teardown fails with the V99/V100 P0001 (likely a 500), not a silent commit. Record the red per scenario (sole-root means exception, multi-root or join means committed=true) so the red is not misread.
- Planner Notes claim "openspec refuses to drop scenarios from a MODIFIED block". That is unverified here. If it's false, dropping the two stale DataType scenarios would be cleaner than ratifying known-dead behaviour. Not required in this change.
