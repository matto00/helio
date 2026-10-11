# Behaviour-mutation evidence (HEL-1479, D6d / AC5)

Regenerated against `BASE=55b53be4a` (cycle 2, after merging HEL-1480); every log begins with a `## BASE=55b53be4a` line. The `6d298d5f8` logs are in `.concertino/runs/HEL-1479/evidence/superseded-6d298d5f8/`.

One mutation per new object (six: the five D2 files and `PatchSetResolverSupport`), exact-line and asserted by
`move-check/mutate.py` (`apply`/`revert`; M5's line moved 64 -> 65 with the merge). Each run: apply, then
`sbt testOnly com.helio.services.patchsets.* com.helio.api.http.ExistenceNotLeakedRoutesSpec` (`nice -n 19`, `-J-Xmx3g`), then revert.
Logs: `.concertino/runs/HEL-1479/evidence/mut-M<n>.log` (driver `run-all.sh`). Every run was red in an existing spec with a failure attributable to the mutation;
sources reverted after each (the `check.py` run after all mutations PASSes, and the final `testFull` is green on the reverted tree).
Green reference for this scope: a first probe (a `requireTargetId` `BadRequest` -> `Conflict` mutation) stayed green, 207/207 passed,
so no existing spec observes that message (recorded below as a coverage observation; the Support object is instead covered by M1).

| # | Object | Mutation | Tests (this scope) | Red in (examples) |
|---|---|---|---|---|
| M1 | `PatchSetResolverSupport` (in `PatchSetApplyResolvers.scala`) | `authorizeEditorOnDashboard`: `case Right(_) => Right(())` -> `Left(ServiceError.Conflict("mutated"))` | 40 failed / 167 passed | editor panel-update accept, the preview/apply panel specs, refinement specs (e.g. `reject an edit targeting a nonexistent resource ... (6.3a)`) |
| M2 | `PatchSetPanelResolvers` | `resolvePanelUpdate`: priorState `Some(panelResponseFormat.write(...))` -> `None` | 5 failed / 202 passed | `populate a panel-update edit's priorState ... (7.10a)`, `restore panel/dashboard/... update edits to their pre-apply state (5.3a)` |
| M3 | `PatchSetDataSourceResolvers` | `resolveDataSourceDelete`: priorState -> `None` | 1 failed / 206 passed | `still populate priorState for an unrecoverable dataSource-delete edit (7.10c)` |
| M4 | `PatchSetPipelineResolvers` | `resolvePipelineUpdate`: priorState -> `None` | 2 failed / 205 passed | `populate a pipeline-update edit's priorState ... (7.10d)`, `restore ... update edits (5.3a)` |
| M5 | `PatchSetPipelineStepResolvers` | `validateEmbeddedStepReferences`: foreign second-source `NotFound` -> `Conflict` | 2 failed / 205 passed | `reject a pipelineStep-update edit referencing a foreign-owned JoinConfig secondaryInput ... (7.9d)`, `... UnionConfig.secondaryInput ... (HEL-950)` |
| M6 | `PatchSetOutputResolvers` | `findOwnedOutput`: non-owner `NotFound` -> `Right(output)` (owner check removed) | 5 failed / 202 passed | `reject an output update edit from a non-owner (viewer grantee) ... (task 1.2)`, four `get an identical 404 for a foreign and a nonexistent id: POST patch-set apply/preview: output update/delete` rows in `ExistenceNotLeakedRoutesSpec` |

No destination was unobserved by existing specs, so no coverage-gap ticket is needed from this table. Coverage observation only:
`requireTargetId`'s `BadRequest` message is not asserted by an existing spec (the `decodeCreatePatch` messages were not probed) (follow-up candidate
for a future test ticket; C1 forbids writing one here).

## Foreign-id gate mutations (cycle 2, driver requirement)

`ExistenceNotLeakedRoutesSpec`'s patch-set rows go red through its foreign-vs-absent HTTP probe (`identical 404 for a foreign and a
nonexistent id`), not through `sites`. For the 12 rows naming `PatchSetApplyResolvers.scala`, one scratch mutation per gate, applied by
`move-check/gate-mutate.py` (anchors asserted; **no message string changed**), run with
`sbt testOnly com.helio.api.http.ExistenceNotLeakedRoutesSpec`, then reverted. BASE=55b53be4a. Logs `evidence/gate-N<n>.log`
(M6 log: `evidence/mut-M6.log`). Green reference: `evidence/guard-GREEN.log` (61 passed, 0 failed).

| # | Gate (post-split location) | Mutation | Rows red | Observed |
|---|---|---|---|---|
| N1 | panel gate, `PatchSetResolverSupport.authorizeEditorOnDashboard` (`PatchSetApplyResolvers.scala`) | `case Left(err) => Left(err)` -> `Right(())` (a failed access check lets the edit through) | `apply: panel create` | foreign `200 {"edits":[],"failure":...}` vs expected 404 |
| N2 | panel gate, moved panel lookup `PatchSetPanelResolvers.resolvePanelUpdate`/`resolvePanelDelete` | `panelRepo.findById(panelId, Some(user))` -> `findByIdInternal(panelId)` (ACL-bypassing lookup: a foreign panel is now found) | `apply: panel update`, `apply: panel delete` | foreign `404 "Dashboard not found"` vs absent `404 "edit 0: panel not found"`: distinguishable |
| N3 | step gate, `PatchSetResolverSupport.requireVisibleStep` | invisible-pipeline `NotFound` branch -> `Right(())` | `apply: pipelineStep update`, `apply: pipelineStep delete`, `preview: pipelineStep update`, `preview: pipelineStep delete` | foreign `200` (and the preview body discloses the step) vs absent `404` |
| N4 | step gate, `PatchSetResolverSupport.authorizeEditorOrOwnerOnPipeline` | `case None` (invisible pipeline) `NotFound` -> `Right(())` | `apply: pipelineStep create` | foreign `200` vs expected 404 |
| N5 | moved step lookup, `PatchSetPipelineStepResolvers.resolvePipelineStepUpdate`/`resolvePipelineStepDelete` | the `requireVisibleStep(...)` gate call replaced by `Right(())` (step found by `findByIdInternal`, visibility gate skipped) | same four step update/delete rows as N3 | foreign `200` vs absent `404` |
| M6 | output gate, `PatchSetOutputResolvers.findOwnedOutput` (from the table above) | non-owner `NotFound` -> `Right(output)` | `apply: output update`, `apply: output delete`, `preview: output update`, `preview: output delete` | foreign `200` vs absent `404` |

Coverage of the 12 rows: panel create (N1); panel update, panel delete (N2); pipelineStep apply update/delete and preview update/delete
(N3 and N5, each independently); pipelineStep create (N4); the four output rows (M6). All twelve rows were seen red; each
mutation was reverted (`git diff -- backend/src/main` shows only the README change afterwards) and the final `testFull` is green on the reverted tree.
