## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `f0d21c75b52b982283b19482297fac1232260a8e` against the live-resolved base `737adb3525afa48d2f75576f948221910b732f8d`
(`resolve-review-base.sh`, exit 0). Backend-only change; no UI, so step 4 (design judgment) does not apply and no servers were started.
Scratch outputs: `/home/matt/Development/helio/.concertino/scratch/HEL-1707/skeptic-final/`.

### What I verified (with evidence)

**Production diff, read in full** (11 main files). Findings:
- `PipelineWriteAccess.currentAction` uses the same predicate as `PipelineRunRepository.submitterMayRunAction`,
  `PipelineRepository.findGrantRole` and the services' `editable`/`requireEditor` checks: owner, or a `resource_permissions` row
  with `resource_type='pipeline'` and `role='editor'`. So a write that passes today's service check also passes the re-check
  when nothing races. No non-race outcome changes for the ruled set.
- The re-check sits right after `lockPipelines` (lock (3)) at every ruled site: root add (`PipelineRootRepository.scala`, after the
  new `locked` Boolean check), root remove (`removeRootCascadeAction`), draft save (`DraftSaveTransaction.run`, after
  `abortIf(!locked)`), attachTail, spliceInsertReporting (duplicate delegates to it), update (`lockPipelineOfStepRechecked`),
  delete (inside each `deleteAttemptAction`), and reorderTrunk. `insertInternal`/`insertAtInternal`/`reorderInternal` are untouched,
  as D2 says. C1 holds: a plain read, no `FOR SHARE`.
- D3: `actor` is a required parameter with no default at every re-checked writer. Grepping production call sites
  (`grep -rnE "\.(updateInternal|deleteInternal|spliceInsert...|deleteIfUnboundInternal)\("`) finds exactly the sites in
  `files-modified.md`, and each passes the acting `user`, never `pipelineOwnerId`.
- The refusal mapping matches the D2 table. `PipelineWriteRefusal.toError` gives `Forbidden("Forbidden")`, which equals both
  `ServiceError.Forbidden()`'s default (the draft-save `editable` pre-check) and `PipelineStepWriteChecks.scala:190`. Each typed
  `.recover` comes before `classifyDbError`. `deleteStep` and `OutputService.delete` recover only the typed refusal.
- C3: `.result.headOption` plus a `false` lock Boolean both raise `PipelineGone`, which `PipelineRootWrites.attachRoot` maps to
  `NotFound("Pipeline not found: <id>")`.
- C2/R2: `OutputService.delete` keeps the creator check and adds the in-transaction owner-or-editor re-check. So does
  `deleteIfUnboundInternal` (patch-set undo). Refusal is `404 Output not found` / `NotFound`. PATCH is untouched.

**Red on main, independently reproduced.** I ran a throwaway detached worktree at 737adb352 with only the 4 new or extended spec
files copied in (`main-red.txt`; exit 1, `succeeded 11, failed 24`). Every red test was red for the stated reason:
- 1a: `NoSuchElementException ... select "name" from "pipelines"`.
- 1b: FK `pipeline_roots_pipeline_id_fkey`.
- All 20 grant-race cases: the write landed (`Right(...)`). Reorder now sends the valid permutation and lands, so the cycle-2 fix
  holds.
- Output downgrade delete: `200 OK`. Undo: `Vector("restored")`.

Guards 3.1/3.2 and the item-4 grant guards were green on main, as expected.

**Mutations, independently re-run.** In a throwaway worktree at HEAD (`mutation-combined.txt`) I combined four mutations:
- M3: drop the root-remove re-check.
- M7: drop the update re-check.
- M9: drop the delete re-check.
- M10: both Output-delete re-checks become `DBIO.successful(())`.

Result: exit 1, `succeeded 20, failed 8`. The 8 failures were exactly the expected cases (root remove x2, PATCH step x2, DELETE
step x2, Output downgrade delete, Output undo). The executor's other recorded mutation outputs (`evidence/mutation-m*.txt`) are
consistent with the code. That includes the D4 dual-detector pair: m1b with the Boolean check alone removed stays green; with
the Boolean check removed and `PipelineGone` mapped to `Owner`, it goes red. The throwaway worktree was removed
(`git worktree list` shows 0 entries).

