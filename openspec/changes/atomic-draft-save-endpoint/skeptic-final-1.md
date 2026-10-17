## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `aabdf4d18d4e34cfb18a506e5ffb00e7e8bdaf61`. Review base, resolved live by `resolve-review-base.sh`: `29cb0a60f41e72b0a6b26c15a28360c504fffdb8`.
Durable evidence prefix (EV): `/home/matt/Development/helio/.concertino/runs/HEL-1629/evidence/.concertino/scratch/HEL-1629/skeptic-final/`

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed READY. The worktree was clean at the start, and `git diff` was empty after every mutation was restored.
- **Green on the unmodified head (my run).** I ran `testOnly` on these suites:
  - DraftSave{Race,SetRace,Deadlock,Fault,Api,Rls,Undo,Run}Spec, DraftSaveSeamSpec and DraftDiffSpec;
  - V137LockPipelinesMigrationSpec and FlywayNonSuperuserMigrationSpec.
  - Result: 242/242 passed, and the only `40P01` string in the log is a test name. Evidence: `EV/green-unmutated.log.txt`.
  - Frontend `draftSave*` jest suites, 2 workers: 11/11 passed. Both seam sides compile and validate the committed `schemas/` and `shared-test-fixtures/draft-save/`.
- **AC1, atomic save with fault injection.** Read `DraftSaveTransaction.run`/`apply`: one DBIO run by `runPrivileged`. DraftSaveFaultSpec passed 9/9. The executor's M1 split-transaction red is recorded.
- **AC2, stale base gives 409 with no overwrite path.** Read the code:
  - the fingerprint is compared after `lockDefinition` (`DraftSaveTransaction.scala` `run`);
  - `staleError` reuses `PATCH_SET_STALE`;
  - the request protocol has no force or overwrite field.
- **AC3, the specs exist and pass, and the protocol is documented.** §8.3.1 is present.
  - **Mutation SK1 (mine, not recorded by the executor or the evaluator).** I weakened V137's lock strength from `FOR NO KEY UPDATE` to `FOR KEY SHARE`. This is a lock-strength change, not a `LockSite` removal, so it tests the SQL itself.
    - Result: **36 red** of 160 in Race + SetRace + Deadlock. Both orders went red for every (3)-protected writer: step PATCH/insert/insertAt/splice/attach/reorder/trunk reorder/delete, Output create, root add/remove, schedule upsert/delete, pipeline rename, upsert rewrite, source delete and the RLS source delete.
    - The three-session set race also went red. The Output-delete "not deadlock" case raised a real `40P01`.
    - Panel, dashboard and alert-rule writers stayed green. That matches the claim that only (1)/(4)/(5) protect them.
    - Restored afterwards; `git diff` empty. Evidence: `EV/SK1-key-share.diff`, `EV/SK1-key-share.log.txt`.
- **G2 order in the spec matches the code.** `specs/pipeline-definition-lock-protocol` gives: sources, panels then dashboards, advisory, pipeline row, rules, Outputs by (position, id). That is the same order as `PipelineDraftWrites.lockDefinition` with all sites active, and the same as §8.3.1.
- **RLS spec on a non-BYPASSRLS role.**
  - `TwoUserRlsApiFixture` creates `helio_app_test NOSUPERUSER NOBYPASSRLS`, and the app pool runs `SET ROLE helio_app_test`.
  - The race pools use the same role.
  - DraftSaveRlsSpec exercises an editor over a third user's panel and alert rule, and it passed.
- **V137 as the non-bypass prod migration role.**
  - V137LockPipelinesMigrationSpec runs Flyway as `helio_migration_test` (LOGIN NOSUPERUSER NOBYPASSRLS, schema owner, admin of `helio_privileged`). The shape matches prod `helio`.
  - It proves both arguments under real RLS. It passed, and so did FlywayNonSuperuserMigrationSpec.
  - The migration copies V129's proven re-own pattern (`GRANT CREATE` / `ALTER OWNER` / `REVOKE CREATE`).
- **AC4, undo.** DraftSaveUndoSpec passed 9/9. It covers: reorder restore, original-id recreation, a 409 naming each panel and alert rule (the 2026-10-16 ruling), a stale undo, and editor ownership.
- **AC5, run after save.**
  - `DraftSaveService.save` runs `runAfter` only after `saveCore`'s transaction future succeeds, and a guard result maps to `DraftRunNotStarted(429, retryAfter)`.
  - DraftSaveRunSpec asserts that the save persists after a 429, and that an editor's run counts against the owner's cap.
  - `git diff --name-only base...HEAD -- backend/src/main | grep -i run` is empty: PipelineRunService, the guard and PipelineRunRepository (HEL-505/HEL-1492) are unchanged.
- **UI.** There are no view changes: only frontend types, the service and tests. The visual design step does not apply.

### Findings

