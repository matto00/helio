## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/patch-set-apply/spec.md`,
`specs/patch-set-contract/spec.md`, and round 1's `skeptic-design-1.md` (as a claim to re-verify,
not fact). Cross-checked every claim against the actual backend source under
`WORKTREE_PATH/backend/src/main/scala/com/helio/`, fresh — none of the following was taken from
round 1's or this round's prose without independent confirmation.

**Round-1 findings — verified as fixed:**

1. **D6 (delete+patch signal)** — confirmed `PatchSetProtocol.scala:82-134`'s `Edit.read` is
   exactly where round 1 said the raw `"patch"` value is computed (`obj.fields.get("patch")`,
   line 104) then discarded for `op == "delete"` (falls into `case _ =>` at line 120, all seven
   patch-carrier fields `None`). `proposal.md`'s Impact list now explicitly includes
   `PatchSetProtocol.scala` as modified (lines 70-71), and the `patch-set-contract` MODIFIED spec
   delta correctly reproduces the ENTIRE prior requirement text for "patch reuses existing
   per-resource request shapes" verbatim (diffed `openspec/specs/patch-set-contract/spec.md`
   against `openspec/changes/patch-set-apply-path/specs/patch-set-contract/spec.md`: the only diff
   is the added deserializationError clause + one new scenario; the original scenario and every
   other unmodified requirement is either reproduced byte-for-byte or correctly omitted per
   OpenSpec's MODIFIED-delta convention). Fixed correctly.

2. **Panel delete-rollback identity loss** — `design.md` now says "◐ recreated, NEW id" (D1), D3a
   explains the layout-repoint tradeoff explicitly, D4 gives `recreated` a distinct status +
   `newId`, spec.md has a matching scenario. Fixed correctly.

