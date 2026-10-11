## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD dae4bc4516791452ad5b3e27e871d39771bbd5a6 (worktree is clean except the untracked change dir).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/patchset-resolver-split-followups/HEL-1482`.

### What I verified (with evidence)

**design.md Context claims, checked against the tree**
- `PatchSetResolverSupport` (requireTargetId, authorizeEditorOnDashboard, authorizeEditorOrOwnerOnPipeline,
  requireVisibleStep, decodeCreatePatch) is in `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala:173-233`,
  together with dispatch (`resolveEdit` :51-92) and the three dashboard resolvers (:94-168). TRUE.
- The five new resolver files call no `requireAccess(` / produce no `Forbidden(`: grep of `requireAccess(|Forbidden(|findGrantRole|ResourceAccess.`
  under `services/patchsets/` hits only `PatchSetApplyResolvers.scala` (109, 111, 143, 186, 188, 204, 206). TRUE (4 Forbidden producers on code lines).
- `authorizeEditorOrOwnerOnPipeline` is reached by step update/delete via `requireVisibleStep`
  (`PatchSetPipelineStepResolvers.scala:87,128`) and by step create directly (:212). Preview shares `resolveAll`
  (`PatchSetPreviewService.scala:44`). TRUE.
- "No test grants a pipeline role and then submits a pipelineStep patch-set edit": the only `grantRole("pipeline", ...)` in
  patch-set/route/proposal specs is `PatchSetApplyServiceSpec.scala:1133` (a viewer grant used for an OUTPUT edit). TRUE.
  Also: there is no `"viewer"` dashboard grant anywhere in the patch-set or proposal specs, so the Viewer->Forbidden branches of
  `authorizeEditorOnDashboard` (:188) and `resolveDashboardUpdate` (:111) are plausible D3 survivors.
- `ExistenceNotLeakedRoutesSpec`: `sites` is read only by the completeness guard (:317-318); `filesCallingAccessHelpers()` (:481-488)
  matches `requireOwnerOnly|requireAccess|authorizeResource...(` on code lines, so `PatchSetOutputResolvers.scala` (no such call)
  is not in it and the output rows' `sites` is documentation. Four output rows at :440-447; HEL-1479's M6 (same mutation as D5's M4)
  turned all four red (`archive/2026-10-10-split-patchset-apply-resolvers/mutation-evidence.md:20,41`). `patchSetDispatchPairs()` reads
  `PatchSetApplyResolvers.scala` (:497-499); `expectedForbiddenProducers` pins it at 4 (:529). All TRUE.
- Item 7 origin: `archive/.../evaluation-1.md:67` — the evaluator mutated the editor branch to NotFound (a tightening) and the
  patchsets + ExistenceNotLeaked specs stayed green. D2's M7b is the equivalent tightening. Good.
- Item 3: `PipelineProtocol.scala:60` cites `PipelineService.resolveInlineOrExistingRoot`; repo-wide grep finds no definition. TRUE.
- Ticket-listed citation sites exist as described: `PatchSetPreviewProjection.scala:355` (`PatchSetApplyResolvers.pipelineSummaryResponse`),
  `PatchSetUndoService.scala:245-246` (line-broken `PatchSetApplyResolvers` / `.buildPipelineStepDeletePriorState`, now in
  `PatchSetPipelineStepResolvers`), `RefinementEditShapeSpec.scala:31`, `PatchSetPreviewServiceSpec.scala:504`.
- D6 sweep set inside the six files is enumerable: `PipelineService.addStep` (StepResolvers:36), `.create` (PipelineResolvers:133),
  `.updateStep` (ApplyResolvers:193) are public `PipelineService` members (keep); `PipelineService.resolveRootDataSources`
  (PipelineResolvers:105) is not a `PipelineService` member (repoint) — consistent with D6's rule. Positional words at
  StepResolvers:40,132, PipelineResolvers:118,136, ApplyResolvers:74,85; `[[...]]` at ApplyResolvers:16,17,22.

**D2 — would the tests catch a weakened editor-grant branch?**
- Defense in depth matters here: forward apply calls `PipelineService.updateStep/deleteStep/addStep`
  (`PatchSetApplyForward.scala:93,97,99`), which re-check `requireEditorAccess` (`PipelineStepWrites.scala:44,155,196,245`,
  `PipelineStepCreate.scala:130`). So under M7a (viewer let through at resolve time), a viewer APPLY still ends unmutated — but as
  `Right(PatchSetApplyResponse(failure = Some("Forbidden")))` (`PatchSetApplyService.scala:126-128`), not `Left(Forbidden)`.
  D2 specifies `-> ServiceError.Forbidden (HTTP 403)`, which discriminates (Right-with-failure is HTTP 200), and the viewer-preview
  test has no downstream recheck at all. M7a therefore kills the D2 viewer tests as specified; M7b kills the editor tests at resolve
  time; M7c is adequate. A non-grant caller cannot reach `findGrantRole` (`findByIdShared`, `PipelineRepository.scala:69-87`,
  returns None without a pipeline grant row), so no third arm is untested. D2 is sound.

**D3 — audit scope**
- Re-derived the editor/viewer branch inventory across ALL of `backend/src/main/scala`, not only `services/`:
  besides the files D3 lists, `api/http/AccessCheckerImpl.scala:74-75,83` (the `Role.Editor -> ResourceAccess.Editor`,
  `Role.Viewer -> ResourceAccess.Viewer` mapping) and `api/http/AclDirective.scala:118-119,124,137,141` carry editor/viewer
  branches. D3's re-derivation instruction ("grep ... in `src/main/scala/com/helio/services`") excludes both. `AccessCheckerImpl`
  is the very producer of the `ResourceAccess.Viewer` that the two patch-set dashboard branches in D3's list (`authorizeEditorOnDashboard`,
  `resolveDashboardUpdate`) test against — a `Role.Viewer => Right(ResourceAccess.Editor)` mutation would let a viewer through every
  dashboard patch-set edit and every service-layer dashboard/panel gate at once. See CR1.
