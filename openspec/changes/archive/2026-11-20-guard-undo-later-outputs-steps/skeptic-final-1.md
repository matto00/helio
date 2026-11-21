## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `c55321907e6729e1c962e3d3951bcc4648a7ea80` against the live base `763c69f6f77be04a57e6e5d208262f86c3fb86e0` (from `resolve-review-base.sh`, exit 0).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/undo-pipeline-create-outputs/HEL-1795`.
- **Diff read in full** (`git diff 763c69f6f...HEAD -- backend/`). The change touches these files:
  - `PatchSetApplicationRepository.scala`: adds `JournaledCreatedChildren` and an optional `createdChildren` field. The format moves to `jsonFormat9`, and the new format is declared before `journaledEditFormat`.
  - `PatchSetApplyService.scala`: `captureCreatedChildren` runs only for a `PipelineCreate` edit. It reads children through internal reads into an index-keyed accumulator. `EditOutcome` and the `/apply` response do not change.
  - `PatchSetUndoBoundPanels.scala`: `doomedRows` is now shared by the panel check and the new check, so the two cannot drift (design D1). `nameList` is pulled out of `describeBlocking`.
  - New `PatchSetUndoLaterChildren.scala`: computes the excused set (same-set `newId`s plus `createdChildren`), with the legacy fallback for `pipeline` only. It names readable Outputs through the sharing-aware `findById`, describes steps by op and position, and counts the rest without ids.
  - `PatchSetUndoConflictCheck.scala`: the blocker strings are joined with the panel blocker and the arm's own check using `; `.
  - `PatchSetUndoService.scala`: only `appliedAt` threading and the extended `ifStillUnbound` Phase-2 re-check. This is minimal, as HEL-1797 requires.
- **AC1 (red first on `helio_app_test`):** the red commit `57a150c25` touches only the new spec and openspec files, with no main source (`git show --stat`). So that spec ran against unchanged main code.
  - `red-run.txt` records the failure: `expected a Conflict, got Right(PatchSetUndoResponse(Vector(EditUndoOutcome(0,restored,...))))`.
  - The spec asserts `rolbypassrls = false`. B creates the Output through the real `OutputService.create` after an editor grant. A undoes through the real `PatchSetUndoService.undo`.
  - The evaluator's own re-run at `57a150c25` (evaluation-1.md) agrees.
- **AC2 (409, nothing changed, HEL-1720 naming):**
  - The service-level tests assert a `Conflict` that names `B's output`, that B's Output survives and that the pipeline survives.
  - In `PatchSetUndoRoutesSpec`, the REST route returns `409` with the Output name and not `PATCH_SET_STALE`, and the pipeline is intact.
  - The message tests assert that no Output, step or pipeline id appears.
  - The unreadable branch is counted (`and N Output(s) you cannot see`) through the shared `nameList`, with the same `NameCap`.
- **AC3 (same-user later additions):** these tests check that a same-user later Output and a later step are refused, while an inline-only create still undoes cleanly (the `createdChildren` excusal). The `PatchSetUndoLaneSpec` reversal of HEL-914 5.6's second half is deliberate and matches this AC: an Output added after the apply now blocks even once its panel is gone.
- **Steps (the ticket's "check them"):** the change covers editor- and same-user-added steps on a created pipeline, and descendant steps and later Outputs on a `pipelineStep` create.
- **Phase-2 re-check:** it is tested by holding a row lock and inserting an Output mid-undo. The ERROR log carries a fixed phrase and a count, with no name or id.
- **Gates re-run by me:**
  - `sbt -J-Xmx3g testOnly PatchSetUndoLaterOutputsSpec PatchSetUndoLaneSpec PatchSetUndoRoutesSpec`: 21 succeeded, 0 failed, and the hel1468 guard reported `failed=0 aborted=0`. The test names and log lines show the tests actually ran.
  - `testOnly com.helio.services.patchsets.* com.helio.api.routes.patchsets.* com.helio.infrastructure.persistence.patchsets.*`: 56 suites, 547 tests succeeded, 0 failed, and the guard reported `failed=0 aborted=0`.
  - `npm run check:scala-quality` is clean (soft warnings only, none new and blocking). `npm run check:openspec` is clean.
- **Mutations:** `mutations.md` records M1–M3, each turning a named test red, and the evaluator independently ran two. I accept them as pasted and specific.
- **False-positive check:** I checked whether ordinary editing of a created pipeline would now wrongly block undo. Draft save keeps step ids for steps it keeps (`DraftDiff.scala` doc: "the server never deletes a step the draft keeps"). So editing a created pipeline does not re-mint steps and does not trip the new guard spuriously.
- **Surfaces:** `helio-mcp/src/tools/refinement.ts:131` still says "the whole undo is refused", which stays true. There is no frontend, schema or route change, so step 4 (UI judgment) does not apply.

### Verdict: CONFIRM

### Non-blocking notes
- On the `pipelineStep` arm, a step inserted mid-chain could in theory have a descendant that existed before the apply in its removal set. Undo would now refuse with "were added after the patch set was applied", which is the wrong wording but the safe direction. Before this change, such a descendant was deleted silently.
- The design names an alert-rule follow-up (alert rules cascade with an excused Output) that must be filed at delivery and stated in the PR body. Later-added schedules and roots are PR-note candidates.
- `Thread.sleep(1500)` in the Phase-2 re-check test may be timing-sensitive on a loaded CI runner (also noted by the evaluator).