3. **Dashboard `ifExists` rollback-symmetry break** — confirmed `CreateDashboardRequest(name,
   ifExists)` (`DashboardProtocol.scala:40`) and `DashboardService.create`'s `(Dashboard,
   Boolean)` return (`DashboardService.scala:55-72`) match design's description exactly; D2/D3a
   now reject a create-op edit whose decoded `ifExists` is `Some(...)` at pre-validation; task 3.1
   and task 7.6/spec.md's "A dashboard create edit requesting ifExists is rejected" scenario cover
   it. Fixed correctly.

4. **D2 ACL lookups for panel/pipelineStep** — re-verified against source, both now correct:
   - panel: `PanelService.update` (`PanelService.scala:434-473`) and `.delete` (`:274-287`) both
     use `panelRepo.findByIdInternal` + `authorizeEditorOnDashboard` → `accessChecker.requireAccess
     ("dashboard", dashboardId, ...)` (Viewer → 403, `:528-536`) — identical for both ops, matches
     D2's single panel recipe exactly.
   - pipelineStep: `PipelineService.updateStep` (`:521-623`) and `.deleteStep` (`:626-649`) both use
     `pipelineStepRepo.findByIdInternal` + a pipeline-level owner-or-`requireEditorAccess` check
     (`:656-665`, Forbidden for non-editor grantees) — identical for both ops, matches D2 exactly.
     Confirmed `pipelineStepRepo.findById` (owner-only via parent-pipeline JOIN, its own doc
     comment at `PipelineStepRepository.scala:43-44`) is correctly NOT what D2 uses.
   - dataSource/dataType/pipeline(-level): confirmed `DataTypeService.update`/`.delete`
     (`:69,127`), `DataSourceService.update`/`.delete` (`:472,499`), and
     `PipelineService.updateName`/`.delete` (`:153,169`) each use `findByIdOwned` uniformly for
     both ops — matches D2's "unchanged, confirmed correct" claim.

5. **DataSourceService method-count** — confirmed via `grep`: exactly 8 `create*` methods on
   `DataSourceService` (`createStatic/createCsv/createTextUpload/createTextUrl/createPdfUpload/
   createPdfUrl/createImageUpload/createImageUrl`), plus `createSql`/`createRest` (not
   `createRestApi`) on the separate `SourceService` class (`:43,64`). Matches design.md's revised
   Context claim exactly. Fixed correctly.

**But re-deriving D2's dashboard recipe from source (as the brief specifically asked) surfaced a
new, real defect the round-1 fix didn't catch** — see Change Request 1 below. This is the same
category of bug round-1 finding 4 was about (a pre-validation ACL rule that doesn't match the
kind's REAL per-op access rule), now surfacing specifically for dashboard's delete op, which round
1 didn't test because it only exercised panel/dashboard/pipelineStep's *update* paths.

### Verdict: REFUTE

### Change Requests

1. **D2's dashboard pre-validation recipe is wrong for `delete`-op edits — too permissive,
   letting an Editor grantee pass pre-validation for a dashboard delete the real route would
   reject.** `design.md`'s D2 (lines 83-94) and `tasks.md` task 3.1 give ONE dashboard recipe —
   "`dashboardRepo.findById(id, Some(user))` (sharing-aware); owner passes directly; non-owner goes
   through `accessChecker.requireAccess`, editor-or-owner required" — explicitly justified as
   "matches `DashboardService.update`'s own branching exactly" (design.md line 89-90). That
   justification is correct **only for `update`**. `DashboardService.delete`
   (`DashboardService.scala:86-96`) is genuinely **owner-only**: `case Some(d) if d.ownerId !=
   user.id => Forbidden()` — an Editor grantee is rejected, not admitted. Confirmed
   `DELETE /api/dashboards/:id` (`DashboardRoutes.scala:76-77`) calls this same owner-only
   `dashboardService.delete`. Unlike panel and pipelineStep (both confirmed above to use the
   *identical* ACL rule for update and delete), dashboard's update/delete access rules genuinely
   diverge, and D2/task 3.1 apply the update rule uniformly to both, per the enumeration "For every
   `update`/`delete` edit: ... dashboard: ...".

   Concretely: a patch set containing a dashboard-`delete` edit targeting a dashboard the caller
   only has Editor sharing access to (not ownership) would incorrectly PASS pre-validation under
   this design, then fail only when forward-apply actually calls `DashboardService.delete` (once
   task 4.1's gap in Change Request 2 is also fixed) — triggering the exact "late-discovered
   invalid edit forces a rollback of already-applied prior edits" failure mode AC2 and D2 exist
   specifically to prevent ("All edits pre-validated... before any mutation; an invalid set
   changes nothing"). It also breaks spec.md's `POST /api/patch-sets/apply` requirement that
   rejection be "identically to the corresponding existing PATCH/DELETE endpoint's own access
   rule" — for a dashboard delete, that endpoint's rule is owner-only, not editor-or-owner.

   Fix: split the dashboard recipe by op — keep the current `findById` + editor-or-owner rule for
   `op: update`, but use an owner-only check (e.g. `AccessChecker.requireOwnerOnly`, already
   present on the same `AccessChecker` trait `PatchSetApplyService` is meant to reuse —
   `AccessChecker.scala:28-33` — no new mechanism needed) for `op: delete`, matching
   `DashboardService.delete`'s actual rule. Add a test alongside 7.4/7.8 asserting an Editor
   grantee's dashboard-*delete* edit is rejected pre-apply (the existing 7.4/7.8 language only
   covers an editor-grantee edit being *accepted*, which is true for panel/dashboard *update* but
   not dashboard *delete*).

2. **Task 4.1's forward-apply method enumeration omits the actual `delete` methods for 4 of the 6
   kinds, even though D1's per-kind matrix and spec.md's "Delete-rollback is per-kind" requirement
   both presuppose `delete` is a supported forward op for every kind.** Task 4.1 lists: "via the
   matching existing service method only (`PanelService.create/update/delete`,
   `DashboardService.create/update`, `DataSourceService.createStatic/update`,
   `DataTypeService.update`, `PipelineService.create/updateName`,
   `PipelineService.updateStep/deleteStep`)" — `DashboardService.delete`, `DataSourceService.delete`
   (confirmed exists, `DataSourceService.scala:499`), `DataTypeService.delete` (confirmed,
   `DataTypeService.scala:127`), and `PipelineService.delete` (confirmed, `PipelineService.scala:169`)
   are all absent from this "only" list. Yet:
   - D1's table gives every one of these four kinds an explicit "delete rollback" characterization
     (e.g. dashboard: "✗ unrecoverable (cascades to panels...)"), which is only meaningful if
     `delete` is itself a forward-applicable op for that kind.
   - D2 explicitly pre-validates "every `update`/`delete` edit" for dataSource/dataType/pipeline
     via `findByIdOwned`, again presupposing delete is in scope.
   - spec.md's "Delete-rollback is per-kind" requirement names dashboard/dataSource/dataType/
     pipeline delete-rollback as `unrecoverable`, not "rejected outright."
   - Task 7.7 explicitly requires a test where "a deleted `dataType`... must roll back due to a
     later failure" — which requires `DataTypeService.delete` to have actually been called forward
     in the first place.

   A competent implementer following task 4.1's literal "existing service method only" enumeration
   would not know which method applies a dashboard/dataSource/dataType/pipeline `delete` edit.
   Fix: add the four missing delete methods to task 4.1's enumeration (mirroring the parallel
   structure already used for panel/pipelineStep).

### Non-blocking notes

- (Carried from round 1, still open, still non-blocking) D4's `EditOutcome{index, status, newId}`
  has no per-edit failure reason — spec.md's "unrecoverable dataType" scenario relies on the
  single top-level `failure: Option[String]` to "include the original failure." Fine for v1 but
  worth a deliberate acknowledgment before task 2.1 locks the shape in.
- Once Change Request 1 is fixed, double check whether `dashboardRepo.findById` (used for the
  owner-only branch) vs a plain existence check produces the same 404-vs-403 distinction
  `DashboardService.delete` gives (no existence leak) — `AccessChecker.requireOwnerOnly`'s own doc
  comment (`AccessChecker.scala:18-20`) suggests it already handles this, but worth confirming
  once the split recipe is written.
