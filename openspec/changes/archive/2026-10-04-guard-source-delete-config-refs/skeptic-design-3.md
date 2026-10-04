## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 260943222894a97e2d65447ff9b00a7e7f57df89. The planning artifacts are untracked in the change dir. I checked them cold against the code.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/guard-source-delete-config-refs/HEL-1252`.
- **Spec deltas are structurally valid:** `openspec validate guard-source-delete-config-refs --strict` printed "Change ... is valid".
  - Each MODIFIED header matches a baseline header exactly: `datasource-edit-delete/spec.md:109`, `:141`; `workspace-tag-teardown/spec.md:37`, `:112`.
- **D1 inventory, checked against the code:**
  - The only FKs to `data_sources` are `pipeline_roots` (V98:81, cascade), `dataset_rows` (V106:32, cascade), `data_types.source_id` (V4, table dropped) and the dropped V22 column.
  - The step configs that carry a source id are `JoinStep`, `LookupStep` and `UnionStep`, all through `SecondaryInput.decodeStrict` (`Join:25`, `Lookup:32`, `Union:26`), plus `UpsertSourceConfig` (`ExistingSource`, `UpsertSourceConfig.scala:84`). Op names match the V107 CHECK (`join`, `lookup`, `union`, `upsertsource`).
  - V97 migrated the legacy flat fields into `secondaryInput`, so the strict decoder will not hit a legacy row that hides a reference.
  - Form binding lives in `FormPanelConfig.dataSourceId` (`FormPanel.scala:201`), stored in `panels.form_config JSONB` (V108:30), with `kind='form'` (V108:24). The design is right that the ticket's "panels.config" is a mis-citation.
  - Nothing else references a source:
    - Tables and columns added V100–V114: `share_tokens`, connector tokens, `truncated_reads`, the `pipeline_auto_run_debounce` FK to pipelines, `output_controls` (no source id in `OutputPanel.scala`), product_events. None reference a source.
    - Row ops are on the source itself.
- **Baseline code matches D2/D3:**
  - `DataSourceRepository.rootReferences` (L257-275): privileged total, plus visible names from `PipelineRootRepository.findReadEdgesVisibleTo` (L107-123), which uses owner OR `grantee_id = caller`.
  - The authenticated branch of `helio_can_access_dashboard` (V36:66-83) is owner OR named grantee. Public grants are anonymous-branch only (V36:55-64). So the C1 predicate mirrors the DB functions accurately.
  - The race-path warn at `DataSourceService.scala:668` logs `ex`, which matches D3's scrub target.
- **Teardown baseline matches D4:**
  - `WorkspaceTeardownRepository.scala:56-108` runs entirely under `withUserContext`.
  - The dependent check (L117-134) is roots-only, tag-only, `LIMIT 1`, and names `'$pipelineName' ($pipelineId)`.
  - Deletes run pipelines → sources → dashboards, and panels cascade.
  - D4's exemption (caller-owned AND tagged T, pipelines and dashboards) matches exactly what that transaction deletes.
  - The identity-free in-transaction re-check and the P0001 scrub close round-2 CR2.
- **D5 caller list is complete:** grep of `dataSourceService.delete` call sites finds the route, `PatchSetApplyForward:69`, `PatchSetApplyRollback:119`, `PatchSetUndoService:117`, `PipelineProposalService:72` and `FirstRunDashboardService:46`. That is the route plus the five named.
- **Round-2 change requests are addressed in the artifacts:**
  - CR1: "Teardown is owner-scoped" is now MODIFIED, with the carve-out and the foreign-dependent scenario.
  - CR2: D4 and task 4.2 make the in-transaction re-check identity-free, and 6.4 adds a superuser-pool non-leak spec.
  - CR3: task 1.2 now records the superuser block-and-leak against the non-superuser miss.
  - The round-2 notes are also covered: the notice always shows the reason and handles the panel-only case (D6, 5.2); D4 reads the tagged sets itself; hidden counts are counted in resources.
- **AC coverage:**
  - AC1 → D1, 1.1, 2.x, 3.1, 6.1
  - AC2 → D3, 3.1-3.2, 6.2
  - AC3 → D4, 4.x, 6.3-6.4
  - AC4 → D7, 1.2, 6.2-6.3, 6.6 (red recorded per scenario, plus mutations)
  - AC5 → D6, 5.1-5.3
- **No missing contract delta:**
  - No JSON schema exists for the data-source delete 409; grep found no `resourceKind` under `schemas/sources`.
  - The teardown response schema (`schemas/workspace/workspace-teardown-response.schema.json`) is unchanged on the wire, because the reason is a string.

### Verdict: CONFIRM

### Non-blocking notes

- Task 1.2: on the superuser pool, the pre-fix teardown blocks and names a hidden pipeline only for a **root** reference. A hidden **join** reference commits there too, because the check is roots-only. The executor should record the superuser contrast with a root fixture so the probe is not misread.
- D2's "reuse the write-edge scan ... for R3 where it fits" must not override the sentence before it. `findUpsertWriteEdges` (`PipelineStepRepository.scala:176-193`) is visible-only and runs a full `UpsertSourceConfig.decode`. Reused as-is, it would miss hidden pipelines, and a malformed `mode` would hide a reference. R3 needs the unfiltered privileged scan plus `UpsertTarget.format` on `target` only.
- D2 shows `strpos(config, <id>)` for a single id, but the API takes a set of ids, which teardown needs. Bind it as `config LIKE ANY(...)` or an OR-of-strpos with bound parameters, never by string interpolation.
- Disabled steps (V86 `enabled`) still count as references, since the design applies no filter. Pin this with one test so nobody adds an `enabled` filter later.
- CLAUDE.md says to keep schema updates in the same change. There is no existing schema for the 409, so none is required. Adding `schemas/sources/data-source-delete-conflict-response.schema.json` would still make the additive `references` and `panels` contract explicit.
