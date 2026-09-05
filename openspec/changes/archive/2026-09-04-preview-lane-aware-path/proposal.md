## Why

`PipelineRunService` builds the step slice it hands to the engine with a local `pathToRoot` helper that walks
`parentStepId` only. A `join`/`union`/`lookup` step whose `secondaryInput` is `{kind:"lane", stepId}` naming a
non-ancestor node therefore reaches the engine with its secondary lane missing from the slice, and
`InProcessPipelineEngine.executeTree`'s membership check fails it as `LaneReferenceError` -> **422**. The same node runs
correctly via `/run`, which topologically walks the real DAG.

Two merged specs already assert the behaviour the code cannot deliver: `pipeline-preview-api` scenario *"Preview of a
rejoin Output reflects both inputs"*, and HEL-911 engine-contract item 12 (*"Analyze / capabilities / preview. All three
operate at any node in any lane"*). This change makes those true by implementing them, rather than editing them down.

## What Changes

- Replace both copies of `pathToRoot` (in `previewStep` and `evaluateNodeRowsForBackfill`) with a single shared
  **dependency-closure** helper that follows parent edges **and** `laneDependencyOf` lane edges, transitively, to a fixed
  point — the same edge set `InProcessPipelineEngine.executeTree` and `PipelineAnalyzeService.analyzeNodes` already walk.
- The helper returns the closure; ordering stays the engine's own job (`executeTree` topo-sorts within whatever vector it
  is given), so preview stops carrying a second, drift-prone notion of order.
- Correct `pipeline-step-preview`'s requirement, which still specifies Phase-1 positional slicing ("determine its
  position K / execute steps 0 through K") — a shape the multi-lane DAG made false and which no longer describes the code.
- **Non-goals:** no change to `RuntimeGraphPath`, the run path, the engine walk, the wire contract, or any frontend file.
  No Flyway migration. No new endpoint. The `RuntimeGraphPath` scaladoc/implementation divergence over *transitive* lane
  following is reported, not fixed here.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-step-preview`: the previewed slice is the target node's transitive dependency closure over parent **and**
  lane edges, not a positional prefix `0..K`; previewing a rejoin whose secondary lane is not an ancestor returns 200
  with rejoined rows rather than 422.

## Impact

- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — both slice-construction sites.
- One new small helper (placement decided in `design.md`), reusing `InProcessPipelineEngine.laneDependencyOf`.
- Backfill correctness: `evaluateNodeRowsForBackfill` currently persists node snapshot rows from the same truncated
  slice, so a rejoin Output's stored rows are affected, not only the live preview.
- Tests: backend ScalaTest only. No browser, no e2e (a sibling run owns the shared Playwright session).
