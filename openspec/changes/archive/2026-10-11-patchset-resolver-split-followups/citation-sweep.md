# Citation sweep (HEL-1482 items 1-3, design D6)

Method: `grep -rn "PatchSetApplyResolvers" backend/src` (incl. split-across-line-break and object-name-only mentions), plus
`above|below|[[|PipelineService` over the six resolver files (`PatchSetApplyResolvers`, `PatchSetPanelResolvers`,
`PatchSetDataSourceResolvers`, `PatchSetPipelineResolvers`, `PatchSetPipelineStepResolvers`, `PatchSetOutputResolvers`).
Every citation names symbol + file, never a line number. Fixed = comment text only (the main diff has zero non-comment
changed lines, see `verification.md`).

## A. Ticket-listed sites

| Site | Was | Verdict |
|---|---|---|
| `PatchSetPreviewProjection.scala`, doc of `toPipelineSummaryResponse` | `PatchSetApplyResolvers.pipelineSummaryResponse` | FIXED -> `PatchSetPipelineResolvers.pipelineSummaryResponse` (member is `private` there; the "private to that object" wording still holds) |
| `PatchSetUndoService.scala`, doc of the delete-undo recreate (citation split across two comment lines) | `PatchSetApplyResolvers .buildPipelineStepDeletePriorState` | FIXED -> `PatchSetPipelineStepResolvers .buildPipelineStepDeletePriorState` (verified: defined there) |
| `RefinementEditShapeSpec.scala`, pipelineStep UPDATE block comment | `PatchSetApplyResolvers.resolvePipelineStepUpdate`/`validateEmbeddedStepReferences` | FIXED -> `PatchSetPipelineStepResolvers.…` (both defined there) |
| `RefinementEditShapeSpec.scala`, HEL-670 block comment | `PatchSetProtocol`/`PatchSetApplyResolvers` never alias a create's absent id | FIXED -> `PatchSetApplyResolvers.resolveAll` (and the per-kind resolvers it dispatches to): the claim spans the dispatch plus the per-kind resolvers |
| `PatchSetPreviewServiceSpec.scala`, "Original HEL-671 note, kept verbatim for provenance" | `PatchSetApplyResolvers.validateEmbeddedStepReferences` | ANNOTATED in place (`[now PatchSetPipelineStepResolvers.validateEmbeddedStepReferences]`), quoted text otherwise untouched |
| `PipelineProtocol.scala`, doc of `CreatePipelineRootRequest` | `PipelineService.resolveInlineOrExistingRoot` (never existed anywhere; `git grep` finds only this citation) | FIXED -> `PipelineRootWrites.resolveOneRootSourceId` (its `(Some(_), Some(_))` arm is the "sourceId xor inline type" mutual-exclusion check, message `roots: specify either sourceId or an inline type, not both`) |

## B. Every other `PatchSetApplyResolvers` mention in `backend/src`

