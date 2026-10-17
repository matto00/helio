## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: `00e441a6a5de55df21cb225e5780201005333638`. Review base, resolved live by `resolve-review-base.sh`: `29cb0a60f41e72b0a6b26c15a28360c504fffdb8`.
Durable evidence prefix (EV): `/home/matt/Development/helio/.concertino/runs/HEL-1629/evidence/.concertino/scratch/HEL-1629/skeptic-final-2/`

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/atomic-draft-save-endpoint/HEL-1629`. The worktree was clean at the start, and `git status --short` was empty after each of my mutations was restored.
- **Green on the unmodified head (my run, `nice -n 19`, `-Xmx3g`).** I ran `testOnly` on 12 suites:
  - DraftSave{Race,SetRace,Deadlock,Fault,Api,Rls,Undo,Run}Spec and DraftSaveSeamSpec;
  - DraftDiffSpec, V137LockPipelinesMigrationSpec and PatchSetPipelineDefinitionParitySpec.
  - Result: **252/252 passed, exit 0**. The new cycle-3 cases ran: "step delete of a step the save moved", "step delete whose removal set the save grew", "a step delete against the save" and "a root remove against the save". The only `40P01` hit in the log is a test name. Evidence: `EV/green.log`.
  - Frontend, schemas, fixtures and migrations are byte-identical to round 1 (`git diff --name-only aabdf4d18 HEAD -- frontend schemas shared-test-fixtures backend/src/main/resources` prints 0 lines). Round 1's jest seam run (11/11) therefore still applies.

#### F1 (step-delete lost update): fixed, not reworded
- **The fix, read in `PipelineStepRepository.deleteInternal` / `deleteAttemptAction` (HEAD).** The deleted row is re-read after lock (3) (`lockedRow`), and so are its existence and the removal set.
  - The head-child promotion now uses the locked `deletedRow`'s parent, root and position.
  - A vanished step takes the not-found path.
  - The panel lock (1) is still taken once and first, over the pre-lock set.
  - If the locked removal set is not a subset of that set, the attempt writes nothing and returns `None`. `deleteInternal` then retries in a fresh transaction, at most `MaxDeleteAttempts = 3` times, and after that fails with `IllegalStateException`. Routes map that through `classifyDbError` to a 500.
- **My reasoning on interleavings.**
  - Save moves the step: promotion goes to the post-save place.
  - Save deletes the step: `lockedRow = None`, so not-found.
  - Save swaps the head and tail children, or attaches a new tail: the subset check fails and the delete retries.
  - Save re-binds an Output's node: not possible, because the node is not draft-editable (`updateOutputs` writes only name and config).
- **Spec cases.** The new `DraftSaveRaceSpec` cases use a `serialCheck` oracle: if the save committed and the writer succeeded, the stored state must equal the save-then-writer outcome. I read it in `DraftRaceFixture.notSerial`, and it is wired into `violation`.
- **Recorded reds.**
  - Pre-fix: `violation=true`, the case F1 described (`evidence/cycle3/F1-step-delete-red-before-fix.log.txt`).
  - M5 (promote to the pre-lock place): red.
  - M6 (no retry): red, with the IllegalStateException, which proves the retry path really runs.
- **The serial-order oracle really checks.** It names t4, the post-save parent, as the only correct parent. That is the outcome my round-1 probe showed was violated.

#### F2 (missing deadlock coverage): fixed
- `DraftSaveDeadlockSpec` now has "a step delete against the save" and "a root remove against the save". Each has a protected case (expects no deadlock) and a control (`StepDeletePanelsFirst` / `RootRemovePanelsFirst` inactive, which takes (3) before (1) and expects a deadlock).
- Both writers carry the production order (1) then (3) by default, which I read in the code.
- M7 inverts the default (`evidence/cycle3/M7-*.diff`) and turns all 4 cases red, including both protected cases. That is my SK3 from round 1, now caught.
- `g1-writers.md` Table B now says "Order argument only, no deadlock spec" for update/insert/insert-at/splice/attach/reorder. That is honest: those writers take only (3) and then write step rows, with no (1)/(3) edge.
- The lock labels (rules (4), Outputs (5)) are now consistent in code, docs and the writer table.

#### My own mutations (not in red-green-log.md, evaluation-1/2.md or skeptic-final-1.md)
- **SK5: weaken the save's alert-rule lock (4) from `FOR UPDATE OF r` to `FOR KEY SHARE OF r`** in `PipelineDraftWrites.lockRules`. This changes the SQL itself, not a `LockSite` switch.
  - Result: **4 red** of 163 in Race + Deadlock:
    - "alert rule update", writer-first: `violation=true` (the writer held open, the save went to 200);
    - "alert rule update", save-first: `violation=true` (the writer committed while the save was parked);
    - the alert-evaluator deadlock "not deadlock" case: `violation=true`;
    - its control: no longer deadlocks.
  - Restored afterwards; git clean. Evidence: `EV/SK5-rules-key-share.diff`, `EV/SK5.log`.
- **SK4: drop the subset check, so the delete never retries and goes ahead on the pre-lock panel locks** (`if (false && …)` in `deleteAttemptAction`).
  - Result: **survives**, 197/197 green in Race + Deadlock + Api + SetRace. I confirmed the mutated source was recompiled.
  - Restored afterwards; git clean. Evidence: `EV/SK4-no-subset-check.diff`, `EV/SK4.log`. See the first non-blocking note.

#### Remaining acceptance criteria
- **AC1, atomic whole-draft save with fault injection.**
  - `DraftSaveTransaction.run`/`apply` is one DBIO run by one `runPrivileged`.
  - `DraftSaveFaultSpec` injects a fault at 7 hook points (AfterCompare … BeforeCommit). Each asserts that the stored state, the fingerprint, the journal count and the audit count are all unchanged.
  - A no-fault control proves the same draft does commit.
  - The whole draft covers create, update, delete, reorder and Output edits (`DraftSaveApiSpec` "a whole draft"). Green in my run.
- **AC2, stale base gives 409 and writes nothing, with no overwrite path.**
  - The fingerprint is compared after `lockDefinition` and returns `PATCH_SET_STALE`.
  - A plan that changes under the locks (advisory or checked keys) is also refused as stale.
  - `DraftSaveRequest` has no force field, and `DraftSaveApiSpec` "have no force path" pins that. Green.
- **AC3, the specs exist and pass, and the protocol is documented.**
  - The race, set-race, deadlock and RLS specs are all green.
  - The RLS spec uses `TwoUserRlsApiFixture` (`helio_app_test NOSUPERUSER NOBYPASSRLS`, verified in round 1, and the fixture is unchanged since).
  - §8.3.1 documents the protocol, including the cycle-3 F1/F2 paragraphs, which match the code I read.
- **AC4, undo.**
  - `DraftRestore` re-applies the journaled prior definition through `saveCore(Restore)`, with the post-save fingerprint as the base. That makes it atomic and stale-aware.
  - Original ids are accepted only in `Restore` mode.
  - A panel or alert rule removed by the cascade, or bound to an Output the save created, is refused with a 409 naming each one. This is checked before the transaction and again under the locks (`cascadeGate`).
  - `DraftSaveUndoSpec` covers reorder restore, original-id recreation, the 409 naming each panel and alert rule, the stale undo, and editor ownership. All green.
- **AC5, guard-rejected run after a committed save.**
  - `runAfter` runs only after `saveCore` succeeds, and a `TooManyRequests` becomes `DraftRunNotStarted(429, retryAfter, reason)`.
  - `DraftSaveRunSpec` asserts `started:false`, `code 429` and `retryAfterSeconds > 0`, and that the save persisted. It covers both a rate-limit rejection and an editor's run counted against the owner's concurrency cap (HEL-1492). Green.
  - `git diff --name-only base...HEAD -- backend/src/main | grep -iE "run|guard|ratelimit"` prints only `PipelineCycleGuard.scala`. That file's change only makes `lockAction` public. PipelineRunService, PipelineRunRepository and the HEL-505 guard are unchanged.
- **UI.** No view changes, only frontend types, the service and tests, so the visual design step does not apply.

### Verdict: CONFIRM

### Non-blocking notes
- **SK4 survives: no spec shows the subset-check-and-retry is needed for G2.**
  - The check exists so that a delete never cascades a panel it did not lock in (1). The case is a save that re-parents a step whose Output has a bound panel under the step being deleted.
  - If the check is missing, that panel and its dashboard are locked late, after the Output row. That is the HEL-1534 deadlock class against a concurrent panel create.
  - The current grown-subtree case attaches a step with no Output, so serial order holds with or without the check. M6 proves the retry runs, not why it is needed.
  - The code is correct as I read it, and the gap is a rare three-party interleaving, so this does not block. Recommended follow-up: a race or deadlock case where the save moves a step that has a bound panel under the deleted step, which should be red under SK4.
- **Root remove still picks its panels in (1) before (3).** A save that moves a step with a bound panel under the root between those two locks leads to a late panel lock in the same class. Table D records this as the accepted HEL-1485/1534 residual; noted here for the spinoff list.
- **No fresh evaluator report for this commit.** The latest evaluator report (evaluation-2) reviewed `8547a856f`, and nothing covers `00e441a6a`. The executor's `cycle3/testfull-summary.txt` says 9191/0 failed, but that is executor-asserted and I did not re-run the full suite. My targeted 252/252 run covers every suite this commit touched.
- **Gate defect check:** none of the reports I read relies on mtime ordering. No gate defect to record.
