# Recorded mutations (C12 / task 4.12)

Each mutation was applied to the main source alone, the named spec run, then the source restored. A mutation is accepted only if the spec went red.
Command: `sbt -J-Xmx3g "testOnly <spec>"` from `backend/` (script kept in .concertino/scratch/HEL-1743/mutate.py).

## digest includes a timestamp (pipeline last-run stamp, as hashing `serialized` would)

- file: `domain/insights/InsightDigest.scala`
- result: [info] Tests: succeeded 31, failed 1, canceled 0, ignored 0, pending 0
- failing tests:
  - [info] - should make one send for ten identical real runs, leaving one ok and one coalesced skipped_unchanged row *** FAILED ***

## hourly throttle removed

- file: `services/insights/InsightRenderService.scala`
- result: [info] Tests: succeeded 28, failed 4, canceled 0, ignored 0, pending 0
- failing tests:
  - [info] - should throttle a changed-data render within the hour with no row, then catch it up from the tick pass *** FAILED ***
  - [info] - should call a failing model at most once an hour, recording the requested model on the failed row *** FAILED ***
  - [info] - should let a manual refresh bypass the throttle but not the digest skip *** FAILED ***
  - [info] - should catch up a throttled success even though a failed run came after it (ER1, success then failed) *** FAILED ***

## quota gate bypassed (always permit)

- file: `services/insights/InsightRenderService.scala`
- result: [info] Tests: succeeded 25, failed 7, canceled 0, ignored 0, pending 0
- failing tests:
  - [info] - should make zero sends for a free-tier owner and keep ONE skipped_quota row however often data changes, by every trigger *** FAILED ***
  - [info] - should charge a beta owner 1 for claude-haiku-5-5, once, and request that model *** FAILED ***
  - [info] - should charge a beta owner 4 for claude-sonnet-5-5, once, and request that model *** FAILED ***
  - [info] - should charge a beta owner 8 for claude-opus-5-5, once, and request that model *** FAILED ***
  - [info] - should honour an env weight override, charge the validator retry only once, and never count an owner-tier owner *** FAILED ***
  - [info] - should charge the pipeline owner, never the editor who triggered it *** FAILED ***

## quota weight forced to 1

- file: `services/insights/InsightRenderService.scala`
- result: [info] Tests: succeeded 29, failed 3, canceled 0, ignored 0, pending 0
- failing tests:
  - [info] - should charge a beta owner 4 for claude-sonnet-5-5, once, and request that model *** FAILED ***
  - [info] - should charge a beta owner 8 for claude-opus-5-5, once, and request that model *** FAILED ***
  - [info] - should honour an env weight override, charge the validator retry only once, and never count an owner-tier owner *** FAILED ***

## hook placed inside the writes chain (run awaits the render) [SUPERSEDED in cycle 3: that mutation kept the original hook, a double trigger; see the corrected entry at the end]

- file: `services/pipelines/PipelineRunSucceededWrites.scala`
- result: [info] Tests: succeeded 31, failed 1, canceled 0, ignored 0, pending 0
- failing tests:
  - [info] - should catch up a run that overlapped an in-flight render, then stop (ER1, overlapping) *** FAILED ***

## viewer treated as privileged (role shape)

- file: `services/insights/InsightAccess.scala`
- result: [info] Tests: succeeded 4, failed 6, canceled 0, ignored 0, pending 0
- failing tests:
  - [info] - should show model, tokens and cost to the owner and an editor, and none of them to a viewer *** FAILED ***
  - [info] - should show them on the history route the same way *** FAILED ***
  - [info] - should read as not_updated for a viewer and as skipped_quota for the owner and an editor, on both routes *** FAILED ***
  - [info] - should read as not_updated for a viewer and as skipped_budget for the owner and an editor, on both routes *** FAILED ***
  - [info] - should be true for the owner and editors only *** FAILED ***
  - [info] - should refuse a viewer with 403 and hide strangers, unknown ids and non-insight Outputs behind one 404 *** FAILED ***

## R3b not_updated mapping removed [SUPERSEDED in cycle 3: its target text moved into `OutputInsightRecord.forViewer`; re-recorded in the cycle 3 section]

- file: `api/protocols/pipelines/OutputInsightProtocol.scala`
- result: [info] Tests: succeeded 8, failed 2, canceled 0, ignored 0, pending 0
- failing tests:
  - [info] - should read as not_updated for a viewer and as skipped_quota for the owner and an editor, on both routes *** FAILED ***
  - [info] - should read as not_updated for a viewer and as skipped_budget for the owner and an editor, on both routes *** FAILED ***

## coalescing disabled (always insert)

- file: `services/insights/InsightRenderService.scala`
- result: [info] Tests: succeeded 28, failed 4, canceled 0, ignored 0, pending 0
- failing tests:
  - [info] - should make zero sends for a free-tier owner and keep ONE skipped_quota row however often data changes, by every trigger *** FAILED ***
  - [info] - should make one send for ten identical real runs, leaving one ok and one coalesced skipped_unchanged row *** FAILED ***
  - [info] - should record a failed, no-model row and charge nothing for a stored model that is no longer selectable *** FAILED ***
  - [info] - should merge a no-model failed row only into a newest row that is also a no-model failed *** FAILED ***

## ER2: no-model failed merges into a modelled failed row