**F1. Step delete promotes the head child to a stale place after waiting behind a save, which loses the save's update (reproduced twice).**
- **Where.** `PipelineStepRepository.deleteInternal` reads `deletedRow` (parent, root, position) at :1035, before any lock. It takes (1) and then (3) at :1057, and then promotes the head child with `deletedRow.parentStepId, deletedRow.rootId, deletedRow.position` at :1065.
- **The race (save-first).**
  1. The save moves `t2` under `t4`.
  2. A concurrent `deleteInternal(t2)` reads `t2` while it is still under `t1`, then waits behind the parked save.
  3. The save commits with **200**.
  4. The delete resumes and promotes `t2`'s head child `t5` to **`t1`**, position 0.
- **Why it is wrong.**
  - The only serial order compatible with a 200 save is save-then-delete, and that puts `t5` under `t4`.
  - The result therefore matches no serial order. The save's re-parent is lost for `t2`'s subtree.
  - It breaks the spec scenario "never a lost update". It also breaks the principle the change itself documents on `lockPipelineOfStep` ("never works from a row it read before the lock").
  - The change re-derived only the *removal set* under the lock, not the promoted row's target.
- **Why the suite misses it.** The existing oracle reports `violation=false`: the writer waited, which counts as protected, and the race draft never moves the deleted step.
- **Probe.** I wrote a temporary spec, ran it twice, then deleted it; the tree is clean.
  - Result both times: `Vector("…-t1|-|0") was not equal to Vector("…-t4|-|0")`, with outcome `save=200, writer=ok, violation=false, blockedObserved=true`.
  - Evidence: `EV/SK2-SkepticProbeStaleStepDeleteSpec.scala.txt`, `EV/SK2-stale-step-delete-probe.log.txt`, `EV/SK2-stale-step-delete-probe-rerun.log.txt`.

**F2. The G2 deadlock coverage claimed in the evidence does not exist, and an ordering mutation in step delete survives.**
- **The claim.** `evidence/g1-writers.md:85` says "Root remove W30 … Deadlock spec: yes". `:87` says "Step writers … Deadlock spec: update, delete, reorder, splice".
- **The spec.** `DraftSaveDeadlockSpec` contains only step PATCH, in the mix (grep finds no `deleteInternal`, reorder, splice or root remove).
- **Mutation SK3 (mine).** I moved step delete's lock (3) **before** (1), at `PipelineStepRepository.scala:1054-1057`.
  - That order really can deadlock: the save holds (1) on the same panels `pa`/`pb` and waits for (3).
  - Race + SetRace + Deadlock + Fault + Api: **198/198 green**. No spec guards the (1)-before-(3) order of step delete.
  - Restored afterwards; `git diff` empty. Evidence: `EV/SK3-step-delete-pipeline-before-panels.diff`, `EV/SK3-step-delete-order.log.txt`.
- **How it relates to C6.** C6 accepts an order argument in place of a spec. But the written evidence claims spec coverage that does not exist. That is evidence-shaped non-evidence, and a reviewer would rely on it (the spec's own "Documented with evidence" requirement).

### Verdict: REFUTE

### Change Requests

1. **Make step delete work from post-lock state (F1).**
   - In `PipelineStepRepository.deleteInternal`, re-read the deleted step's row (`parent_step_id`, `root_id`, `position`, and its existence) **after** `locks.lockPipelines(LockSite.StepDelete, …)`. Use that row for the head-child promotion at :1065.
   - If the step is gone, take the not-found path.
   - The panel lock (1) was taken over the pre-lock removal set. If the locked removal set (`lockedRemoval.removed`) is not a subset of the pre-lock set, do not delete unlocked panels and do not lock (1) after (3). Fail the transaction (for example as a conflict or retry) instead.
   - Add a `DraftSaveRaceSpec` (or equivalent) case: a save-first race in which the draft moves the step being deleted. The case must assert that the promoted child ends at the post-save place.
   - Record the red of the new case on the current tree before the fix. My probe (`EV/SK2-SkepticProbeStaleStepDeleteSpec.scala.txt`) is a ready template.
   - Check the other step-id writers for the same pattern, any read of definition rows before (3) that feeds a write, and list each in `g1-writers.md`.
2. **Make G2 coverage match the claim (F2).** Choose one:
   - **(a)** Add step delete and root remove, plus reorder and splice if the claim stays, to `DraftSaveDeadlockSpec`. Give each a protected case and a red control with (3) taken before (1). A `LockSite` order switch is acceptable, mirroring `SavePanelsFirst`.
   - **(b)** Correct `evidence/g1-writers.md:85` and `:87`, and any §8.3.1 or design.md wording, to say "order argument only" for these writers, and record that SK3 survives.
   - Option (a) is preferred, because step delete's (1)-before-(3) order is a real deadlock edge against the save.

### Non-blocking notes

- The lock numbering is inconsistent:
  - `PipelineDefinitionLocks.scala:21-22` labels `SaveRules` "(5)" and `SaveOutputs` "(4)", and the trait doc and `g1-writers.md` use the same labels;
  - §8.3.1 and the spec number alert rules (4) and Outputs (5).
  - The order itself agrees everywhere. Only the labels differ.
- Gate defect check: none of the reports I read relies on mtime ordering. No gate defect to record.
