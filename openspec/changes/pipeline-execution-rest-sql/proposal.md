## Why

A pipeline whose base source is `rest_api` or `sql` can never actually be run today —
`PipelineRunService.runPipeline`/`previewStep` categorically reject these two kinds before
`InProcessPipelineEngine` is ever reached, regardless of whether the source is reachable. HEL-755
made this fail *safely* (a durable "blocked" run, no destructive rollback) but did not add real
execution support. Every `rest_api`/`sql` source is therefore unusable for its actual purpose: it
can never populate a panel-bindable DataType.

## What Changes

- `InProcessPipelineEngine.loadRows` gains cases for `RestSource`/`SqlSource`, reusing the existing
  `RestApiConnector.fetch`/`SqlConnector.fetch` SPI methods (the same ones `SourceService`/
  `CreateSourceEnvelope` already use for preview/schema-inference) to load a bounded row set.
- `PipelineRunService.runPipeline` and `.previewStep` drop their hardcoded `RestSource`/`SqlSource`
  rejection — both source kinds now execute through the ordinary in-process path.
- `PipelineRunService.SparkUnsupportedKinds` becomes empty (the machinery HEL-755 built —
  `recordUnrunnable`, the guard in `PipelineProposalService.createPipeline` — is left in place as a
  documented extension point for a future genuinely-unrunnable kind, not deleted).
- Proposal-apply (`PipelineProposalService`) now reaches the ordinary `submit`/rollback path for a
  healthy `rest_api`/`sql` source instead of `recordUnrunnable`'s "blocked" outcome — HEL-755's
  fail-safe behavior is preserved for a genuinely unreachable/misconfigured source (that still fails
  via the ordinary run-failure/rollback path, unchanged).
- No wire/API shape changes — `POST /api/pipelines/:id/run`, preview, and proposal-apply all keep
  their existing request/response contracts.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-run-execution`: `POST /api/pipelines/:id/run` and step preview now execute `rest_api`/
  `sql` base sources instead of rejecting them.
- `pipeline-proposal-apply`: the "execution-unsupported source kind" rollback carve-out no longer
  applies to `rest_api`/`sql` (both now execute); a healthy proposal-apply source of either kind now
  produces a real completed run, not a blocked one.

## Impact

- `backend/src/main/scala/com/helio/domain/InProcessPipelineEngine.scala` — new `loadRows` cases.
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` — remove rejections, empty
  `SparkUnsupportedKinds`, thread a `RestApiConnector` through to the engine.
- `backend/src/main/scala/com/helio/services/PipelineProposalService.scala` — no code change
  expected (the existing guard becomes naturally unreachable for these two kinds); stale comments
  updated.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — thread the existing `connector` instance
  into `PipelineRunService`'s construction.
- `backend/src/test/scala/com/helio/api/PipelineApplyProposalRollbackSpec.scala` (lines 29-57,
  118-145) — two existing tests assert the OLD "blocked run" outcome for a healthy inline/
  existing-`sourceId` `rest_api` source; both must be updated to assert the new non-blocked,
  populated-run outcome per the modified `pipeline-proposal-apply` spec.
- `backend/src/test/scala/com/helio/api/routes/PipelineRunRoutesSpec.scala` (lines 222-228, 231-237,
  377-387) — three existing tests assert the literal categorical-rejection outcome this change
  removes, for both the full-run and preview routes; the file also needs new fixture plumbing (a
  stub `RestApiConnector` threaded into `makeRoutes`, plus a parameterized `seedDs` config) since it
  has none today — see design.md D7.
- Existing `static`/`csv`/`text`/`pdf`/`image` execution behavior is unchanged.

## Non-goals

- Spark job submission for `rest_api`/`sql` (large/scheduled runs) — this change wires the
  in-process path only, for small/interactive runs; a Spark path is a separate, larger effort.
- Incremental/streaming refresh (HEL-428) and connector-level pagination — out of scope.
- Any change to `RestApiConnector`/`SqlConnector` themselves — both already expose the `fetch`
  method this change reuses unmodified.
