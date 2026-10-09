# Stale-reference evidence (commit d) -- HEL-1393, design D7/D8

Comment/doc-only commit: the `backend/src/main` diff has no non-comment line except the README bullet; the `backend/src/test` diff has none at all
(`git diff -U0 | grep -E '^[+-][^+-]' | grep -vE '^[+-]\s*(//|\*|/\*\*)'` -> README line only). Bytecode proof: `javap -c -p` (instructions, no line tables) of all 106 classes of the
21 changed main files, compiled at commit (c) and at (d), `diff -r` -> empty (`dis-d.diff`, 0 lines).

## Closing grep (able to fail)
```
grep -rnE 'PipelineRunService([.#](executeRun|executeRunSuccess|onRunSuccess|onUnblockedRunSuccess|runPipeline|trunkOf|upsertFieldsFromRows|resolveAllRootDataSourcesInternal|parseTruncationRecord|previewAtNode|evaluateNodeRowsForBackfill|onBlockedRun)\b|\.scala:[0-9])' backend/src/main/scala backend/src/test
```
- On ecaa1a53: **33 hits** (non-zero, so the grep can fail).
- After: **3 hits**, exactly the recorded exceptions, all test describe/it name STRINGS or a comment quoting a deleted describe title verbatim:
```
backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala:447:  "PipelineRunService.executeRun (HEL-509 / 419-B assertion persistence)" should {
backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala:547:  "PipelineRunService.onRunSuccess (HEL-570 assert fail-policy)" should {
backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala:2144:  // HEL-904 task 4.5: "PipelineRunService.onUnblockedRunSuccess (HEL-891 schema union)" describe
```
Excluded with reason: test describe/it name strings are test identities, not comments; renaming them breaks by-name per-suite comparison (D9) and C4.
(`PipelineRunServiceSpec:2144` is a comment quoting a describe title that was deleted by HEL-904; the quote is a historical record, kept verbatim.) These are listed in the follow-up list below.

## Broader forms (skeptic-design-2 notes 1-2)
Bare `PipelineRunService.scala` / space form `PipelineRunService <member>`: 12 hits on ecaa1a53, 7 after. Classification of the 7 remaining:
- `ExistenceNotLeakedRoutesSpec:455,457` -- TRUE (the `submit`/dry-run sites do live in `PipelineRunService.scala`); `:519,:530` -- the pin map + its doc (TRUE: the AI-gate comment says the gate was moved OUT of it; the entry in the map is the remaining `submit` producer).
- `V94__outputs_model.sql:409,851` -- applied migration SQL comments, immutable (checksum), EXCLUDED.
- `PipelineRunServiceSpec:749` -- describe name string, EXCLUDED, in the follow-up list.
The 5 fixed: `PipelineStepRepository:1092` (-> `PipelineRunSucceededWrites.scala`), `PipelineRunRoutesSpec:636` (-> `PipelineRunExecutor.scala`, the `RunResultResponse` run-path construction site),
`V94OutputsMigrationSpec:592` (-> `PipelineRunSucceededWrites.scala`), `PipelineRunServiceSpec:1353/:2419` (line citations replaced by symbol names; `:329-374`, `:403`, `:507`, `:662`, `:108` all gone).
Other `PipelineRunService` + member sightings kept as TRUE: `OutputService`/`OutputRoutesSpec`/`PipelineRunServiceSpec` refs to `PipelineRunService.backfillOutputNode` (still the public entry point, delegating) ;
`PipelineRunServiceSpec:2167` describe name `previewStep / evaluateNodeRowsForBackfill` (name string, excluded, follow-up list). Fixed too: `PipelineSchedulerService:249`, `PipelineStepRoutesSpec:376`.

## Item 2 / item 5 / path greps
- `grep -rn resolvePrimaryDataSourceInternal backend/src`: 3 hits on ecaa1a53 -> 0.
- `Defaulted to \`None\`` in the two item-5 sites (`PipelineRunService.scala:~277`, `PipelineRunBackfill.scala:68`): 2 on ecaa1a53 -> 0 (the other 6 repo-wide hits describe different, genuinely defaulted fields and were left alone). Call-site check for D8: every caller passes `explicitRootId` explicitly --
  `OutputService.scala:77` (`output.node.rootId`), `PipelineRunServiceOutputHistorySpec:187` (`None`), `PipelineRunServiceSpec:2398,2447,2481` (`explicitRootId = None`). New wording: "Required (no default): every caller passes it explicitly".
- `ExistenceNotLeakedRoutesSpec` class doc path to `forbidden-classification.md` now `openspec/changes/archive/2026-10-02-collapse-owner-only-existence-leak/` (file exists there).
- README collaborator list gains `PipelineRunPreview`.

