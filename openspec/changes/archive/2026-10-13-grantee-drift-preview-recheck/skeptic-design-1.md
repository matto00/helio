## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD d16e58d7e9d3e08a43a0483d06b1dd29fe1e6fbc (the change dir is untracked; artifacts read from disk).

### What I verified (with evidence)

- **Ticket vs. plan.** The Linear HEL-1516 description has no ACs. AC1 and AC2 in ticket.md were written by the planner.
  AC2's "a pipeline deleted in that window returns 404" goes further than the ticket, which only asks for 403. Adding
  it is reasonable because it mirrors HEL-1503, but once it is an AC it has to be met. See CR1.
- **D2 premise: CONFIRMED.**
  - `DataSourceRepository.findByIdOwned` (DataSourceRepository.scala:179-184) filters `r.ownerId === user`.
    `PipelineAnalyzeReads.scala:76-77` resolves every root with it, so a grantee gets `None`.
  - `:86` and `:94` turn that `None` into `primarySchema = Vector.empty`.
  - `PipelineSchemaDrift.diff` (PipelineSchemaDrift.scala:29-48) with `Some(baseline)` and an empty current schema
    puts every baseline column in `removedNames`.
  - So fixing only the baseline read would make a grantee always see "every column removed". The fix has to read
    both sides in the owner's view.
  - The capture side reads the same root that `rootSchemas.headOption` names: `findByIdOwnedByInternal(sourceDataSourceId,
    pipelineOwnerId)` at PipelineRunSucceededWrites.scala:258, with `lowestRootId` threaded from
    PipelineRunExecutor.scala:363.
- **D1: sound.** `findLastSourceSchema` (PipelineRepository.scala:600-609) applies an explicit owner filter, so on
  unchanged main the bug reproduces even on a BYPASSRLS role. The only production caller is
  PipelineAnalyzeReads.scala:149, behind `findByIdShared` at :41/:49. For the owner, an id-only privileged read returns
  the same row, so having one path for every caller is correct.
- **D3 semantics: CONFIRMED equivalent for live callers.**
  - `findByIdShared` (PipelineRepository.scala:73-97) admits the owner, or any `pipeline` permission row for the
    caller. No other grant path exists.
  - The proposed check with `requireEditor=false` uses the same predicate.
  - `requireEditor = closureHasEnabledAiStep` is the predicate `authorizedForAi` uses today
    (PipelineRunPreview.scala:243-247): owner, or `findGrantRole` = editor.
  - Viewer non-AI previews are preserved. Viewer AI-closure previews still get 403.
  - `RunAuthorization` is at PipelineRunRepository.scala:651-656. `checkRunAuthorizationInternal` (:254-265) is the
    pattern being copied.
- **Deletion cascade: checked, and it breaks D3/D4(f).**
  - `pipeline_roots.pipeline_id` is `ON DELETE CASCADE` (V98:80). So is `pipeline_steps` (V23:3).
  - In `previewAtNode`, the first thing after the ACL read is `resolveAllRootDataSourcesInternal`
    (PipelineRunPreview.scala:140-144), which answers **422** when roots are empty.
  - HEL-1503 hit exactly this and added an existence check in the run path's empty-roots branch
    (PipelineRunExecutor.scala:55-62).
  - D3 explicitly keeps "the 422 config checks ... in their current order before" the re-check. So a pipeline deleted
    right after the preview's ACL read returns 422 and never reaches `PipelineGone`. See CR1.
- **Seam vs. the all-Outputs arm.** `previewOutputs(None)` calls `findByIdShared` at PipelineRunPreview.scala:80, and
  `previewAtNode` calls it again (:135) once per node key, through `Future.traverse`. A seam that revokes after "the"
  `findByIdShared` return gives 404 at the inner read, on main and after the fix. See CR2.
- **AI-closure red-first.** On main, an editor whose grant is revoked while previewing an AI closure already gets 403,
  because `findGrantRole` returns `None`. Only non-AI closures are red on main. See CR3.
- **NOBYPASSRLS harness: sound.**
  - Hel1503EditorRunGapsSpec.scala:58-85 creates a NOSUPERUSER NOBYPASSRLS app role, a BYPASSRLS privileged role via
    `SET ROLE`, and `DbContext(appDb, privDb)`.
  - It already has the `SpyBackend` execution counter (:94-108) and S1/S2 deletion seams (:187-200).
  - Modelling the new spec on it is correct.
- **Mutations M1, M2, M3 and M5 can fail:**
  - M1: the grantee's baseline goes back to `None`, so case (a) is red.
  - M2: the grantee's current schema is empty, so case (b) shows spurious removals.
  - M3: with a non-AI closure the preview executes.
  - M5: the viewer's AI-closure preview executes.
  - **M4 cannot fail as designed**, because `PipelineGone` is unreachable under the seam in (f). See CR1.
