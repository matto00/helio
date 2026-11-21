## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 13180246ad2ab41bfed697e422ff419321d9df78 (no implementation commits yet). Paths are under `backend/src/main/scala/com/helio/`
unless stated.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/draft-undo-panel-naming/hel-1792`.
- **The premise is correct.** `DraftRestore.restore` (`services/pipelines/draft/DraftRestore.scala:39-43`) refuses with
  `ServiceError.Conflict` before `saveCore`. `dependentsOfCreatedOutputs` (:73-86) and `dependentsOfRemovedOutputs` (:56-68)
  build `panel <id> (Output <id>)` and `alert rule <id> "<name>"` strings from internal reads. `cascadeGate`'s Restore branch
  (`DraftSaveTransaction.scala:158-167`) lists `panel <id>`. All three leak ids, as the restated AC says.
- **D1 "a draft save never creates panels": TRUE.** Nothing in `services/pipelines/draft/*` writes panels. `panelRepo` is
  used only for reads: `findIdsByOutputIdsInternal` at DraftRestore:80 and `findIdsByOutputIdsAction` at
  DraftSaveTransaction:135. `PipelineDraftWrites` uses `PanelRowLocks` only to lock and cascade-delete. So nothing needs to be
  excused, and not reusing `blocker`/`blockingPanelIds` is the right call.
- **Reuse is feasible.** `PatchSetUndoBoundPanels` is `private[services]` (:18), so code in `com.helio.services.pipelines.draft`
  can call it. `describe` (:86-91) uses `panelRepo.findById(_, Some(user))` and `dashboardRepo.findById(_, Some(user))`.
  Both use explicit owner and grantee predicates on the system context (`PanelRepository.scala:145-185`,
  `DashboardRepository.scala:92-111`). They do not depend on the `app.current_user_id` RLS setting, so the naming is
  correct on either pool. `DraftRestore` is built at `api/ApiRoutes.scala:668`; adding repos there is the only wiring
  change. `AlertRuleRepository.findByIdOwned` (`infrastructure/persistence/alerts/AlertRuleRepository.scala:67`) filters on
  `owner_id = user`, which matches D2.
- **The D6 two-user case is reachable through real services.**
  - `PanelService.duplicate` (`services/panels/PanelService.scala:212-222`) needs only panel read access and
    `authorizeEditorOnDashboard`. No pipeline grant is needed.
  - `PanelMutationRepository.duplicate` (:38-80) copies the row with `ownerId = caller`. The copy keeps `output_id` and
    stays on the same dashboard.
  - So B, an editor on A's dashboard D, gets B-owned P2 bound to O on D. A reads P2 through `findById`'s owner branch,
    because A owns D. P2 would therefore be named, as D6 expects.
  - `PatchSetUndoBoundOutputPanelsSpec.scala:173-183` already drives this exact path on `helio_app_test`, so the
    fixture pattern exists.
- **D6's P3 is NOT reachable by B through panel create.** `PanelBindingChecks.rejectMissingOutput` (:41-50) uses
  `OutputRepository.findByIdOwned` (:224-229, `owner_id = user`). B cannot bind a panel to A's Output O. See CR2.
- **D5 logs: nothing logs the refusal today.**
  - `PatchSetUndoRoutes` is a thin `ServiceResponse.run`, and `ServiceResponse.scala` has no logger (grep for
    `log`/`Logger`: no logging call).
  - `PatchSetUndoService`'s only `log.error` (:104) is in `restoreAll`, which the draft dispatch (:76-78) skips.
  - The only logger in the draft package is `DraftSaveService.scala:180` (runAfterSave). D5's "verify" task is
    proportionate.
- **The stale 409 carries no panel id.** `PatchSetStaleMessage.error` names `edit N (pipeline <pipelineId>)` only.
- **The cascadeGate race CANNOT be exercised via `DraftSaveHooks`. The Restore branch of `cascadeGate` is unreachable in
  practice.** Evidence:
  1. The pipeline fingerprint includes every Output's `panelIds` and `alertRules`
     (`PatchSetPipelineDefinition.ofAction`:39-51, `outputsJson`:88-98). `PatchSetTargetFingerprint.Allowlist("pipeline")`
     includes `outputs` (:43).
  2. `DraftSaveTransaction.run` compares that fingerprint to `req.baseFingerprint` at :86-88, BEFORE `impactOf`/`cascadeGate`
     at :99-100. In a restore, `baseFingerprint` is the journaled post-save fingerprint. At that point the created Outputs
     had no panels, because a draft save never creates panels.
  3. `lockDefinition` takes `outputs ... FOR UPDATE` (`PipelineDraftWrites.scala:143-147`) before the definition read. A
     concurrent panel insert needs FOR KEY SHARE on its Output row for the FK check, so it blocks until the restore commits.
  4. The hook points are `Begin`, `AfterLock(site)`, `AfterCompare` and later (`DraftSaveHooks.scala:7-21`). There is no hook
     point between the compare (:88) and the gate (:100). `AfterCompare` runs after the gate (:101).

  So a bind landing after the pre-check either commits before the definition read, which gives `PATCH_SET_STALE`, or blocks
  until the restore has committed. `cascadeGate`'s Restore refusal never fires. A repo-wide grep of `backend/src/test` for
  `restoring would delete` / `bound after the save` finds no hits: no existing spec reaches it. This is a static reading, and
  it does not depend on timing.
- **Scope:** ACs 1-5 of the restated scope each map to D2/D3/D4/D6 and tasks 1.x-3.x. No client change is planned, matching
  AC5. The alert-rule naming extension is self-approved and minimal.
- **The spec delta's header matches main.** `openspec/specs/patch-set-undo/spec.md:206` has the same requirement name. The
  "Cascade removed" scenario is updated consistently.

### Verdict: REFUTE

### Change Requests

1. **Rewrite the in-transaction race claim (design D4, D6's third case, tasks 1.3 and 3.2, and the delta's "A bind that
   lands during the restore" scenario). As planned, it cannot be built or go green.** The design says `cascadeGate`
   catches "a bind that lands between the pre-check and the compare". It does not:
   - The fingerprint compare at `DraftSaveTransaction.scala:88` covers `outputs[].panelIds` and runs first, under
     `outputs FOR UPDATE`.
   - Such a bind therefore produces `409 PATCH_SET_STALE`. That message carries no panel id.
   - `DraftSaveHooks` has no point between the compare and the gate, so task 1.3 cannot stage the race.
   - Task 3.2's mutation ("drop the pre-check, the cascadeGate case still refuses (count only)") will instead get
     `PATCH_SET_STALE`.

   Required:
   - (a) The delta scenario must state the real behaviour: a bind after the pre-check gives 409 `PATCH_SET_STALE`, with no
     panel id and nothing changed.
   - (b) Task 1.3 must test that, for example by a hook at `Begin`/`AfterLock` that binds a panel from a second connection
     before the definition read, or by a bind between the pre-check and `saveCore`. Assert the 409 code and that the body
     has no panel id.
   - (c) Still make `cascadeGate`'s Restore message count-only, but label it as defence in depth with no reachable path.
     Do not claim a test for it, unless the executor adds a narrowly justified seam. If a seam is added, it must be named in
     the design.
   - (d) Fix mutation 3.2 to match: dropping the pre-check should yield `PATCH_SET_STALE` with no id. That proves the
     pre-check is the message-bearing gate and the fingerprint is the backstop.
2. **D6: specify how P3 gets bound to O on a dashboard A cannot read.** B cannot do it through `PanelService.create`,
   because `rejectMissingOutput` needs the Output owner (`OutputRepository.findByIdOwned`). Name the mechanism. Either use
   the realistic path: A, holding an editor grant on B's dashboard E, creates P3 bound to O through `PanelService`, then B
   revokes A's grant. Or state explicitly that P3 is a direct superuser INSERT fixture, as `DraftSaveUndoSpec:79` does, and
   why that is acceptable. Without this, "P3 lives on a dashboard of B's" can be read two ways, and the "unreadable, counted"
   leg of AC1 depends on it.
3. **D2/D3: state the message when both refusals apply.** Today `DraftRestore.scala:39` concatenates the removed and the
   created blockers into one message. D2 and D3 each define a whole sentence, but neither says what a restore with both
   cascade-removed panels and newly bound panels on created Outputs returns. Pick one: both sentences joined, or one
   precedence. Add it to D2/D3 and to the spec.

### Non-blocking notes

- `frontend/src/features/pipelines/ui/PipelineDetailPage.draftMode.test.tsx:672-681` mocks the old id-list message. It
  stays correct, because the client shows the server text as written. Updating the fixture text is optional and outside
  the no-client-change AC.
- `describe` admits the dashboard owner and named grantees only. `DashboardRepository.findById` has no public-grant branch,
  so a panel on a public dashboard the undoer does not own is counted, not named. This is consistent with HEL-1720 and
  should be left as is.
- DraftRestore:59 reads removed Outputs from `prior.definition.outputs`, while :74 reads created ones from `prior.outputs`.
  The executor should keep those two keys as they are when restructuring.
