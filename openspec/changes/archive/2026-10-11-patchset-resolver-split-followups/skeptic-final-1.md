## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `53a291a162abc61bce3f607ff6ec2b43f3ca86f4`. Base resolved live via `resolve-review-base.sh` (main/origin): `dae4bc4516791452ad5b3e27e871d39771bbd5a6`. One commit on the branch.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/patchset-resolver-split-followups/HEL-1482`.
- **Main code is comment-only.** I filtered `git diff dae4bc451...HEAD -- backend/src/main` to `+`/`-` lines whose first token is not `//`, `*`, `/**` or `*/`. Zero lines remain. All 7 main files carry comment text only.
- **Item 7 (priority): the grant tests can fail.** I wrote my own runner (`/home/matt/Development/helio/.concertino/runs/HEL-1482/evidence/skeptic1/run.sh`, logs and `summary.log` in the same dir). It applies a single mutation, runs `nice -n 19 sbt -batch -J-Xmx3g testOnly ...`, and restores the file with `git checkout` in a trap. Every log shows `[hel1468-guard]`. After the run, `git status` showed only the untracked `evaluation-1.md`, and no JVM was left with this worktree as its cwd.
  - Unmutated (`PatchSetPipelineStepGrantSpec`, `PatchSetDashboardGrantSpec`, `PatchSetResolverMessagesSpec`, `ExistenceNotLeakedRoutesSpec`): 85/85 green, exit 0.
  - M7a, `case Some("editor") => Right(())` changed to `case Some(_) => Right(())` (any grant passes): RED, 4 failed. These are the four viewer tests: update, delete, create, preview-update. The failure text is `Right(PatchSetApplyResponse(Vector(), Some("Forbidden"), None)) was not equal to Left(Forbidden("Forbidden"))`. This confirms the design point: with a weakened gate the forward-apply re-check still refuses, and it reports that refusal as an HTTP-200 `Right` failure. Only the exact `Left(ServiceError.Forbidden())` assertion catches the change.
  - M7d (my own extra mutation, not in the executor's set): the fall-through `case _ => Left(ServiceError.Forbidden())` changed to `Right(())`. RED, the same 4 viewer tests fail.
  - I read the code. Viewer cases assert exactly `Left(ServiceError.Forbidden())` for apply (update/delete/create) and for preview. Editor cases assert a mutation actually happened (limit 5 -> 10, step removed, new step present). The owner case runs with no grant. Update and delete go through `requireVisibleStep` -> `authorizeEditorOrOwnerOnPipeline`. Create goes through `resolvePipelineStepCreate` -> `authorizeEditorOrOwnerOnPipeline`. So all three ops exercise the guarded branch.
  - `PatchSetDashboardGrantSpec` is built the same way for `resolveDashboardUpdate` and `authorizeEditorOnDashboard`. I accepted the executor's R-D1/R-D2 mutation table without re-running it. The spec is green in my unmutated run.
- **Item 4:** the four output rows now name `PatchSetOutputResolvers.scala`, and no other line in the file changed. I ran M4: `if output.ownerId != user.id` changed to `if false` in `PatchSetOutputResolvers.findOwnedOutput`. RED, exactly 4 of 61 failed (the 4 output apply/preview rows). The other 57, including the completeness guard, stayed green. Unmutated it is green.
- **Items 5-6:** `PatchSetResolverMessagesSpec` asserts the full `BadRequest` text of `requireTargetId` (absent id and blank id, index 1 and index 2, op interpolated). It asserts `decodeCreatePatch`'s missing-patch text exactly, and the undecodable-patch text by prefix plus status. These literals match the source in `PatchSetApplyResolvers.scala` (`PatchSetResolverSupport`). Green in my run. I accepted the executor's M5/M6a/M6b red runs as recorded and did not re-run them.
- **Editor-grant audit (AC: "any other editor-grant path found with the same gap"):** the patch-set paths the audit found (dashboard update, panel gates) now have tests. The 8 survivors outside `services/patchsets/` go to a follow-up, as design D3 agreed at the design gate. The record lists them in `mutation-evidence.md` with code-reading dispositions, and none is reported as a real authorization defect. **The orchestrator must actually file that follow-up ticket.**
- **Items 8-9:** explicit decisions are recorded (design.md D6, verification.md).
- **Citations:** I grepped every new citation target and each one exists. `PatchSetPipelineResolvers.pipelineSummaryResponse` is private, so its "private to that object" wording holds. `PatchSetPipelineStepResolvers.{buildPipelineStepDeletePriorState, resolvePipelineStepUpdate, validateEmbeddedStepReferences, resolvePipelineStepCreate}` exist; `resolvePipelineStepCreate` is the only `target.parentId is required` site. `PatchSetApplyResolvers.resolveAll` exists, and `PatchSetResolverSupport` is at the bottom of `PatchSetApplyResolvers.scala`. `PipelineRootWrites.resolveOneRootSourceId` exists, and its `(Some(_), Some(_))` arm is the not-both check, so the `PipelineProtocol.scala` repoint is accurate. The positional words left in the resolver files (`PatchSetPipelineResolvers` "own doc, above" and "Root errors above"; `PatchSetPipelineStepResolvers` "below" and "above"; `PatchSetApplyResolvers` "below" and "above") still point at the right text. **One exception is below.**

### The evaluator's non-blocking note: I judge it a defect

`backend/src/main/scala/com/helio/services/patchsets/PatchSetPipelineResolvers.scala`, in the HEL-913 task 7.6 comment inside `resolvePipelineCreate`, now reads:

```
// ACL/blank-id validation, mirroring `PipelineRootWrites.resolveOneRootSourceId`'s own
// rules (blank id: 400 with NO ownership lookup; unresolvable id: 404).
```

`resolveOneRootSourceId` (`PipelineRootWrites.scala`) does no ownership lookup. An existing `sourceId` returns `Right(DataSourceId(sid))` unchecked. The "unresolvable id: 404" lives elsewhere: in `PipelineCreateWrites.lookupOwnedRoots` (`Data source not found: …`) on the create path, and inline in `PipelineRootWrites.addRoot`. `citation-sweep.md` section C repeats the error as a verification claim: "it is the per-root validator the rules describe: blank id 400, ownership 404".

This ticket exists to make comments point at the right place. The old citation named a symbol that does not exist. The new one names a real symbol but credits it with behaviour it does not have, so a reader who follows it will not find the 404. That is a new inaccuracy in a comment-only ticket, and the sweep record states it as checked. That is a spec divergence against AC items 1-3 ("every … `PipelineService` citation found by the sweep … corrected"), not a polish item. The fix is one comment edit.

### Verdict: REFUTE

### Change Requests

1. `backend/src/main/scala/com/helio/services/patchsets/PatchSetPipelineResolvers.scala`, the HEL-913 task 7.6 comment in `resolvePipelineCreate`: split the attribution so each half names the symbol that actually implements it. Credit `PipelineRootWrites.resolveOneRootSourceId` with the blank-id 400 (no ownership lookup). Credit `PipelineCreateWrites.lookupOwnedRoots` (the `findByIdOwned` -> `Data source not found` step of `PipelineService.create`) with the unresolvable/unowned-id 404. Use symbol + file, no line numbers, and change comment text only.
2. `openspec/changes/patchset-resolver-split-followups/citation-sweep.md`, section C, the `PatchSetPipelineResolvers` / `resolveRootDataSources` row: correct the verdict text ("blank id 400, ownership 404") to match the new two-symbol citation, so the sweep record no longer asserts a check that was not true.
3. After the edit, re-run the comment-only filter on `git diff -- backend/src/main` and record the result (expect 0 non-comment lines). No test re-run is needed for a comment-only change beyond what the commit hooks run.

### Non-blocking notes

- The orchestrator must file the follow-up ticket for the 8 editor-grant survivors outside `services/patchsets/` (`mutation-evidence.md`, "Survivors outside"), plus the two out-of-scope `resolveRootDataSources` mentions (`PipelineCreateTransaction.scala`, and `PipelineRootWrites.scala`'s own doc of `resolveOneRootSourceId`, which also cites the nonexistent `resolveRootDataSources`). `PipelineRunService.submit`'s viewer-triggers-run survivor deserves a careful look in that ticket.
- `PatchSetPreviewServiceSpec.scala`: the in-place `[now …]` annotation on a "kept verbatim" provenance block is a reasonable compromise.
