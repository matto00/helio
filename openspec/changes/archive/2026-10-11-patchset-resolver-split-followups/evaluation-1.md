## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `53a291a162abc61bce3f607ff6ec2b43f3ca86f4` (base `dae4bc4516791452ad5b3e27e871d39771bbd5a6`, resolved live via `resolve-review-base.sh`).
Evaluator scratch runs and logs: `/home/matt/Development/helio/.concertino/runs/HEL-1482/evidence/eval1/` (not committed; `emut.py` applies one exact replace, runs `nice -n 19 sbt -batch -J-Xmx3g testOnly ...`, and always reverts).

### Phase 1: Spec Review — PASS
Issues: none.

- Items 1-3: every ticket-listed citation was repointed. I checked each new target by grep: `PatchSetPipelineResolvers.pipelineSummaryResponse` (private there, so the "private to that object" wording still holds), `PatchSetPipelineStepResolvers.buildPipelineStepDeletePriorState`, `.resolvePipelineStepUpdate`, `.validateEmbeddedStepReferences` and `.resolvePipelineStepCreate` (the only place `target.parentId is required` is enforced). `PipelineRootWrites.resolveOneRootSourceId` holds the `(Some(_), Some(_))` "not both" arm. `resolveInlineOrExistingRoot` and `resolveRootDataSources` are not defined anywhere under `backend/src/main`. `citation-sweep.md` records every hit with a verdict. It also fences the test-name strings, annotates the provenance block in place, and lists two out-of-scope `resolveRootDataSources` mentions in `services/pipelines/` for follow-up.
- Item 4: exactly the four output rows' `sites` changed. The panel and step rows, `patchSetDispatchPairs` and `expectedForbiddenProducers` are untouched (C3 holds).
- Items 5-7: three new specs. They cover `requireTargetId` (absent id and blank id, with non-zero indices), `decodeCreatePatch` (missing patch and wrong shape), the editor/viewer/owner branches of `authorizeEditorOrOwnerOnPipeline` (apply update/delete/create plus preview update), and the dashboard branches the D3 audit found surviving (`PatchSetDashboardGrantSpec`).
- Items 8-9 decisions are recorded (design D6, tasks.md, verification.md).
- No escalation is needed. On unmutated code all 9 pipeline-grant tests pass, so the patch-set gate matches the REST rule (owner or editor allowed, viewer gets 403).
- All non-retired CONSTRAINTS C1-C7 are honoured in the diff (see Phase 2).

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran myself (backend only; no `frontend/**` changes):
- Targeted `testOnly` of the four touched or new specs (`base.log`): `[hel1468-guard] ScalaTest summary: failed=0`, Suites 4, **Tests 85 succeeded** (9 + 9 + 6 + 61), 0 failed.
- `npm run check:scala-quality`: `clean (231 soft warning(s))`, all pre-existing. No inline FQNs in the three new specs (the grep for qualified names outside import/package lines found nothing).
- I did not run a full `testFull`, because two other worktrees' `testFull` runs were in progress and the driver caps the machine at two. I relied on the executor's `final-testfull.log` (`[hel1468-guard] failed=0`, 6690 succeeded, `testfull-exit=0`). The only main-code delta is comments, which I verified.
- Comment-only check, my own run: `git diff -U0 base...HEAD -- backend/src/main` with lines whose first token is `//`, `*` or `/*` filtered out gives **0 lines**. C1 holds.
- C6: both DB-backed new specs call `VerifiedEmbeddedPostgres.start(...)`. `PatchSetResolverMessagesSpec` uses no database.

My own mutation re-runs (each reverted; `git status --short` was clean afterwards and no sbt process was left running):

| Mut | Change | Result |
|---|---|---|
| M7a | `case Some("editor") => Right(())` -> `case Some(_) => Right(())` | RED 4/9: exactly the four viewer tests, e.g. `Right(PatchSetApplyResponse(Vector(), Some("Forbidden"), None)) was not equal to Left(Forbidden("Forbidden"))`. This confirms the design note: a weakened gate ends as a 200 with `failure`, and only the exact `Left(Forbidden)` assertion catches it. The viewer assertions are exact `shouldBe Left(ServiceError.Forbidden())`, not a weak Left. |
| M7b | `... => Left(ServiceError.Forbidden())` | RED 4/9: exactly the four editor tests (update, delete, create, preview update). |
| M4 | `findOwnedOutput`: `if output.ownerId != user.id` -> `if false` | RED 4/61: exactly the four `patch-set apply/preview: output update/delete` rows, failing on foreign-vs-absent (`foreign=200 ... nonexistent=404`). The completeness guard and the other 56 rows stay green. |
| M6a | `patch is required for a create edit` -> `patch is required` | RED 1/6: `reject a create edit with no patch`. |

All of these match what `mutation-evidence.md` claims.

D3 audit table: the executor's scripts (`audit.sh`, `confirm.sh`, `mutl.py`) apply line-scoped, meaningful mutations. I read the survivor sites (`PanelService` batch update, `PipelineRunService.submit`, `OutputService` create): each mutation really does flip the viewer/editor arm. The `F-*` full-run logs for the claimed survivors (F-D5-V, F-D8-V, F-P1-V, F-P7-V, F-D10-V) each show `[hel1468-guard] failed=0` and 6690 succeeded. The survived and killed classifications are therefore honest, and the 8 out-of-scope survivors are listed for the orchestrator's follow-up ticket as D3 requires.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `PatchSetPipelineResolvers.scala` (the HEL-913 task 7.6 comment) now credits `PipelineRootWrites.resolveOneRootSourceId` with "unresolvable id: 404". That function only does the blank-id 400 and the either/both checks: an existing `sourceId` passes through as `Right(DataSourceId(sid))` without an ownership lookup, so the 404 happens downstream. Consider qualifying this in a later comment touch.
- `PatchSetPipelineStepGrantSpec.stepLimit` uses `.asInstanceOf[LimitConfig]`. A `case l: LimitConfig => l.count; case other => fail(...)` match would give a readable failure instead of a ClassCastException.
- The editor-preview tests assert `isRight shouldBe true`. They are killed by M7b, so this is adequate, but asserting the edit preview's status would be stronger.
- Orchestrator follow-up: the 8 survivors outside `services/patchsets/` (mutation-evidence.md, "Survivors outside") and the two out-of-scope `resolveRootDataSources` mentions in `PipelineCreateTransaction.scala` / `PipelineRootWrites.scala`.
