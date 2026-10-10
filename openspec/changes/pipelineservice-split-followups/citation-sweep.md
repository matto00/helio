# Citation sweep (HEL-1480, D2)

## Method

Moved-member list built from HEL-1463's move inventory
(`openspec/changes/archive/2026-10-10-split-pipeline-service/move-evidence.md`, every block whose destination is not
`PipelineService`), saved to the run evidence dir as `HEL1480-moved-members.txt`. Command (run at HEAD = base, and again
at the end, from the worktree root):

```
M=$(cat HEL1480-moved-members.txt)   # create|checkedCreate|...|toFieldResponse|audit|stepResponseWithRoot
grep -rnE "PipelineService(\.scala|[.#]($M)\b)" backend/src | grep -v "backend/src/main/.../PipelineService.scala"
```

Base: 115 hits (via `git grep ... HEAD`). Final: 86 hits, all reviewed below as KEPT/FENCED. the repointed/corrected comment lines are enumerated below (full list: `git diff`). Rule applied (D2): a citation of a member that `PipelineService` still exposes
(the public delegations `create`, `addRoot`, `removeRoot`, `analyze`, `analyzeConcise`, `laneTree`, `laneTreeGiven`,
`analyzeProposal`, `addStep`, `addStepReporting`, `updateStep`, `deleteStep`, `reorderSteps`, `duplicateStep`, `listSteps`,
`updateName`, `delete`, `findSummaryById`, `listSummaries`, the companion's `stepAddress`/`outputAddress`/`rootAddress`/
`joinAddress`/`classifyDbError`/`validateLaneReference`/`ancestorChainOf`, `requireEditorAccess`) is correct as an entry-point
citation and KEPT; a citation of a member that exists only in a collaborator is repointed to `<Collaborator>.<member>`.

## Repointed / fixed (comment-only; `git diff` of `backend/src/main` shows no non-comment line other than the two D4 deletions)

| File | Was | Now |
|---|---|---|
| `PipelineCreateTransactionalSpec` (header + :95 + :170) | `PipelineService.createTransactional`; `validateStepCrossOwnerRefs (PipelineService.scala)`; `...PipelineService.scala:521` | `PipelineCreateTransaction.createTransactional`; `PipelineCreateTransaction.validateStepCrossOwnerRefs`; `PipelineCreatePreflight.checkStep` / `PipelineStepCreate.addStepReporting` |
| `PatchSetApplyResolvers.scala` :178 (ONLY edit to that file) | `PipelineService.scala:568-597` | config branch of `PipelineStepWrites.updateStep` and `PipelineStepCreate.addStepReporting` |
| `PatchSetPreviewProjection.scala` :286 | `PipelineService.scala:154-155` | `PipelineService.updateName` |
| `PipelineStepRepository.scala` trunkOf doc (~:1092) | `PipelineService.scala` as a `trunkOf` caller | `PipelineStepCreate.scala` (grep: the only `trunkOf(` callers in services are `PipelineStepCreate` :112/:286 and `PipelineRunSucceededWrites`) |
| `OutputRepository.scala` :75 | `PipelineService.buildOutputsAction` (`:617`) | `PipelineCreateTransaction.buildOutputsAction` |
| `PipelineService.scala` (companion comment ~:260, ~:314) | `PipelineService.createTransactional`; call sites `(:374/:818)` | `PipelineCreateTransaction.createTransactional`; `PipelineCreateTransaction.createTransactional` and `PipelineRootWrites.addRoot` (the two local `PipelineCycleRejected` catches, verified by grep) |
| `PipelineStepRoutesSpec.scala` ~:1830 | `PipelineService:670` | config branch of `PipelineStepWrites.updateStep` |
| `PipelineAnalyzeService`, `PipelineStep`, `PipelineProtocol` (x2), `DataSourceProtocol`, `PipelineRepository` (x2), `PipelineStepRepository` (`buildStepsAction` x2, `persistNewStep`), `PipelineCreatePreflight`, `OutputRootResolution`, `PipelineProposalService` (x2), `PipelineAnalyzeJoinCollisionSpec` (x2), `PipelineAnalyzeAnalyzeWithAiSpec`, `PipelineAnalyzeUpsertSourceSpec`, `PipelineAnalyzeConvertFormatSpec`, `PipelineCycleDetectionServiceSpec`, `PipelineRepositoryRunTransactionallyRlsSpec`, `MultiRootIsolationSpec`, `AssistantProposalToolSchemasSpec` | `PipelineService.<toCostVerdictResponse|toAnalyzeStepResponse|createTransactional|buildStepsAction|buildOutputsAction|resolveInlineSourceSchema|persistNewStep|resolveSecondarySourceSchemas>` (members with no `PipelineService` entry) | `<owning collaborator>.<member>` (scripted; the script only touched lines whose first non-space token is `//`, `*` or `/**` and printed any non-comment match: none) |

## Positional words / `[[...]]` links (the eleven HEL-1463 files)