- file: `services/insights/InsightRenderService.scala`
- result: [info] Tests: succeeded 31, failed 1, canceled 0, ignored 0, pending 0
- failing tests:
  - [info] - should never alter a failed row that carries a model, tokens or cost, and insert a new row instead *** FAILED ***

## ER1: catch-up disabled

- file: `domain/insights/InsightSchedule.scala`
- result: [info] Tests: succeeded 29, failed 3, canceled 0, ignored 0, pending 0
- failing tests:
  - [info] - should throttle a changed-data render within the hour with no row, then catch it up from the tick pass *** FAILED ***
  - [info] - should catch up a run that overlapped an in-flight render, then stop (ER1, overlapping) *** FAILED ***
  - [info] - should catch up a throttled success even though a failed run came after it (ER1, success then failed) *** FAILED ***

## GREATEST removed from the coalescing UPDATE

- file: `infrastructure/persistence/pipelines/OutputInsightRepository.scala`
- result: [info] Tests: succeeded 31, failed 1, canceled 0, ignored 0, pending 0
- failing tests:
  - [info] - should never move a row's stamp backwards (an overlapping render that started earlier) *** FAILED ***

## Hook placement, re-run on the dedicated test [SUPERSEDED, UNREPRODUCIBLE: the evaluator could not reproduce it and the cause is the double trigger above; see the corrected entry at the end]

The scripted run above listed only the overlapping-run test red for the hook mutation. Re-run alone on the test written for it
(`testOnly com.helio.services.insights.InsightRenderServiceSpec -- -z never`, mutation: `published.flatMap(v => insightTrigger.afterRunSucceeded(pipelineId, runId).map(_ => v)...)`):

- `should stay succeeded, with the same event sequence, when the model never answers *** FAILED ***` (the run now takes the whole 3 s timeout, over the 2.5 s bound); `Tests: succeeded 7, failed 1`. Source restored afterwards.

# Cycle 3 mutations (evaluation-1 CR2, CR4, CR5, CR6)

Same method as above (mutate main source only, run the named spec, restore). Every `old` text below exists in the committed code at this commit (the script asserts it before mutating). **These supersede** the earlier "hook placement" entries (including the "re-run alone" paragraph, which the evaluator could not reproduce: the old test had a 3 s timeout and an elapsed bound, and passed under the mutation) and the earlier R3b entry (its target text moved into `OutputInsightRecord.forViewer`).

## hook placed inside the writes chain (run awaits the render)

- file: `services/pipelines/PipelineRunSucceededWrites.scala`
- result: [info] Tests: succeeded 34, failed 1, canceled 0, ignored 0, pending 0
- failing tests:
  - [info] - should catch up a run whose write phase began before an earlier render started and committed after it read (ER1, overlapping) *** FAILED ***

## ER1 overlap grace removed (`run.isAfter(att)`)

- file: `domain/insights/InsightSchedule.scala`
- result: [info] Tests: succeeded 34, failed 1, canceled 0, ignored 0, pending 0
- failing tests:
  - [info] - should catch up a run whose write phase began before an earlier render started and committed after it read (ER1, overlapping) *** FAILED ***

## disabled steps no longer skipped (`.filter(_.enabled)` removed)

- file: `services/insights/InsightInputsBuilder.scala`
- result: [info] Tests: succeeded 34, failed 1, canceled 0, ignored 0, pending 0
- failing tests:
  - [info] - should ignore a disabled step's op when inferring the preset *** FAILED ***

## preset signals read Outputs of every node, not the insight's own

- file: `services/insights/InsightInputsBuilder.scala`
- result: [info] Tests: succeeded 33, failed 2, canceled 0, ignored 0, pending 0
- failing tests:
  - [info] - should read an Output on another node when reads.outputs names it, yet leave the preset to the insight's own node *** FAILED ***
  - [info] - should ignore a disabled step's op when inferring the preset *** FAILED ***

## R3b: forViewer keeps skipped_quota/skipped_budget (not_updated mapping removed)

- file: `domain/insights/OutputInsightRecord.scala`
- result: [info] Tests: succeeded 8, failed 2, canceled 0, ignored 0, pending 0
- failing tests:
  - [info] - should read as not_updated for a viewer and as skipped_quota for the owner and an editor, on both routes *** FAILED ***
  - [info] - should read as not_updated for a viewer and as skipped_budget for the owner and an editor, on both routes *** FAILED ***

## Hook placement, corrected mutation (this is the one that counts)

The first cycle-3 hook mutation above kept the original `published.foreach` hook AND added an awaited second call, so the second call hit the in-flight claim and returned at once (a double trigger, not a move). The faithful mutation REPLACES the `published.foreach { ... }; published` block with `published.flatMap(v => insightTrigger.afterRunSucceeded(pipelineId, runId).map(_ => v))` (the hook moved inside, awaited).

- file: `services/pipelines/PipelineRunSucceededWrites.scala`
- result: [info] Tests: succeeded 33, failed 2, canceled 0, ignored 0, pending 0
- failing tests:
  - [info] - should complete the run and publish succeeded while the render is still in flight (hook outside the writes chain) *** FAILED ***
  - [info] - should catch up a run whose write phase began before an earlier render started and committed after it read (ER1, overlapping) *** FAILED ***

