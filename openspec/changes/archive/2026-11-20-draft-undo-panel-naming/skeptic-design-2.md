## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 13180246ad2ab41bfed697e422ff419321d9df78 (planning artifacts only, untracked). Paths are under
`backend/src/main/scala/com/helio/` unless stated.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/draft-undo-panel-naming/hel-1792`.
- **Round-1 CR1 (unreachable cascadeGate race) is addressed.** D4 now calls the Restore branch defence in depth and claims
  no test for it. D6(d) and task 1.3 expect 409 `PATCH_SET_STALE` with no panel id. Mutation 3.2 expects the same, and
  the delta scenario "A bind that lands after the pre-check" matches. I re-checked the reasoning myself:
  - `DraftSaveTransaction.run` compares the fingerprint at the `abortIf(priorFp != req.baseFingerprint, ...)` line, and
    that happens before `impactOf`/`cascadeGate`.
  - `PatchSetPipelineDefinition.outputsJson` puts `panelIds` and `alertRules` into every Output's fingerprinted JSON.
  - `DraftSaveHooks` has `Begin` and `AfterLock` before the compare, and nothing between the compare and the gate.
  - Mutation 2 (drop the pre-check, still get `PATCH_SET_STALE`) is therefore sound. P1-P3 are bound before the undo, so
    the current fingerprint differs from the journaled post-save one.
- **Round-1 CR2 (P3 mechanism) is addressed and works.** `PanelService.create` (`services/panels/PanelService.scala:164-179`)
  admits any non-viewer access, so A as an editor on E can create a panel. A owns O, so `rejectMissingOutput` passes.
  `PermissionService.revoke` (`services/auth/PermissionService.scala:53-61`) deletes the grant row only and does not
  delete A's panels. After the revoke, `PanelRepository.findById`'s predicates (owner of dashboard, any grant row, public
  viewer grant; `PanelRepository.scala:145-185`) all fail for A on E. `describe` returns `None`, so P3 is counted.
- **Round-1 CR3 (both refusals) is addressed** by D2a and the "Removed and newly bound panels together" scenario.
- **Today's leaks are as stated.** `DraftRestore.scala:63,65,83,84` build `panel <id> (Output <id>)` and
  `alert rule <id> "<name>"`. `DraftSaveTransaction.cascadeGate`'s Restore branch builds `panel <id>`.
- **D1 reuse is feasible.** `PatchSetUndoBoundPanels` is `private[services]`. `describe` (:86-91) only needs
  `ctx.panelRepo` and `ctx.dashboardRepo`, so extracting the naming part of `blocker` (:66-83) into a repo-taking helper
  leaves `blocker`'s text unchanged.
- **D5 logs.** `PatchSetUndoService`'s only `log.error` (:104) is in the restore walk. The draft dispatch (:77-78) skips
  it. The only logger in the draft package is `DraftSaveService.scala:180` (runAfterSave). Nothing logs the refusal.
- **Existing assertions that must change** are listed (task 3.1): `DraftSaveUndoSpec.scala:83` (`include("late-panel")`)
  and :115 (cascade-removed ids). The late panel is on A's `d1` with title `late`, so it becomes a named entry.
- **Alert-rule wiring: a defect** (CR1 below).
  - D2 names `AlertRuleRepository.findByIdOwned`, and task 2.5 says DraftRestore "gains the repos it needs".
  - `ApiRoutes`'s `alertRuleRepo` parameter defaults to `null` (`api/ApiRoutes.scala:152`).
  - `TwoUserRlsApiFixture.scala:155-171`, the base of `DraftSaveApiFixture` and so of `DraftSaveUndoSpec`, does not pass it.
  - 27 of the 34 `new ApiRoutes(` call sites in `backend/src/test` never mention `alertRuleRepo`.
  - Wiring `alertRuleRepo` into `new DraftRestore(...)` at `ApiRoutes.scala:668` would therefore hand DraftRestore a null
    in those fixtures. The D2 alert-rule branch would then throw an NPE, which surfaces as a 500 instead of a 409.
  - A non-null, batched helper already exists for exactly this purpose: `OutputRepository.findVisibleAlertRuleIds(ids, user)`
    (`OutputRepository.scala:200-209`, HEL-1522, "name a rule only if the caller could list it", same `owner_id`
    predicate). `outputRepo` is already a DraftRestore constructor argument.
- **The alert-rule rule has no test** (CR2 below).
  - The delta requirement says "A targeting alert rule SHALL be named only when the undoing user owns it, else counted".
  - D6 and tasks 1.1-1.4 test only panels.
  - Reachability: `AlertRuleService.create` validates `targetOutputId` with `OutputRepository.findByIdOwned` (Output-owner
    only, `services/alerts/AlertRuleService.scala:57`). So a rule on O belongs to O's owner, and the counted branch arises
    when the undoer is not that owner (for example a pipeline editor grantee who saved and undoes).
- **Scope:** the five restated ACs map to D2/D3/D4/D6 and the task list. No client change is planned.

### Verdict: REFUTE

### Change Requests

1. **D2 / task 2.2 / task 2.5: drop `AlertRuleRepository.findByIdOwned` for the alert-rule naming check.**
   - Use `outputRepo.findVisibleAlertRuleIds(ruleIds, user)`. It is already on DraftRestore's `outputRepo`, it is batched,
     it is never null, and it was written for this "name only if the caller can read it" purpose.
   - Or, if a different repo is kept, the design must say how DraftRestore gets a non-null one in every `ApiRoutes`
     construction. `alertRuleRepo` is nullable and is null in `TwoUserRlsApiFixture`.
   - Either way, task 2.5 must state exactly which constructor arguments are added (expected: `dashboardRepo` only).
2. **Add a test task (and a delta scenario) for the alert-rule half of the created-Outputs refusal**, since the delta
   requirement now binds it.
   - Named case: an alert rule the undoing user owns targets a created Output. The 409 names it by `"<name>"` and carries
     no rule id.
   - Counted case: the undoer is not the rule's owner, for example a pipeline editor grantee who saved the draft and then
     undoes while the pipeline owner's rule targets the created Output. The 409 counts the rule and carries neither its
     id nor its name.
   - If the counted case proves unreachable through services in the harness, state that and use a labelled direct-insert
     fixture.
   - Include a red-first mutation, for example "name every rule regardless of owner" must fail the counted leg.

### Non-blocking notes

- D2: say what the panel part reads when zero panels block and only alert rules do. Omit the panel clause, as D3 does
  ("omit a zero part"), rather than print "0 panel(s) were bound...".
- D6(d)/task 1.3 offer "`Begin` or `AfterLock`". An `AfterLock` hook at the outputs lock site that waits on a
  second-connection panel insert would deadlock, because the insert's FK check needs `FOR KEY SHARE` on the
  `FOR UPDATE`-locked Output row. Prefer `Begin`, or an `AfterLock` site strictly before the outputs lock, and have the
  hook wait for the second connection's commit.
- D2: say where alert-rule parts sit in the sentence relative to `describeBlocking`'s panel parts, so the two cannot be
  read two ways.
- `frontend/.../PipelineDetailPage.draftMode.test.tsx` still mocks the old id-list text. That is harmless (the client shows
  server text verbatim) and outside the no-client-change AC.
