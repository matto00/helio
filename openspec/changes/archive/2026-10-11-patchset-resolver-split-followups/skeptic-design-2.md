## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD dae4bc4516791452ad5b3e27e871d39771bbd5a6 (worktree clean apart from the untracked change dir).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/patchset-resolver-split-followups/HEL-1482`.

### What I verified (with evidence)

**CR1 (round 1): D3 audit scope widened to `backend/src/main/scala`. ADDRESSED.**
- I ran D3's own re-derivation grep (`findGrantRole|Some("editor")|.contains("editor")|ResourceAccess.Viewer|ResourceAccess.Editor|Role.Viewer|Role.Editor`,
  non-comment lines) over `backend/src/main/scala` at HEAD. Every code hit is either in D3's explicit list or falls under D3's
  "any hit not mutated gets a one-line reason in the table" rule:
  - Listed: `AccessCheckerImpl.scala:74,75,83`; `AclDirective.scala:118,119` (+124,137,141); `AutoLayoutService:143`;
    `PipelineRunPreview:247` and `PipelineAnalyzeReads:143` (the `.contains("editor")` pattern now catches both, as CR1 asked);
    `PipelineRunService:196-197`; `PanelService:144,221,279,317-318`; `PipelineService:252-253`; `OutputService:140`;
    `AutoRunTriggerService:144-145`; `ApiTokenService:101-102`; `PatchSetApplyResolvers:111,188,204-205`;
    `DashboardContentsService:148`; `DashboardService:202,254`.
  - Not listed, so a table reason is required: `ResourcePermissionRepository.scala:36` (unknown role falls back to `Role.Viewer`, a
    fail-closed default) and `PipelineRepository.scala:180` (the `findGrantRole` definition).
- `AccessCheckerImpl.scala:72-76` and `AclDirective.scala:116-120` really are the `Role.Editor/Role.Viewer -> ResourceAccess.*` mappings.
  The design's mutations (Viewer->Editor lets a viewer through; Editor->Viewer rejects an editor) are one-line, and each is the right
  shape for its arm.
- D3 now states the disposition CR1 asked for: survivors in `AccessCheckerImpl`/`AclDirective` go to the follow-up list unless a
  patch-set dashboard-branch test added here already kills them, and that outcome is recorded.

**D2 re-checked against the code.** In `PatchSetApplyResolvers.scala:194-208`, M7a and M7b are each a one-line edit of the
`case Some("editor") => Right(())` arm, and M7c targets `pipeline.ownerId == user.id`. Under M7c the owner falls through to
`findGrantRole`, gets None and then Forbidden, so the mutation is killable. The new "Assertion strength" paragraph requires the exact
`Left(ServiceError.Forbidden(...))` / HTTP 403. That closes the round-1 concern that an M7a viewer apply ends as
`Right(failure=...)` because of the forward-apply recheck.

**D4 re-checked.** The message literals in `PatchSetResolverSupport` (`:175-179` requireTargetId, `:222-230` decodeCreatePatch) match
the strings D4 tells the executor to assert, including the `edit $index:` prefix and the `(${ex.getMessage})` suffix. D4 handles that
suffix with a "starts with" assertion, which is the right choice.

**D6 sweep notes.** I grepped `PatchSetApplyResolvers` across `backend/src`. The hits the round-1 notes named exist as described:
- the line-broken citation at `PatchSetUndoService.scala:245-246`
- the object-only mention at `PatchSetProtocol.scala:91`
- the test-name literals at `PatchSetProtocolSpec.scala:252,332`, now fenced as test identity, which is correct under C1
- `PatchSetPreviewServiceSpec.scala:504`, handled by annotating rather than rewriting
- `RefinementEditShapeSpec.scala:31,234`

Other comment hits (`ApiRoutes.scala:533`, `RefinementGrounding.scala:30`, `PipelineRepository.scala:625`, `PatchSetApplyForward.scala:77`,
`PatchSetApplyTypes.scala:93`, `PatchSetApplyServiceJson.scala:10`, `PatchSetApplyService.scala:33`) fall in scope of the D6 sweep
("every comment in `backend/src` ... crediting moved behaviour to `PatchSetApplyResolvers`"), so the executor will reach them and give
each a kept/fixed verdict. Several are correct as they stand: `resolveAll` and `resolveDashboardUpdate` really do remain in
`PatchSetApplyResolvers`.

**Remaining design (unchanged since round 1, re-read):** D1 (red-first by mutation, scripts outside the repo), D5 (only the four output
rows; C3 fences the rest), D7 (gates, `testFull`, comment-only main diff), and the item 8/9 recorded decisions are all still consistent
with the ticket's acceptance criteria. Every AC maps to a task: items 1-3 to 5.1/5.2, item 4 to 4.1, items 5-7 to 2.1-2.3/3.1-3.2,
no-behaviour-change to 6.1, items 8-9 to D6 and the tasks section. Placeholders and unresolved TBDs: none.

### Verdict: CONFIRM

### Non-blocking notes
- D3 table: `AclDirective.scala:124,137,141` are `tokenAuthorizes`/public-grant `provide(ResourceAccess.Viewer)` arms, not role
  mappings. Mapping them to Editor is a valid let-through mutation, but if the executor skips them, the one-line reason should say
  they are token/public read arms. The same applies to `ResourcePermissionRepository.scala:36`: a fail-closed fallback, so mutating
  it to `Role.Editor` is a legitimate fail-open probe. Either mutate it or give a reason.
- Several D3 sites accept editors with a wildcard (`case Right(_)` / `Right(Owner)|Right(Editor)`) that the grep cannot see. D3's
  "where a separate editor-accept branch exists" leaves it to the executor to decide which sites get an editor-rejected mutation. The
  table should say per site whether one was applied.
