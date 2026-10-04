## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 260943222894a97e2d65447ff9b00a7e7f57df89. Only planning artifacts exist; the change dir is untracked and there is no code diff yet.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/guard-source-delete-config-refs/HEL-1252`.
- **Artifacts validate:** `npx openspec validate guard-source-delete-config-refs --strict` printed "Change 'guard-source-delete-config-refs' is valid". The MODIFIED headers match the live spec headers exactly: `datasource-edit-delete/spec.md:109,141` and `workspace-tag-teardown/spec.md:37`.
- **D1 inventory, re-derived independently from the code:**
  - `grep -rln DataSourceId backend/src/main/scala`. The only domain carriers of a source id are:
    - `SecondaryInput` (join/lookup/union; Union holds one `si`, `UnionStep.scala:26`)
    - `UpsertTarget.ExistingSource` (`UpsertSourceConfig.scala:83`)
    - `FormPanelConfig.dataSourceId` (`FormPanel.scala:201`). Its `FormFieldSpec.AllowedKeys` (L37) carry no source id, and nor does `FormSubmitSpec` (L152).
  - `ImagePanelConfig.imageUrl` points at `/api/uploads/image/:id` (a separate `image_uploads` store), not a data source.
  - Migrations V107-V114: only V107 (op CHECK, `upsertsource` confirmed as the op name) and V110 (keyed by pipeline) mention sources.
  - `panels.form_config JSONB` is at V108:30, and `PanelRepository.scala:401-417` has columns `dashboard_id`, `title`, `kind`, `form_config`.
  - **I found no live reference kind that R1-R4 misses.**
- **Visibility predicates (D2) match the DB functions:**
  - `helio_can_access_pipeline` (V39) is owner, or `resource_permissions` with `resource_type='pipeline' AND grantee_id = uid`, and has no anonymous path.
  - `helio_can_access_dashboard` (V36:43-84) has an authenticated branch of owner or `grantee_id = uid`. The public `grantee_id IS NULL` branch applies to anonymous callers only.
  - No later migration redefines either function body (V40/V100 only change ownership).
  - The existing `PipelineRootRepository.findReadEdgesVisibleTo` (L106-123) already implements exactly this pipeline predicate on the system pool.
  - Round-1 CR1 is resolved in the spec delta, in D2, and in tasks C1, 6.2 and 6.6.
- **Current delete path:** `DataSourceService.delete` (L636-648) calls `rootReferences`. The race path `log.warn(..., ex)` is at L666. Round-1 CR2 (log scrubbing) is resolved in D3, D4, C2 and 6.6.
- **Current teardown:** `WorkspaceTeardownRepository.teardown`:
  - All reads run in `ctx.withUserContext` (L106).
  - The tagged sets are owner+tag (L62-64), and the delete order is pipelines, then sources, then dashboards (L84-88).
  - `sourceDependentPipelineConflict` (L115-134) checks roots only. It exempts on `tag IS DISTINCT FROM` (tag only), and its reason interpolates `'$pipelineName' ($pipelineId)` from whatever rows the connection can see.
  - This confirms the gap D4 targets.
- **D5 callers:** `grep dataSourceService.delete` finds the route plus PatchSetUndoService:117, PipelineProposalService:72, PatchSetApplyForward:69, PatchSetApplyRollback:119 and FirstRunDashboardService:46.
  - Rollbacks walk in reverse (`PatchSetApplyRollback:47`, `PatchSetUndoService:100`).
  - `PipelineProposalService.rollback`/`rollbackAll` delete the pipeline before the sources (L444-447, L555-562).
  - The cleanup warn logs print `e.err.message`, which under D3 names only visible resources, so C2 holds.
- **Contract surface:** no `schemas/` file describes the delete 409 body (HEL-989 shipped none). The teardown wire shape (`schemas/workspace/workspace-teardown-response.schema.json`) is unchanged by D4. helio-mcp surfaces the 409 `message` verbatim through `guarded`, so updating the description (5.3) is sufficient. The `/dashboards/:id` route exists for the panel links.

