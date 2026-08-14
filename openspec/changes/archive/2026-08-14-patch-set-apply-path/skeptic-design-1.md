## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

I read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
`specs/patch-set-apply/spec.md`, then verified every D1/D2 grounding claim against the
actual backend source (not the design doc's prose), per the brief. All line references
below are to files under `WORKTREE_PATH/backend/src/main/scala/com/helio/`.

**Claims that check out:**
- `DataTypeService` genuinely has no `create` (`update`/`delete` only, `DataTypeService.scala:69,127`) — confirmed.
- `DataTypeService.update`/`delete` really do use `dataTypeRepo.findByIdOwned` (`DataTypeService.scala:74,132`) — matches D2's claim.
- `DataSourceService.update`/`delete` really do use `dataSourceRepo.findByIdOwned` (`DataSourceService.scala:472,499`) and are uniform across all `DataSource` subtypes including ones minted by the separate `SourceService` — matches D1's "✓ update / ✗ unrecoverable delete" for dataSource.
- `PipelineService.create`/`addStep` line numbers (`:133,433`) and `addStep`'s `(pipelineId, req, user)` signature — confirmed; `EditTarget(kind, id)` (`PatchSetProtocol.scala:17`) genuinely has no parent-pipeline field, confirming the pipelineStep-create rejection rationale.
- `PipelineService.updateName`/`delete` (pipeline-level, not step-level) really are owner-only via `pipelineRepo.findByIdOwned` — matches D2.
- `StaticDataSourceRequest` is genuinely pure-JSON (no file/URL fields) — matches the "static only" create scope.

**Claims that do NOT check out — five distinct, concrete problems:**

1. **D6's fix for the HEL-403 carried-over follow-up is unimplementable as scoped.** `PatchSetProtocol.scala`'s `Edit.read` (lines 82–134) computes `val patch = obj.fields.get("patch")` (line 104) but for `op == "delete"` falls into `case _ => (None, None, None, None, None, None, None)` (line 120) — **the raw patch value is discarded before the `Edit` case class is ever constructed.** By the time `PatchSetApplyService.apply` receives a `PatchSet` (already `entity(as[PatchSet])`-decoded per D5), there is no field on `Edit` recording whether a delete-op edit's wire JSON had a populated `"patch"` key — all seven patch-carrier fields are `None` regardless. D2/D6 place the rejection entirely inside `PatchSetApplyService`'s pre-validation, and `proposal.md`'s Impact list states explicitly: *"No changes to existing PATCH endpoints, request shapes, or the `PatchSetProtocol` from HEL-403."* As scoped, `PatchSetApplyService` literally cannot detect the condition spec.md's own "A delete edit with a populated patch is rejected" scenario and tasks 2.1/6.5 require it to reject — the signal needed to reject it is destroyed one layer earlier, in a file the proposal explicitly rules out touching. (I confirmed no existing test in `PatchSetProtocolSpec.scala` exercises a delete-op edit with a populated `patch` — the carried-over gap is real and still open.)

2. **Panel delete-rollback ("✓ full") loses the panel's identity and orphans the dashboard layout.** `PanelService.create`/`buildForCreate` always mints a fresh `PanelId(UUID.randomUUID().toString)` (`PanelService.scala:220`) — there is no existing API to recreate a panel with a caller-specified/original id. `DashboardLayoutItem(panelId: PanelId, x, y, w, h)` (`domain/model.scala:282`) references panels by id, is stored as opaque JSONB on the dashboard row (`V33__jsonb_columns.sql`) with no FK, and `PanelService.delete` (`PanelService.scala:274-286`) never touches layout on delete. So a "full" panel-delete rollback (D1/D3/task 4.2: "recreate via `PanelService.create`") restores the panel's *content* under a *different id* — the dashboard's layout still names the old, now-permanently-orphaned id, and has no entry at all for the recreated one. This directly contradicts D1's "✓ full" characterization and AC1's "workspace is left exactly as before" — and design.md's Risks section never mentions it (only the four already-"unrecoverable" kinds are discussed as limits).

3. **`DashboardService.create`'s `ifExists: "return"` idempotent path breaks the create→delete rollback symmetry.** `CreateDashboardRequest.ifExists` (`DashboardProtocol.scala:40`) is a real field on exactly the request shape D1 says the dashboard create-op edit's `createPatch` decodes into. When `ifExists = Some("return")` matches an existing same-name dashboard, `DashboardService.create` returns `(existingDashboard, created = false)` — confirmed by `DashboardRoutes.scala:44-48`'s own comment: *"`created = false` means `ifExists: "return"` matched an existing dashboard by name... nothing was created."* D3's compensating action ("`create` → delete via the same kind's existing delete method") never checks this flag. If this dashboard-create edit is tracked as "applied" and a later edit fails, rollback would delete a dashboard that **predates the patch-set entirely** — real data loss, not a no-op undo. Neither `design.md` nor `proposal.md` mentions `ifExists` or `DashboardService.create`'s `(Dashboard, Boolean)` return shape anywhere.

4. **D2's ACL-lookup claims are wrong for 3 of the 6 kinds, in both directions — undermining the pre-validation atomicity guarantee (AC2) and spec.md's "identically to the existing PATCH/DELETE route" requirement:**
   - **panel:** D2 proposes `panelRepo.findById` for pre-validation, claiming it's "already used by [PanelService's] own update/delete path." False — `PanelService.update`/`delete` (`PanelService.scala:434-444,274-286`) use `panelRepo.findByIdInternal` (no ACL) + `authorizeEditorOnDashboard` (`PanelService.scala:528-536`, explicitly 403s `ResourceAccess.Viewer`). `panelRepo.findById(id, callerOpt)` (`PanelRepository.scala:114-152`) is actually `PanelService.findById`'s **read**-path lookup, and its `granteePred` matches **any** grant role — it does not filter by role the way `publicPred` does. Result: a caller with only Viewer-level sharing access to a panel's dashboard would incorrectly "pass" pre-validation (treated as a valid, accessible edit) when the real `PATCH`/`DELETE /api/panels/:id` route would 403 them — the exact failure AC2 says pre-validation must catch *before any mutation*.
   - **dashboard:** D2 proposes `dashboardRepo.findByIdOwned`. But `DashboardService.update` (`DashboardService.scala:123-142`) uses `dashboardRepo.findById` (sharing-aware) + a role check that lets **Editor grantees through** (only Viewer → 403). `findByIdOwned` is owner-only, so pre-validation would incorrectly 404 a legitimate Editor-grantee dashboard update that the real PATCH route allows.
   - **pipelineStep:** D2 proposes `pipelineStepRepo.findById`, again claiming reuse from the real update/delete path. False — `PipelineService.updateStep`/`deleteStep` (`PipelineService.scala:521-620`) use `pipelineStepRepo.findByIdInternal` + a pipeline-level owner-or-editor check (Viewer → 403). `pipelineStepRepo.findById(id, user)` (`PipelineStepRepository.scala:44-50`) is documented in its own comment as *"Owner-scoped findById via the parent-pipeline JOIN"* — i.e. owner-only. Pre-validation as scoped would incorrectly 404 a legitimate Editor-grantee's pipelineStep edit.

   This isn't a one-off slip — it's a pattern across half the kinds in the matrix, and it runs both ways (too permissive for panel, too restrictive for dashboard and pipelineStep), which is exactly the failure mode a "grounded in real constraints" pre-validation design is supposed to prevent.