## Fixed member references (old -> owning class)
`executeRun`, `onRunSuccess`, `runPipeline` -> `PipelineRunExecutor`; `onUnblockedRunSuccess` -> `PipelineRunSucceededWrites`; `onBlockedRun`, `onDryRunSuccess`, `executeRunFailure` -> `PipelineRunTerminalWrites`;
`trunkOf` -> `PipelineStepRepository`; `resolveAllRootDataSourcesInternal` -> `PipelineRunSupport`; `parseTruncationRecord` -> `PipelineRunQueries`; `previewAtNode`/`previewStep` -> `PipelineRunPreview`;
`evaluateNodeRowsForBackfill` -> `PipelineRunBackfill`; `upsertFieldsFromRows` no longer exists (removed by HEL-904): the AlertEvaluationService doc now says so.
CR2 must-fix sites, all done: `OutputRoutesSpec` MUTATION PROOF -> `PipelineRunPreview.previewAtNode`; `PipelineRunService.scala` `backend` comment; `PipelineExecutionBackend.scala:23,49,68`; the moved `previewOutputs` doc ("`executeRun`, this method's sibling" -> `PipelineRunExecutor.executeRun`).

## Wording sweep ("this file/this class/this service/sibling/above/below/the file's") over the nine `PipelineRun*.scala` files

| Site | Verdict | Action |
|---|---|---|
| Support:82 "reachable from this class" | TRUE | kept |
| Preview:60 "`executeRun`, this method's sibling" | FALSE | -> `PipelineRunExecutor.executeRun` |
| Preview:124/133/152/232/240 "see below"/"described above"/"method doc above"/"guard above"/"comment above" (all within the same doc/method) | TRUE | kept |
| Preview:131,162 "`evaluateNodeRowsForBackfill`'s sibling handling" | FALSE (different class now) | -> `PipelineRunBackfill.evaluateNodeRowsForBackfill`'s handling |
| Preview:158 "which only governs `executeRun`" | FALSE | -> `PipelineRunExecutor.executeRun` |
| Terminal:35 "publish below" (same method) | TRUE | kept |
| Terminal:42 "the guard-check nesting added above it" | FALSE (the guard lives in `executeRun`, other class) | reworded |
| Terminal:71,72 "onDryRunSuccess below", "call below" | TRUE | kept |
| Terminal:92 "mirroring the file's existing insertRun/deleteOldRuns" | FALSE (`insertRun` is in the Executor) | reworded |
| Terminal:122,132 "chain below", "inserted above" (same method) | TRUE | kept |
| Terminal:140 "the `executeRun` Failure branch (`Failure(ex)` above)" | FALSE | -> `executeRunFailure` (above) |
| Service:40-65,81-103 constructor "above"/"below"/"in this file" | TRUE except: `:42` onRunSuccess, `:81` "history branch below", `:91-92` `executeRun` + "this file" | FALSE ones reworded; the rest kept |
| Service:99,103 "this service" | TRUE (it is the service's constructor) | kept |
| Service:136 "this class already" (resolveHost/isBlocked) | TRUE | kept |
| Service:141 "the two execution call sites (`executeRun`, `previewStep`)" | FALSE | reworded (Executor, Preview, Backfill) |
| Service:211-213 `[[runPipeline]]`, "`onBlockedRun`'s persistence pattern below" | FALSE | qualified, "below" dropped |
| Service:277 / Backfill:68 "Defaulted to `None`" | FALSE (no default) | item 5 |
| Backfill:54 "every other such fixture in this file" | FALSE | -> `PipelineRunService`'s constructor |
| Backfill:141 "`persistBackfilledRows`'s own doc above" | FALSE (defined at :153, below) | -> "below" |
| Queries:122 "the call site above" | TRUE (`latestRun`'s flatMap) | kept |
| Succeeded:51 "a pure insertion point above this method" | FALSE (nothing of the sort above it any more) | reworded |
| Succeeded:182 "the file's existing discipline at updateRunTerminal's preExec/insertRun" | FALSE | -> `PipelineRunExecutor.executeRun` |
| Succeeded:235 "unlike onDryRunSuccess above" | FALSE | -> `PipelineRunTerminalWrites.onDryRunSuccess` |
| Executor:109-118,140,225,235-238 "below"/"above"/"moved up from below" | TRUE (same method) | kept |
| Executor:126 "every other nullable-optional collaborator in this file" | FALSE | -> `PipelineRunService`'s constructor |
| Unqualified member refs inside the collaborators (e.g. `onUnblockedRunSuccess's per-node writes` in Executor) | TRUE (resolve within the `pipelines` package, not attributed to `PipelineRunService`) | kept |
| `sibling` in `PipelineRun*.scala` | grep now 0 hits | |

## Follow-up candidates (not done here, per C4/D7)
1. Test describe/it name strings that name moved members: `PipelineRunServiceSpec:447` ("PipelineRunService.executeRun ..."), `:547` ("PipelineRunService.onRunSuccess ..."), `:749` ("PipelineRunService onRunSuccess ..."), `:2167` ("PipelineRunService.previewStep / evaluateNodeRowsForBackfill ...").
2. `PipelineRepository.findPrimaryDataSourceIdInternal` (:117) has no code callers in main or test after the `resolvePrimaryDataSourceInternal` deletion (only comment mentions).
3. V94 migration SQL comments cite `PipelineRunService.scala:650/:640` (immutable; left).