### Verdict: REFUTE

The inventory, the visibility model and the delete-guard design are sound, and both round-1 change requests are genuinely addressed. Three problems remain. Two are in the teardown half, which is where this change rewrites established spec behaviour. Each is cheap to fix now and expensive to discover at the final gate.

### Change Requests

1. **The teardown delta contradicts an untouched requirement in the same capability.**
   - `openspec/specs/workspace-tag-teardown/spec.md:112-123`, "Teardown is owner-scoped", says a foreign-owned resource carrying the same tag "SHALL never be discovered, reported, or deleted". Its scenario says user B's T-tagged pipeline is "not reported as a conflict".
   - The new scenario "Another user's identically tagged pipeline is not exempt" (in this change's `specs/workspace-tag-teardown/spec.md`) requires the opposite. That pipeline is discovered, it blocks the teardown, and it is named when the caller holds a grant.
   - After archive, both requirements would sit in the spec, and an evaluator could fail the correct implementation against either one.
   - Required: add a MODIFIED block for "Teardown is owner-scoped". It must keep "never deleted or counted", and carve out that a foreign-owned resource may still block as an out-of-batch dependent per the dependent requirement, named only when visible to the caller. Adjust that scenario's THEN so it covers only a foreign resource with no reference to the caller's tagged sources.

2. **D4 keeps an RLS-dependent naming path, which contradicts C2 and the ticket's "never derived from RLS" principle.**
   - D4 keeps the in-transaction root check (`WorkspaceTeardownRepository.scala:115-134`) as "the last read before the deletes". That check builds its reason from `'$pipelineName' ($pipelineId)` for whatever `pipelines` rows the connection sees.
   - On the dev/CI superuser connection (BYPASSRLS, `MISTAKES.md:156`), that is every pipeline, including hidden ones. Whether a hidden name leaks therefore depends on RLS being in force, which is exactly the dependency this change exists to remove.
   - D4 says only that a comment will call it "a narrowing re-check". It does not say whether its result can still reach the response.
   - Required: D4 and task 4.2 must state that the in-transaction re-check only blocks. Its conflict must either carry no pipeline identity, or name only ids that pass the explicit D2 visibility predicate. A test must pin this, for example a route spec on the superuser pool asserting that a hidden referencing pipeline's name and id are absent from the teardown response.

3. **Task 1.2's acceptance signal is unreachable as written.**
   - Task 1.2 asks for a probe "on the dev/CI-style superuser AND the non-superuser harness showing teardown misses a hidden pipeline today".
   - On the BYPASSRLS superuser, pre-fix teardown does *not* miss it. It sees the pipeline, blocks, and names it in the reason, which is a leak and not a miss.
   - An executor told to show a "miss" on both pools will either be confused or record misleading evidence.
   - Required: reword 1.2 to record the contrast. The superuser run shows a block that names the hidden pipeline (RLS masking the bug, plus a leak under BYPASSRLS). The non-superuser run shows the miss: a silent commit for a multi-root or join reference, and P0001 for a sole root, per D7.

### Non-blocking notes

- The current `SourceDeleteConflictNotice` (L27-29) drops `conflict.message` whenever any pipeline is named, so a mixed visible+hidden 409 would lose the hidden count in the UI. The spec delta ("SHALL show the conflict reason") already requires the reason to be shown. Make sure 5.2 shows it in the mixed case too, and add a panel-only case (today `named = conflict.pipelines` only).
- D4's pre-check runs "before the user-context transaction", but the tagged-source set is currently computed inside it. The pre-check needs its own owner+tag read on the privileged pool with an explicit `owner_id` filter. That is fine, but say so, so nobody reaches for RLS there.
- "Unnamed counts" in D3: pick one unit (resources, not reference edges) and keep the delete and teardown reasons consistent.