5. **Minor grounding inaccuracy (non-blocking on its own, but the doc explicitly claims it was verified from source):** design.md's Context section says *"`DataSourceService` has NINE separate `create*` methods (`createStatic`/`createCsv`/`createRestApi`/`createSql`/`createTextUpload`/`createTextUrl`/`createPdfUpload`/`createPdfUrl`/`createImageUpload`/`createImageUrl`)."* That's ten names, not nine, and two of them — `createRestApi`, `createSql` — don't exist on `DataSourceService` at all. The real methods are `createRest`/`createSql`, and they live on a **different class entirely**, `SourceService` (`SourceService.scala:43,64`). `DataSourceService` itself has 8 create methods. The D1 conclusion (dataSource create scoped to `createStatic` only) still holds either way, but the "read directly from source before deciding scope (not assumed)" framing oversells the accuracy of this particular claim.

### Verdict: REFUTE

Findings 1, 3, and 4 are functionally blocking (an explicitly-required scenario is unimplementable as scoped; a real data-loss path is unaccounted for; the pre-validation ACL story is wrong for half the kind matrix, in both directions). Finding 2 contradicts the "✓ full" rollback claim for the one kind the design treats as fully solved. These aren't nits — they're the same category of grounding-claim inaccuracy the design doc itself flagged D1 as most likely to contain, just concentrated in D2/D3/D6 rather than D1's headline matrix (which, to be clear, is basically sound wherever it doesn't rely on flawed ACL-lookup or rollback-identity assumptions).