Grep: `grep -nE "\babove\b|\bbelow\b|\[\[|this file|this class|\bhere\b"` over the ten collaborator files plus `PipelineService.scala`
(`PipelineService.scala`: `above`/`below`/`[[` hits reviewed separately). Verdicts (hit = line in the file as of the change):

FIXED
- `PipelineService.scala` ~:71 "`analyze` below supplies its own ACL-scoped resolveRoot" -> `PipelineAnalyzeReads.analyze`.
- `PipelineAnalyzeReads.scala` ~:66 "(`resolveNodeSchema` above)": `resolveNodeSchema` exists nowhere in `backend/src` (stale even before the move) -> `PipelineNodeReads.projectedSchemaAtNode`.
- `PipelineNodeReads.scala` ~:139 "mirroring `analyze` above" -> `PipelineAnalyzeReads.analyze`.
- `PipelineProposalAnalyze.scala` ~:28 "engine `analyze` above uses", ~:32 "`addStep`'s existing guard above", ~:47 "`analyze` route uses above" -> qualified with `PipelineAnalyzeReads.analyze` / `PipelineStepCreate.addStepReporting`.
- `PipelineCreateTransaction.scala` ~:29 "`create` above delegates here" -> `PipelineCreateWrites.create`.
- `PipelineStepCreate.scala` ~:27, ~:29 `[[addStep]]` (dangling in this file) -> `[[PipelineService.addStep]]`.
- `PipelineStepWrites.scala` ~:88 "identical guard + rationale in addStep above" -> `PipelineStepCreate.addStepReporting`.
- `PipelineCreateWrites.scala` ~:118, ~:177 `[[resolveOneRootSourceId]]` (moved to `PipelineRootWrites`) -> `[[PipelineRootWrites.resolveOneRootSourceId]]`.
- `PipelineRootWrites.scala` ~:35 `[[compensatingInlineSources]]` (moved to `PipelineCreateWrites`) -> `[[PipelineCreateWrites.compensatingInlineSources]]`.

KEPT (referent is still in the same file, in the stated direction)
- `PipelineAnalyzeReads`: :50 (`findByIdShared` above, within `analyze`), :52 / :70 ("below", same method), :62, :71, :90, :97, :119 ("elsewhere in this file": `analyzeNodes` call sites in this file), :128 (`rootDsOpts` resolved above), :197 (`analyze` above `analyzeConcise`).
- `PipelineCreateTransaction`: :57 (`NodeStepInput.rootId` below, same method), :105, :112, :133, :158, :190, :207, :241, :260 (all "here" deictics, not positional links).
- `PipelineCreateWrites`: :49, :73, :76, :144 (`[[compensatingInlineSources]]`, `[[PipelineCreatePreflight.run]]` resolve).
- `PipelineNodeReads`: :44 (`laneTree` above, same file), :78 (`[[laneTreeGiven]]`), :99, :106 (`[[listRootDataSourceIdsInternalBatch]] above`, defined earlier in the file).
- `PipelineProposalAnalyze`: :108, :112, :237, :278, :295 ("here" deictics).
- `PipelineRootWrites`: :52, :55, :106.
- `PipelineStepCreate`: :31, :104/:106 ("placement logic below" = `persistNewStep`, below in the same file), :154 ("both branches above"), :168, :241, :277, :281, :284, :297.
- `PipelineStepWrites`: :30, :69, :201, :203, :266.
- `PipelineCreatePreflight` :59 (`[[resolveStepRootIndex]]`), `PipelineServiceSupport` :94, :187 ("here"), `PipelineService.scala` :22-25 (`[[...]]` to classes outside the split), :48/:53/:57 (constructor params above), :205 (`listSteps` stays in the entry point), :316 (`case other` below in `classifyDbError`).

## Verification grep

`grep -rnE "PipelineService\.scala:?[0-9(]|\(:[0-9]+\)|PipelineService:[0-9]+|\(:[0-9]+/:[0-9]+\)" backend/src` -> 0 hits (the broadened pattern
also found the two extra sites `(:374/:818)` and `PipelineService:670` above). The remaining 86 member/`PipelineService.scala` hits
split as: public-delegation / companion / describe-label citations (KEPT, see rule), the `ExistenceNotLeakedRoutesSpec`
`Set("PipelineService.scala")` rows for `GET/PATCH/DELETE pipeline` and the pinned `"PipelineService.scala" -> 1` Forbidden
producer count (KEPT: the access check and the one producer still run in `PipelineService.scala`), and:

- FENCED: `PipelineServiceSupport.scala` ~:145/:171/:177 `s"PipelineService.toAnalyzeStepResponse: ..."` runtime exception strings (C1 forbids string-literal edits).
- Test comments that deliberately quote a fenced runtime message: none found (grep `PipelineService.toAnalyzeStepResponse` in tests returned only the comments repointed above).

## Deferred

- `PatchSetApplyResolvers.scala` other stale references (e.g. `:113` "mirrors `PipelineService.updateStep`/...", `:582` `PipelineService.create`) are public-delegation citations and still correct; any further wording clean-up there waits for HEL-1479's split.
