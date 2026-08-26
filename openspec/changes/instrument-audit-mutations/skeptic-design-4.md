## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

Cold pass. Every line number and code claim below was re-derived by reading the merged source in
the worktree, not from the revised prose.

**Round-3 change requests, re-checked one by one:**

1. **CR1 (fan-out callers) — FIXED, and the code claims are accurate.**
   - `services/patchsets/PatchSetApplyForward.scala:26 applyOne` confirmed: dispatches to
     `panelService.update/delete/create`, `dashboardService.update/delete/create`,
     `dataSourceService.update/delete/createStatic`, `dataTypeService.update/delete`,
     `pipelineService.updateName/delete/create` across `:33-95` — exactly as Decision 10 states.
   - `PatchSetUndoService.undo` confirmed at `:64`.
   - `DashboardProposalService.apply` at `:64`; `createAll`'s rollback
     `dashboardService.delete(dashboard.id, user)` confirmed at **`:93`** (grep-exact), and
     `panelService.update(created.id, request, user)` at `:192`.
   - Decision 10's ruling (N rows accepted; principle narrowed to single-service compositions) is
     internally consistent with Decision 7, and is carried into tasks §6a.1/6a.3 and the spec
     requirement "Patch-set apply and undo write one row per underlying edit."
2. **The new `DashboardService.deleteInternal` is buildable and mirrors real code.** The public
   `delete` is at `services/dashboards/DashboardService.scala:99`, signature exactly
   `(dashboardId: DashboardId, user: AuthenticatedUser): Future[Either[ServiceError, Unit]]` —
   matching what task 6a.2 specifies for `deleteInternal`. Its body is a 10-line
   `findById` → not-found 404 / non-owner 403 / `dashboardRepo.delete` branch, so an
   audit-free twin is mechanically trivial (see non-blocking note 1 on duplication).
   `DashboardProposalService` holds a `dashboardService` reference already (it calls `.create`
   and `.delete` on it), so no new wiring is needed — the design's "minimal fix" claim holds.
3. **CR2 (ImageUploadService) — FIXED and now factually correct.**
   `services/sources/ImageUploadService.scala:48` is
   `def upload(bytes: Array[Byte], filename: String, user: AuthenticatedUser): Future[Either[ServiceError, ImageUpload]]`
   — it returns an `ImageUpload`, no data source id anywhere. Decision 9's corrected bullet, task
   5.4, and the new spec requirement all now say `image_upload.create` with `resource_id` = the
   `ImageUploadId`. `grep` for `data_source.create` in task 5.4 confirms the wrong instruction is
   gone.
4. **CR3 (MFA lifecycle) — FIXED, and every cited line number is exact.**
   `services/auth/MfaService.scala`: `startEnrollment:49`, `confirmEnrollment:75`,
   `regenerateBackupCodes:85`, `disable:88`, `verifyLogin:115`, private `establishSession:131` /
   `recordFailedAttempt:144`. Design Decision 11's route citations also check out against
   `api/routes/auth/MfaRoutes.scala`: `enroll` post at `:59`, `enroll/confirm` at `:62`,
   `backup-codes/regenerate` at `:69`, `disable` at `:76`. Tasks §6b.1-6b.4 and two new spec
   scenarios cover enable/disable and the explicit `startEnrollment` no-op. Note tasks 6b.1-6b.3
   cite the **service** line numbers (75/88/85) — all correct.

**Independent completeness pass (round 4).** Re-checked the remaining cited anchors, all exact:
`DashboardService.create:69` (returns `Future[(Dashboard, Boolean)]`, `ifExists = Some("return")`
short-circuit confirmed at `:71-76`), `duplicate:116`, `importSnapshot:231`;
`PanelService.create:173`, `duplicate:294`, `batchUpdate:315`, `batchCreate:379`;
`DashboardContentsService.replaceContents:42`. Acceptance-criteria trace: AC1 → tasks 7.2/7.6/7.8;
AC2 → 7.3; AC3 → 7.4; AC4 → 7.10. Task §7.5 remains the exhaustive route-tree backstop for any
directive not individually enumerated. No placeholder/TBD text, no unresolved question left in
design.md, no contradiction between proposal/design/tasks/spec that I could find. The artifact set
is complete and buildable.

### Verdict: CONFIRM

Three rounds of change requests are genuinely closed, and — unlike earlier rounds — every newly
introduced code claim survived independent re-derivation. One substantive design objection remains
(note 1) but it is a defensible judgment call on a rare failure path, unambiguously specified, and
not worth a fourth blocking round against a 5-round budget.

### Non-blocking notes

1. **Decision 10's rollback ruling is half-applied, and its own rationale argues against the half
   it kept.** It cites Decision 2 ("a failed mutation never claims to have happened") to suppress
   the rollback `dashboard.delete` — but then explicitly *retains* the `dashboard.create` row (the
   spec scenario asserts "a `dashboard.create` audit event **was** written ... AND no
   `dashboard.delete`"). The resulting trail says a user created a dashboard that does not exist
   and that nothing ever deleted, for an API call that returned an error. Of the three options
   (both rows / neither row / create-only) the shipped choice is arguably the least readable for an
   auditor. A cheaper alternative Decision 10 never considers: keep both rows but distinguish the
   rollback, e.g. `dashboard.delete` with `metadata = {"reason": "proposal_apply_rollback"}` —
   complete trail, no misattribution to a deliberate user action. Defensible either way (the insert
   really did happen), so not blocking, but worth the executor raising if it proves awkward.
2. **`deleteInternal` will duplicate `delete`'s ACL logic.** Prefer extracting the shared
   `findById` → 404/403 → `dashboardRepo.delete` body into a private helper that both the public
   `delete` (audit) and `deleteInternal` (no audit) call, rather than copy-pasting `:99-110`.
   A divergence between two copies of an ownership check is a security bug waiting to happen.
3. **Task 3.2 is still phrased as an open question** ("Check whether panel `duplicate` routes
   through `create`"). Answered for the executor, again: `PanelService.duplicate` is its own method
   at `:294` (not `create`-routed), so the standalone `panel.duplicate` branch applies. Worth
   folding the answer into the task text rather than re-deriving it at implementation time.
4. **`auth/PermissionRoutes` and `auth/PipelinePermissionRoutes` (share grant/revoke)** remain the
   most security-relevant endpoints outside the ticket's named surface. Task 7.5 will force an
   explicit out-of-scope reason for each, which is acceptable — but they are the obvious first
   follow-up ticket.