### Change Requests

1. Resolve the delete+patch rejection (design.md D6) at a layer that actually has the
   information: either (a) add `PatchSetProtocol.scala` to the Impact list and change
   `Edit.read` to raise a `deserializationError` when `op == "delete"` and the wire JSON's
   `"patch"` key is present (simplest — matches the reader's existing enforcement of
   `target.id` for update/delete), or (b) preserve a raw-patch-presence signal on `Edit`
   for delete ops so `PatchSetApplyService` can reject it downstream. Either way, update
   proposal.md's Impact section (currently states no `PatchSetProtocol.scala` changes) and
   add the test coverage tasks.md/spec.md already require.

2. Either drop "✓ full" for panel delete-rollback and mark it honestly limited (e.g.
   "recreate via `PanelService.create` — content restored, but panel id and dashboard
   layout position are NOT preserved"), or extend the design to also capture/restore the
   dashboard's `layout` entry for the deleted panel id as part of the same rollback step
   (reapplying it against the *new* panel id via `DashboardService.update`'s layout patch).
   State which approach D1/D3/task 4.2 take explicitly.

3. Address `DashboardService.create`'s `ifExists: "return"` case in D3's rollback
   compensation: either reject `ifExists` in a create-op edit's `createPatch` at
   pre-validation (simplest — this ticket never needs idempotent-return semantics), or
   have the forward-apply step check the returned `created: Boolean` and only track/roll
   back the edit as a "create" when `created = true`.

4. Re-derive D2's per-kind pre-validation lookup from the *actual* update/delete code path
   for panel, dashboard, and pipelineStep (not the lookup method with the closest-sounding
   name):
   - panel: reuse `panelRepo.findByIdInternal` + `authorizeEditorOnDashboard` (or
     equivalent), not `panelRepo.findById`.
   - dashboard: reuse `dashboardRepo.findById` (sharing-aware) + the same
     owner-or-editor-else-403 branching `DashboardService.update` uses, not
     `dashboardRepo.findByIdOwned` (correct only for delete/duplicate's owner-only rule,
     not update's editor-permits rule).
   - pipelineStep: reuse `pipelineStepRepo.findByIdInternal` + the pipeline-level
     owner-or-editor check `updateStep`/`deleteStep` perform, not `pipelineStepRepo.findById`
     (owner-only by its own doc comment).
   Re-verify dataSource/dataType/pipeline's listed lookups are still correct once this is
   fixed (they checked out in this review, but re-confirm against the corrected design).

5. Fix the `DataSourceService` create-method inventory in design.md's Context section:
   8 methods on `DataSourceService` (not 9), plus 2 more (`createRest`/`createSql`, not
   `createRestApi`) on a separate class, `SourceService`. Doesn't change the D1 conclusion,
   but the doc's "read directly from source" framing should match what's actually there.

### Non-blocking notes

- D4's `EditOutcome{index, status}` shape is fine as a v1 response; consider whether
  `status` should also carry a short human-readable reason for `unrecoverable`/`rolledBack`
  (spec.md's own scenario for the dataType case says the response "includes the original
  failure," but D4's shape only has a single set-once `failure: Option[String]` at the
  top level, not per-edit) — worth clarifying whether that's sufficient before task 1.1
  locks the shape in.
- `PipelineService.create`'s `CreatePipelineRequest` requires a real, presumably
  already-existing `sourceDataSourceId` — fine given it's delegated to the existing
  service's own validation, just worth being explicit in design.md that "empty pipeline,
  no steps" doesn't mean "no required fields."