- **ExistenceNotLeakedRoutesSpec:**
  - `expectedForbiddenProducers` has `"PipelineRunPreview.scala" -> 1` (test/.../api/http/ExistenceNotLeakedRoutesSpec.scala:534).
    The doc comment at :519-520 describes it as the AI-closure gate. Task 3.3 has to rewrite that comment, not only
    the count.
  - The classification holds: any `Forbidden` comes after `findByIdShared` returned the pipeline.

### Verdict: REFUTE

### Change Requests

1. **AC2 "deleted → 404" is unreachable under D3's ordering, and M4 cannot go red.**
   - Roots cascade with the pipeline, so a deletion after the preview's ACL read lands in
     `case roots if roots.isEmpty => 422` (PipelineRunPreview.scala:141-144) before any re-check runs.
   - In the step arm, a deletion after root resolution but before the step list makes `listByPipelineInternal` return
     empty, and the response is "Step not found" rather than "Pipeline not found".
   - Revise D3 to mirror HEL-1503 D3 (PipelineRunExecutor.scala:55-62). In the empty-roots branch, do a privileged
     `findByIdInternal` existence check: `None` gives 404 "Pipeline not found", `Some` keeps the 422. Update
     `findByIdInternal`'s privileged-caller doc list (PipelineRepository.scala:55-62).
   - Revise D4(f) to use two seams, as Hel1503EditorRunGapsSpec does:
     - S1: delete right after the ACL read, which tests the empty-roots existence check.
     - S2: delete after roots and steps resolve (for example a `PipelineStepRepository.listByPipelineInternal`
       override for the step arm, and a `listRootDataSourceIdsInternal` override for the source arm), which tests the
       re-check's `PipelineGone` arm and is what M4 must turn red.
   - Each seam needs its own named mutation.
2. **Fix D4(e) for the all-Outputs arm.**
   - The arm reads `findByIdShared` twice: :80, then :135 once per node key. A grant revoked after the first read is
     already caught at the second, and the response is a 404 that the re-check never produced.
   - The test would be red on main and still red after the fix, or it would pass for the wrong reason.
   - Specify a seam that revokes after the read the re-check is meant to cover. For example, revoke inside an
     `outputRepo.listByPipelineInternal` / `listRootDataSourceIdsInternal` override after the inner ACL read, or arm
     the seam on the last `findByIdShared` call.
   - State which seam each of (d), (e)-single and (e)-all uses.
3. **Pin the closure kind in D4(d).** The red-first revoked-editor step-preview case must use a **non-AI** closure.
   With an AI closure, main already returns 403 through `findGrantRole`, so the case is not red-first. Say so in D4(d)
   and in red-run.md's expectations.
4. **Task 3.3 must also rewrite the classification comment** at ExistenceNotLeakedRoutesSpec.scala:519-520, which
   describes the entry as "the step-preview AI-closure gate". It must not just bump the integer.

### Assessment of the assumed product calls

- **A1 (a grantee sees the owner's drift): right recommendation.**
  - The baseline is already captured in the owner's view (HEL-1503). Diffing it against the grantee's own view is
    wrong by construction: it gives every column "removed" for owner-only sources.
  - The disclosure argument holds. Previews execute with `ownerUserId = Some(pipeline.ownerId)`
    (PipelineRunPreview.scala:180/:265), so a viewer can already see the source's column names in the rows.
  - It is still a product call and correctly flagged for OWNER REVIEW. Drift exposes column **types** of a source the
    grantee cannot list, which is slightly more than row values show.
- **A2 (the re-check enforces the access the preview already required): right recommendation.**
  - A literal owner-or-editor re-check would silently reverse HEL-279/HEL-1108's pinned "viewer may preview a non-AI
    closure" behaviour.
  - A revoked editor gets 403 under either reading.
- **Hidden product call to add to the list: the 422→404 change.** AC2's "deleted mid-request → 404" is
  planner-added scope, and the existence check in CR1 changes a 422 into a 404 for previews. It is low-risk and matches
  HEL-1503 owner ruling A, but record it next to A1/A2.

### Non-blocking notes

- `checkPreviewAccessInternal` on `PipelineRepository` repeats the owner-or-editor predicate that
  `PipelineRunRepository.submitterMayRunAction` (:270-279) already implements.
  - That is acceptable: `PipelineRunPreview` holds no `PipelineRunRepository`, and HEL-1503 item 3 wants that file
    split.
  - Still, give the method a doc comment that names the twin, so the two predicates cannot drift.
  - Importing `PipelineRunRepository.RunAuthorization` into `PipelineRepository` couples the two files. Consider
    noting that HEL-1503 item 3's split should move the ADT to a neutral home.
- D2: drift is computed only for the primary root, which is unchanged. If a pipeline's lowest-position root is a
  source the owner does not own (an editor-added root), both sides read as `[]` and no drift is reported. That matches
  capture and is fine, but a one-line pin would be cheap.
- Analyze's `sourceSchemas` stays in the caller's view (an empty schema for grantees), while drift is in the owner's
  view. A UI that renders drift next to `sourceSchemas` will show removed columns against an empty current schema for
  grantees. This is out of scope here, but worth a sentence in A1 for the owner.