| Site | Verdict |
|---|---|
| `ApiRoutes.scala` (preview wiring comment, "reuses PatchSetApplyResolvers") | KEPT: `resolveAll` is still in `PatchSetApplyResolvers` |
| `PatchSetProtocol.scala` (`EditTarget` format doc, "parentId required ... enforced by `PatchSetApplyResolvers`", object-name-only credit) | FIXED -> `PatchSetPipelineStepResolvers.resolvePipelineStepCreate` (the only place `target.parentId is required` is enforced) |
| `PipelineRepository.scala` (`PipelineSummary` doc: historical list of files a removal "would cascade into") | KEPT: historical statement of the HEL-913 era; no resolver reads `sourceDataSourceId` any more, but the sentence records why a field was kept, not where code lives today |
| `README.md` (patchsets): lists `PatchSetResolverSupport` as a held "file" | KEPT, observation only: it is an object inside `PatchSetApplyResolvers.scala`, not a file; markdown outside the ticket's comment scope |
| `RefinementGrounding.scala` (`PatchSetApplyResolvers.resolveDashboardUpdate`) | KEPT: `resolveDashboardUpdate` stayed in `PatchSetApplyResolvers` |
| `PatchSetApplyTypes.scala` (`[[PatchSetApplyResolvers]]'s pre-validation pass`) | KEPT: names the pass as a whole; `resolveAll` entry point is there |
| `PatchSetApplyService.scala` (`[[PatchSetApplyResolvers]]` step 1) | KEPT: same |
| `PatchSetApplyService.scala`, `PatchSetPreviewService.scala` (calls to `resolveAll`; preview doc "Reuses ... `PatchSetApplyResolvers.resolveAll`") | KEPT: code / correct |
| `PatchSetApplyServiceJson.scala` (`[[PatchSetApplyResolvers]]/…` consumers of the Json surface) | FIXED: now names the resolver objects (`PatchSetApplyResolvers` and the per-kind `PatchSet*Resolvers`), which all import it |
| `PatchSetApplyForward.scala` ("so `PatchSetApplyResolvers` can never produce one of these actions") | KEPT: the dispatch (`resolveEdit`) is there |
| five split files, header `Split out of PatchSetApplyResolvers (HEL-1479)` | KEPT: accurate history |
| `PatchSetPreviewOutputContextSpec.scala` (`PatchSetApplyResolvers.resolveAll(...)` call) | KEPT: code |
| `PatchSetApplyServiceSpec.scala` (HEL-670 comment, "PatchSetApplyResolvers/PatchSetApplyForward resolution+apply behavior") | KEPT: resolution entry point still `resolveAll` there |
| `ExistenceNotLeakedRoutesSpec.scala` panel/pipelineStep `sites`, `patchSetDispatchPairs`, `expectedForbiddenProducers` | KEPT (design D5/C3): the panel/step gates (`PatchSetResolverSupport`) and the dispatch are still in `PatchSetApplyResolvers.scala`. The four OUTPUT rows were repointed to `PatchSetOutputResolvers.scala` (item 4, `mutation-evidence.md`) |
| `PatchSetProtocolSpec.scala` (two test NAME strings mention the object) | FENCED: string literals; test names are test identity (C1) |
| `PatchSetApplyResolvers.scala` own object doc (described all resolvers as living there) | FIXED: now says it holds `resolveAll`, the dispatch and the three dashboard resolvers, names the five sibling objects, and says `PatchSetResolverSupport` is at the bottom of the file |

## C. Inside the six resolver files

| Hit | Verdict |
|---|---|
| `PatchSetApplyResolvers`: `[[ResolvedEdit]]`, `[[PatchSetApplyService]]`, `[[PatchSetApplyContext]]` | KEPT: all three still resolve (`PatchSetApplyTypes.scala` / `PatchSetApplyService.scala`) |
| `PatchSetApplyResolvers`: "an unmatched fallthrough case below covers it" (dataType) | KEPT: the `case (kind, op)` arm is still below, in the same match |
| `PatchSetApplyResolvers`: "(added for `pipelineStep` create, above)" | KEPT: the `("pipelineStep","create")` arm is still above the `("output","create")` arm in the same match |
| `PatchSetApplyResolvers`: `PipelineService.updateStep`/`deleteStep` (doc of `authorizeEditorOrOwnerOnPipeline`) | KEPT: public delegations on `PipelineService` (HEL-1480 convention) |
| `PatchSetPipelineResolvers`: `PipelineService.resolveRootDataSources` (not a member of `PipelineService`, nor a `def` anywhere) | FIXED, credit split (cycle 2): blank id 400 with no ownership lookup -> `PipelineRootWrites.resolveOneRootSourceId` (that member does no ownership check); unresolvable/unowned id 404 (`Data source not found`) -> `PipelineCreateWrites.lookupOwnedRoots` (`findByIdOwned`), both verified by reading the code |
| `PatchSetPipelineResolvers`: "(this file's own doc, above)" / "Root errors above stay first" | KEPT: both still point at text earlier in the same function |
| `PatchSetPipelineResolvers`: `PipelineService.create` (HEL-1402/HEL-1469 pre-flight) | KEPT: public on `PipelineService` |
| `PatchSetPipelineStepResolvers`: `PipelineService.updateStep`/`addStep` (x4), `PipelineStepWrites.updateStep`, `PipelineStepCreate.addStepReporting` | KEPT: `updateStep`/`addStep` public delegations; the two collaborators' members verified to exist |
| `PatchSetPipelineStepResolvers`: "BEFORE the decode and referential checks below"; "the update resolver above" | KEPT: `validateEmbeddedStepReferences` still precedes decode in the same function; `resolvePipelineStepUpdate` still precedes the delete resolver |
| `PatchSetPanelResolvers`, `PatchSetDataSourceResolvers`, `PatchSetOutputResolvers` | no hit |

## D. Out of scope, observed

`PipelineCreateTransaction.scala` and `PipelineRootWrites.scala` (both in `services/pipelines/`) also cite the nonexistent
`resolveRootDataSources`; they are outside the six resolver files this ticket sweeps and are listed for the follow-up
ticket rather than edited here.
