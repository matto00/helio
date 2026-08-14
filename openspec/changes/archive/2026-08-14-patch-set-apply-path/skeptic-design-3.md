## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/patch-set-apply/spec.md`,
`specs/patch-set-contract/spec.md`, and both prior skeptic reports (`skeptic-design-1.md`,
`skeptic-design-2.md`) as claims to re-verify, not fact. Cross-checked every claim fresh against
the actual backend source under `WORKTREE_PATH/backend/src/main/scala/com/helio/`.

**Round-2 finding re-verified as fixed, independently:**
- Read `DashboardService.scala:82-97` directly (not round 2's prose). `delete` really is
  owner-only: `dashboardRepo.findById(dashboardId, Some(user))` (sharing-aware, so a no-grant
  caller 404s, not 403s), then `case Some(d) if d.ownerId != user.id => Forbidden()`. `update`
  (`:123-145`) really does admit editor grantees via `accessChecker.requireAccess` →
  `Right(ResourceAccess.Viewer) => Forbidden`, else proceed. `design.md`'s D2 (lines 90-98) and
  `tasks.md` task 3.1 now correctly split the dashboard recipe per-op, matching both methods
  exactly. Confirmed `DashboardRoutes.scala:70,77` call `dashboardService.update`/`.delete`
  directly — the split recipe matches the real routes. **Fixed correctly.**
- Re-verified task 4.1 now lists all four previously-missing `delete` methods
  (`DashboardService.delete`, `DataSourceService.delete`, `DataTypeService.delete`,
  `PipelineService.delete`) alongside the others. Matches source signatures. **Fixed correctly.**
- Re-verified panel (`PanelService.scala:274-287,434-473`) and pipelineStep
  (`PipelineService.scala:521-623,626-649`) independently: both kinds' update/delete really do
  share one identical ACL recipe each (panel: `findByIdInternal` + `authorizeEditorOnDashboard`;
  pipelineStep: `findByIdInternal` + pipeline-level owner-or-`requireEditorAccess`, confirmed via
  `pipelineRepo.findByIdShared` + `requireEditorAccess` at both `:529-537` and `:631-637`) —
  D2's claim that these two kinds (unlike dashboard) don't diverge between ops still holds.

**New problem found while doing the round-3-requested scan of the rest of the matrix for other
access-rule divergences "assumed away without checking"** — see Change Request 1 below. This is
a different instance of the same root defect class as round 1 finding 4 / round 2's finding, but
in a part of the matrix neither prior round exercised: pre-validation's promise to authorize
"target + ownership" only ever looks at the top-level `EditTarget`/decoded top-level id — it
never authorizes a resource referenced *from inside* a `patch`/`createPatch` payload, even though
several of the real per-resource services perform exactly that check as part of their own
`create`/`update` ACL logic (the codebase's own comments literally label several of these
"Pre-flight ACL", e.g. `PipelineService.scala:448,457,469`).

### Verdict: REFUTE

### Change Requests

1. **Pre-validation (D2/task 3.1) never authorizes a resource referenced *inside* an edit's
   `patch`/`createPatch` payload — only the top-level target. This is real for both `create`-op
   edits (no top-level target ACL check exists for `create` at all) and for two `update`-op
   kinds whose real service performs an ownership check on an embedded field D2 doesn't
   replicate.** This is squarely inside AC2's own stated scope — "pre-validates every edit
   (target resolves + owned under RLS + patch shape valid) up front" (ticket.md Scope) — since
   every instance below is literally an `ownerId`/access check on an RLS-governed resource, not a
   deeper business rule.

   **(a) `create`-op edits: no ACL check on the parent resource the create targets, at all.**
   `EditTarget(kind, id: Option[String])` (`PatchSetProtocol.scala:17`) has no `id` for `create`
   (confirmed: the reader's existence check at `PatchSetProtocol.scala:99` only fires for
   `op == "update" || op == "delete"`). The only place a parent resource is named for a `create`
   is *inside* the decoded `createPatch`. D2's entire `create` recipe (design.md lines 110-113)
   is "decode into the matching `Create*Request`... reject `ifExists`... nothing is applied until
   every edit resolves" — no ACL check on anything the decoded request references. Concretely:
   - **panel-create**: `CreatePanelRequest.dashboardId` (`PanelServiceHelpers.scala:150-154`,
     `validateCreatePanelRequest` — presence-only, no ownership check) is the dashboard the panel
     is created on. The REAL `PanelService.create` (`PanelService.scala:168-186`) authorizes this
     dashboardId via `accessChecker.requireAccess("dashboard", dashboardId.value, ...)`,
     editor-or-owner, *before* building/inserting the panel. Pre-validation never runs this check
     against the decoded `dashboardId`.
   - **pipeline-create**: `CreatePipelineRequest.sourceDataSourceId` is the data source the
     pipeline reads from. The REAL `PipelineService.create` → `pipelineRepo.create`
     (`PipelineRepository.scala:212`) authorizes it via `dataSourceRepo.findByIdOwned(sourceDataSourceId,
     user)` (owner-only) before inserting anything. Pre-validation never runs this check either.

   Concrete failure scenario this produces (directly analogous to round 2's Change Request 1,
   just via a different mechanism): a patch set = `[panel-delete (succeeds forward-apply,
   tracked), panel-create targeting a `dashboardId` the caller has no access to (decode succeeds,
   pre-validation currently has nothing to reject it on)]`. Per task 3.1/D2 as written, this
   entire patch set incorrectly PASSES pre-validation (both edits "resolve"). Forward-apply then
   applies edit 1 (the delete succeeds), then calls `PanelService.create` for edit 2 — which
   correctly 403s/404s via its own internal `accessChecker.requireAccess` — triggering the
   rollback walk (task 4.2) to reverse edit 1 via the "◐ recreated, NEW id" path (D1/D3a),
   **needlessly losing that panel's identity for a patch set that should never have been allowed
   to mutate anything** (AC2: "an invalid set changes nothing"; task 3.1's own words: "nothing
   mutates until every edit resolves"). This is exactly the failure mode D2/AC2 exist to prevent,
   just triggered by an unauthorized *embedded* reference instead of an unauthorized *top-level*
   target.

   **(b) Two `update`-op kinds also embed an ownership-gated reference D2 doesn't check:**
   - **panel `update`/`create`**: `PanelService.update` (`:434-473`) and `.create`'s
     `buildForCreate` (`:199-235`) both call `rejectCompanionBinding` (`:483-495`, checks a
     `dataTypeId` embedded in the config patch via `dataTypeRepo.findByIdOwned`) and
     `rejectUnresolvableMetric` (`:508-524`, checks a `metricId` embedded in the config patch via
     `metricRepo.findByIdOwned`) — both 400 when the referenced `dataTypeId`/`metricId` isn't
     owned by the caller. D2's panel recipe only covers `findByIdInternal` +
     `authorizeEditorOnDashboard` on the panel/dashboard itself; it never decodes the config
     patch to check these.
   - **pipelineStep `update`**: `PipelineService.updateStep` (`:568-606`) runs three
     "Pre-flight ACL" checks (the code's own label, `:448,457,469` on the `addStep` sibling) —
     `JoinConfig.rightDataSourceId`, `UnionConfig.otherDataSourceId`,
     `LookupConfig.referenceDataSourceId` — each via `dataSourceRepo.findByIdOwned`, 404ing a
     non-owned reference. D2's pipelineStep recipe only covers the pipeline-level owner-or-editor
     check; it never decodes the step config patch to check these embedded data-source
     references.

   Same consequence as (a): an `update` edit carrying a foreign-owned `dataTypeId`/`metricId` or
   `rightDataSourceId`/`otherDataSourceId`/`referenceDataSourceId` passes pre-validation, then
   fails only at forward-apply — for `update`, the rollback of any prior-applied edits is at
   least symmetric (no identity loss, since update-rollback reapplies captured full prior state),
   but it still violates the literal "nothing mutates until every edit resolves" invariant, and
   compounds severity when combined with (a) or with any preceding panel/pipelineStep delete in
   the same patch set, as in the (a) scenario above.

   None of `design.md`, `tasks.md`, or `specs/patch-set-apply/spec.md` mentions any of
   `dashboardId` (for panel-create), `sourceDataSourceId` (for pipeline-create), `dataTypeId`/
   `metricId` (for panel-update/create), or `rightDataSourceId`/`otherDataSourceId`/
   `referenceDataSourceId` (for pipelineStep-update) anywhere — confirmed via grep across all
   four artifacts, zero hits. This was not a documented, deliberate scope cut (unlike, e.g., D1's
   explicit "no idempotent get-or-create" or "no cross-edit references" non-goals) — it's an
   unexamined gap.

   **Fix** (either is acceptable, but D2 must pick one explicitly and task 3.1/spec.md must name
   it — currently neither exists):
   - Extend D2's `create` recipe to also run the SAME ACL check the real create path runs against
     any embedded parent-resource reference (panel-create → dashboard editor-or-owner check on
     the decoded `dashboardId`; pipeline-create → `findByIdOwned` on the decoded
     `sourceDataSourceId`), and extend the panel/pipelineStep `update` recipes to likewise decode
     and check their embedded `dataTypeId`/`metricId`/other-DataSourceId references — mirroring
     the exact checks named above, all of which already live on services/repos
     `PatchSetApplyService` already depends on (`accessChecker`, `dataSourceRepo`, `dataTypeRepo`,
     `metricRepo`); OR
   - Explicitly document in design.md (Non-Goals/Risks) that pre-validation deliberately stops at
     the top-level target/parent's ACL and knowingly defers embedded cross-resource references to
     forward-apply's own checks, accepting the resulting "late-discovered invalid edit forces a
     rollback of already-applied prior edits" risk (including a possible identity-losing panel/
     pipelineStep recreate) as a stated, bounded v1 limitation — the same way D1/D3a already
     documents the delete-rollback identity-loss limit, rather than leaving it silently unstated.

   Either way, add a task-7.x test (or explicitly note the deferral) for at least the panel-create
   `dashboardId` case, since it's the one with the most severe consequence (compounding with
   identity-losing delete-rollback).

### Non-blocking notes

- (Carried from round 1, still open, still non-blocking) D4's `EditOutcome{index, status, newId}`
  has no per-edit failure reason.
- If Change Request 1 is resolved via the "document as a deferred limitation" branch rather than
  the "implement the check" branch, the Risks section should say so explicitly next to the
  existing D2 ACL-replication-risk paragraph, since it's the same underlying risk class.