**Full spec files pass at HEAD, fresh runs:**
- `head-new-specs.txt`: the 4 new or extended specs. Exit 0, `succeeded 35, failed 0`.
- `head-shard1.txt`: OutputHistoryPublicRoutes, PublicProvenanceRoutes, DraftSaveDeadlock, DraftSaveRace, DraftSaveRootsRace,
  OutputRoutes, AlertRuleRepository, OutputDeleteRacesPanelCreate, PipelineCascadeLockOrderRace, PipelineRootRemoveAtomicity
  and DraftSaveRls. Exit 0, `succeeded 340, failed 0`.
- `head-shard2.txt`: PipelineStepRepositorySplice, V94OutputsMigration, PatchSetUndoLane, PatchSetUndoLaterAlertRules,
  PatchSetUndoPanelDashboard, PipelineCycleDetectionService, PipelineRunService, PipelineServiceCoverageGaps, PipelineRootRoutes
  and PipelineStepRoutes. Exit 0, `succeeded 315, failed 0`.

**AC trace:**
- (1) Met. The 404 for both 1a and 1b is reproduced deterministically through the `RaceLocks` hook. It is red first, and the
  mutations m1a/m1b are recorded and consistent.
- (2) Met for the ruled set. Enumeration: `.concertino/runs/HEL-1707/evidence/editor-privileged-write-enumeration.md`.
  Escalated scope was ruled Q1=A. The re-check is red first with per-site mutations.
- (3) Met. `PipelineRootEditorGuardsRlsSpec` is labelled GUARD. M11 and M13 fail it. M12 alone stays green and is recorded as such.
- (4) Met. `PipelineRootWriteGrantsSpec` carries the GUARD tests, and they are failable via M14 by changing the assertion target.
  The harness reason is stated.
- No migration was added.

### Verdict: REFUTE

### Change Requests

1. **`OutputDeleteCurrentAccessRlsSpec.scala:34` ("refuse (404, nothing deleted) a creator whose grant was fully revoked") is a
   de facto guard dressed as R2 proof.** It is GREEN on unmodified main 737adb352 (`main-red.txt`: no `*** FAILED ***` on that
   line). It also stays GREEN with both R2 re-checks mutated out (`mutation-combined.txt`, and the executor's own m10:
   `succeeded 4`).

   The real cause of its 404 is the existing `outputRepo.findById(id, user)`. That is a `withUserContext` (RLS) read, so a
   no-grant user cannot see the Output and gets `None` and then 404 before the R2 code runs (`OutputService.scala:296-297`).
   Its name and placement, next to the red downgrade case and outside the `GUARD:` block, say it proves the new R2 check. It
   does not. The evaluator flagged this in `evaluation-2.md:37`, and it is unchanged at HEAD.

   Fix (test and evidence only, no production change):
   - (a) Prefix it `GUARD:` and move it into the guard block with a comment. The comment should say it was already 404 on main
     via the RLS-scoped `findById`, and that the in-transaction R2 re-check is a second detector.
   - (b) Record a failing mutation for it, like the D4 and 3.2 combined mutations: replace the RLS `findById` in
     `OutputService.delete` with an unscoped read AND neutralise the R2 re-check. Show red. Also record that either mutation
     alone stays green.
   - (c) In `files-modified.md` and the PR body, state that the revoked-creator case was already 404 before this change. Only
     the downgraded-to-viewer case is the visible R2 behaviour change.

### Non-blocking notes
- `red-run.txt` was committed alone in 252d1b525; the spec files first appear in fb3c2a6df together with the implementation.
  That is what task 1.4 asked for. Red-first provenance therefore rests on the recorded output plus re-runs. My own reproduction
  above confirms it independently.
- No race test exists for Output delete or undo, only the non-race downgrade. D5 says one site covers both, and the downgrade
  test plus M10 exercise that site, so this is acceptable.
- Race-only outcome changes must go in the PR body, as planned: reorder and step create on a pipeline deleted mid-request now
  answer 404, where before they gave 422 or a database error.