- The patch-set vs outside-patchsets split itself is sound: the ticket AC scopes tests to the patch-set resolvers ("and any other
  editor-grant path found with the same gap" is satisfied by recording and ticketing); testFull confirmation per survivor guards
  against false survivors; authorization-defect-by-code-reading escalates. Fine.

**D4** — `Edit.createPatch: Option[JsValue]` (`PatchSetProtocol.scala:67`) and `CreateDashboardRequest.name: Option[String]`
(`DashboardProtocol.scala:55`): a numeric `name` throws in the reader, reaching the `Failure` arm. Service-level construction bypasses
any route decode, so all three messages are reachable. Non-zero index requires a first edit that resolves; D4 says so. Sound.

**D5** — panel/step rows correctly stay on `PatchSetApplyResolvers.scala` (their gates are in `PatchSetResolverSupport`, and the
file must stay covered since it calls `requireAccess`). Sound; see non-blocking note on N2/N5.

**D6** items 8-9 — explicit decisions recorded in design.md D6 and tasks.md; the reasoning (no byte-move mixed with test/comment edits;
archived evidence is a record) is sound and satisfies the AC "an explicit recorded decision".

### Verdict: REFUTE

### Change Requests

1. **design.md D3 (and tasks.md 2.3): widen the audit's inventory to `backend/src/main/scala`, not `.../services`.** Include
   `api/http/AccessCheckerImpl.scala`'s grant-role mapping (`case Role.Viewer => Right(ResourceAccess.Viewer)`, and
   `case Role.Editor => Right(ResourceAccess.Editor)`) and `api/http/AclDirective.scala`'s equivalent `Role.Editor`/`Role.Viewer`
   `provide(...)` arms, with the same let-viewer-through / editor-rejected mutations and killed/survived table rows. Add `Role.Viewer`
   / `Role.Editor` / `.contains("editor")` to the re-derivation grep patterns (the current patterns miss
   `PipelineRunPreview.scala:247` and `PipelineAnalyzeReads.scala:143`, which are only in the list by hand). State explicitly that a
   survivor in `AccessCheckerImpl` whose role mapping feeds `authorizeEditorOnDashboard` is covered for the patch-set path by the
   dashboard-viewer patch-set test (if one is added) and otherwise goes to the follow-up list like the other non-patchset survivors.
   If the planner decides to exclude these files, record the exclusion and its reason in design.md instead — but do not leave the
   central role mapper out silently.

### Non-blocking notes

- D2/D3 assertion shape: because forward apply re-checks editor access, a viewer apply test that asserts only "nothing mutated" or
  "result is a Left OR has a failure" would survive M7a. Keep D2's exact `Left(ServiceError.Forbidden(...))` (or HTTP 403 at route
  level); the same applies to any D3 survivor test on `authorizeEditorOnDashboard`/`resolveDashboardUpdate` (forward apply via
  `PanelService`/`DashboardService` also rejects viewers, yielding `Right(failure=...)`). Worth one sentence in D2 so the executor
  does not copy the weak `result shouldBe a[Left[_, _]]` pattern from `PatchSetApplyServiceSpec.scala:1138`.
- D6 sweep: the `PatchSetApplyResolvers.<member>` dot-form grep misses line-broken citations (the UndoService one is split across
  :245-246) and bare-object mentions that attribute moved behaviour to `PatchSetApplyResolvers`, e.g. `PatchSetProtocol.scala:91`
  (parentId-required check, now in `PatchSetPipelineStepResolvers.resolvePipelineStepCreate`) and `PatchSetProtocolSpec.scala:332`
  (test name). Consider listing these in `citation-sweep.md` with a kept/fixed verdict; they are outside the literal AC.
- `PatchSetPreviewServiceSpec.scala:500` heads that block "Original HEL-671 note, kept verbatim for provenance"; the ticket still
  lists :504. If repointed, say so in the sweep record (or annotate rather than rewrite) so the provenance header is not contradicted.
- D5: panel update/delete and step update/delete foreign arms also depend on lookups now in `PatchSetPanelResolvers` /
  `PatchSetPipelineStepResolvers` (HEL-1479 N2/N5). Leaving those rows' `sites` alone is within C3 and the ticket; just noting the
  labels are "gate file", not "every file the row depends on".
- The `PatchSetApplyResolvers.scala` object doc (:13-24) still describes the file as holding every resolver; it is inside the D6
  sweep scope and should be caught there.
- D3 cost: one testFull per survivor may be many runs; acceptable, but check `free -g` before each per C5.
