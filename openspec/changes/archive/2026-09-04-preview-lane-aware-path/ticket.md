# HEL-970: previewAtNode's pathToRoot never follows a rejoin's secondaryInput lane edge, so preview 422s for any non-ancestor lane rejoin

## Description

`PipelineRunService`'s local `pathToRoot` helper walks **only** `parentStepId` back to the root. It never follows a `join`/`union`/`lookup` step's `secondaryInput: {kind:"lane", stepId}` edge.

For a rejoin whose secondary lane is **not** an ancestor — the normal, intended case, and exactly what HEL-912's rejoin picker offers — the step slice handed to `backend.execute` **omits the secondary lane's steps entirely**, and the preview fails with a 422.

The same node executes **correctly** via the real `/run` path, which walks the DAG topologically (`InProcessPipelineEngine.executeTree`). Only the separate preview/backfill slicing has the gap.

**Naming correction (premise validation, 2026-09-04):** the ticket says `previewAtNode` / `previewOutputs`. The actual enclosing methods on main at `8bb88c0e` are `previewStep` (`PipelineRunService.scala:504`) and `evaluateNodeRowsForBackfill` (`:663`). Both contain a byte-identical copy of the same defective helper.

**Staleness correction (premise validation):** the ticket asserts `grep -rn "lanePath" backend/src/main/scala` returns nothing and that HEL-913 "is currently implementing" the lane-path field. Both were true at filing and are now false — HEL-913 merged (`4b953460`) and shipped `StepExecutionException.lanePath` plus a shared, already-lane-aware `RuntimeGraphPath` builder. This does not weaken the defect; it sharpens it, because a lane-aware traversal now exists in the same codebase and preview disagrees with it.

## Effect

A rejoin's Output rail chip, and its `OutputEditorSheet` preview, never show a live row count or thumbnail — although the pipeline itself runs fine and the run reports correct per-node counts. `OutputEditorSheet` goes through the identical `useOutputPreview` -> `previewOutput` path, so there is no frontend-only workaround.

## Contract this violates

HEL-911 `design.md` engine-contract item 12: *"Analyze / capabilities / preview. All three operate at any node in any lane. A rejoin's projected schema is derived from **both** of its inputs."* Preview does not. This is a conformance gap against a merged, three-ticket-binding contract, not new scope.

## Acceptance criteria

1. Previewing a rejoin step (`join` / `union` / `lookup`) whose `secondaryInput` is `{kind:"lane", stepId}` naming a step in a **different lane** (not an ancestor of the rejoin) returns **200** with the correct joined/unioned/looked-up rows — not a 422.
2. The rows and row count preview returns for that rejoin are **identical to what the real `/run` path materializes for the same node** on the same fixture. Proven by asserting produced row content/count, not by asserting a helper returned a non-empty vector.
3. The step slice preview builds agrees with the engine's own DAG walk: it is derived from the engine's actual dependency traversal (parent edges **and** lane edges, transitively) rather than a second, independently-authored traversal. Where the engine and preview previously disagreed about what a path is, the divergence is stated in `design.md` and resolved in the engine's favour.
4. The same fix covers `evaluateNodeRowsForBackfill`'s copy of the helper, or that copy is eliminated in favour of the shared one. A backfilled rejoin Output does not silently persist rows computed from a truncated slice.
5. P1.2/single-lane parity: previewing a step on a pure trunk, or a trunk-plus-tails graph with no lane reference, produces byte-identical output to before this change. Required test, not an expectation.
6. Widening result is stated explicitly: whether any other surface (analyze, capabilities, grounding, error-path addressing, `RuntimeGraphPath`) shares the same traversal defect, with evidence for whichever answer is given.
7. Cycle/self-reference safety: a lane-aware slice cannot loop or duplicate a step when a lane is consumed by more than one rejoin (diamonds are legal per HEL-911 Decision 3).

## Hard constraints (coordinator, three parallel runs)

- **No Flyway migration.** All worktrees share one dev Postgres; a migration from a parallel run poisons `flyway_schema_history`. If the fix needs a schema change, STOP and escalate.
- **No browser / Playwright.** A sibling run (HEL-968) owns the single shared Playwright session. This is backend preview logic. Escalate rather than racing it.
- **Sibling-owned areas, out of bounds:** HEL-844 owns `RestApiConnectorDriver` / `RestApiConfig.queryParams` and consumers; HEL-893 owns `SchemaInferenceEngine` and `InProcessPipelineEngine.loadCsvRowsFromBytes`; HEL-968 owns the pipeline river editor frontend.
- Do not merge. Hand the PR back to the coordinator.

## Required reading before planning

- `openspec/changes/archive/2026-09-03-multi-lane-pipeline-engine/design.md` (HEL-911) — the multi-lane walk and rejoin semantics; especially Decisions 2/3 and the numbered **Engine contract**, items 6, 8, 9, 11, 12.
- `openspec/changes/archive/2026-09-04-multi-root-pipelines/design.md` (HEL-913) — R4 (NodeKey root sentinel; supersedes item 8's keying), R5 (runtime graph path format; supersedes item 11), R10, R11.
- `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` (note: `domain/engine`, not `services/pipelines`) — already lane-aware; the in-repo model for the fix.
- `backend/src/main/scala/com/helio/domain/engine/RuntimeGraphPath.scala` — the existing shared, lane-aware path builder. Note its scaladoc claims transitive lane following ("the step **or, transitively, a step in its own chain**") while `pathOf` consults `laneDep` for the target step only. Establish which is true before building on it.
