# Files modified — HEL-905 (P1.2: engine tree-walk, tail outputs)

## Cycle 1 (commit 913eaf88) + cycle 2 (this commit)

- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala` — `NodeOutcome`,
  `TreeWalkResult`, `InvalidGraph`, `validateGraph`, `executeTree` tree walk (root's own tails, then
  trunk fold with per-node tail evaluation); disabled-step in-place splice; cycle 2: every node in a
  tail chain (not just the terminal one) now gets a `NodeOutcome` + `onNodeProgress` firing (CR2); a
  disabled node gets no `stepCounts` entry, restoring the pre-tree-walk wire shape (CR5);
  `executeWithStepCounts`/`validateGraph` Scaladoc now states explicitly that they are test-only /
  engine-layer-only respectively (design.md Decision 13, HEL-930 cross-reference).
- `backend/src/main/scala/com/helio/domain/engine/InProcessExecutionBackend.scala` — calls
  `engine.executeTree` and populates `PipelineExecutionOutcome.nodeOutcomes`.
- `backend/src/main/scala/com/helio/domain/engine/PipelineExecutionBackend.scala` — `execute`
  signature gains an `onNodeProgress` callback parameter.
- `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunRegistry.scala` — `RunStatusEvent`
  gains `nodeId`; `"node-progress"` is a new non-terminal status.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — removed the
  disabled-step pre-filter on both the run path and `previewStep`'s resolved path; wires
  `onNodeProgress` to a `"node-progress"` SSE publish; per-node `node_snapshots`/`outputs.schema`
  persistence and per-Output dry-run preview rows; `previewStep` walks the `parentStepId` ancestor
  chain instead of a positional slice. Cycle 2: `previewStep` now reads the TARGET node's own
  `nodeOutcomes` entry instead of the trunk's terminal `outcome.rows` (CR1); alert evaluation now
  explicitly skips + `log.error`s a node with no `NodeOutcome` instead of silently falling back to
  the trunk's rows (CR3).
- `backend/src/main/scala/com/helio/domain/steps/AggregateStep.scala` — empty-`groupBy`/zero-rows
  branch (`count = 0`, every other requested fn `null`), isolated from the existing non-empty-groupBy
  path.
- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala` — no behavioral change; verified
  it still compiles against the additive `nodeOutcomes` field.
- `frontend/src/features/pipelines/hooks/usePipelineRunEvents.test.ts` — new tests for the
  `"node-progress"` handling below (undeclared in this file previously; added here before the
  Delivery squash gate, no code change).
- `frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts` — widened `SseRunStatus`, added
  `nodeId`/`nodeRowCount` state fields, routes `"node-progress"` events to only those fields. Cycle 2:
  resets `nodeId`/`nodeRowCount` on a fresh `queued`/`running` event so a prior run's per-node state
  cannot leak into a new run (evaluation-1.md non-blocking suggestion).
- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineTreeWalkSpec.scala` — new
  spec for the tree-walk contract (AC1 parity, tail-from-parent-frame semantics, `InvalidGraph`,
  disabled-step splice). Cycle 2: widened AC1 to a multi-step trunk with a disabled step and a
  failing-step attribution comparison (CR6); added the "record a NodeOutcome for every node in a
  multi-step tail chain" case (CR2 engine-level coverage).
- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineSpec.scala` — pre-existing
  suite, unaffected in substance; `executeWithStepCounts`/`execute` remain covered as the retained
  parity-oracle API.
- `backend/src/test/scala/com/helio/domain/steps/AggregateStepSpec.scala` — empty-groupBy/zero-rows
  tests, including the anti-over-fix guard and the all-null-field regression guard.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` — materialized
  -node persistence, dry-run/live-run parity, and previewStep-on-a-tail tests, all added/confirmed in
  cycle 2: the dry-run-equals-live-run test tasks.md 5.2 names (CR7); a mid-tail materialization test
  proving a NON-terminal tail node also gets its own `node_snapshots`/`outputs.schema` (CR2); and a
  `previewStep`-on-a-tail-step regression test asserting the tail's own rows, not the trunk's
  terminal frame (CR1).
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala` — cycle 2:
  added the dedicated tail-node SSE `node-progress` route test (CR8/task 6.6) and the alert
  -evaluation orphan-NodeOutcome skip test (CR3).
- `openspec/changes/engine-tree-walk-outputs/design.md` — cycle 2: new Decision 13 (parity-oracle
  production-reachability + mutation-failure proof) and a "Known gap" note under Decision 8 (HEL-930
  cross-layer `InvalidGraph` enforcement gap).
- `openspec/changes/engine-tree-walk-outputs/tasks.md` — cycle 2: rewrote 1.1/1.2 to describe the
  actual (live-comparison) parity mechanism; marked 9.4 done via the CR4 deletion decision; other
  boxes reconciled against evaluation-1.md's findings.
- `openspec/changes/engine-tree-walk-outputs/specs/pipeline-analyze-api/spec.md` — **deleted** (CR4):
  the delta asserted per-node schema projection that was never implemented (task 6.4); the
  requirement is handed to HEL-906 instead of shipping a false requirement on archive.
- `openspec/changes/engine-tree-walk-outputs/execution-progress.md` — cycle 2 wrap-up recorded.
- `openspec/changes/engine-tree-walk-outputs/evaluation-1.md` — the evaluator's cycle-1 report,
  now tracked as evidence (was untracked at the start of cycle 2).

## Cycle 3 (this commit) — skeptic-final-2.md REFUTE fix

- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` — added the
  two missing tests tasks.md 4.3/4.4 named but had no test for: "two Outputs on one node share one
  snapshot row set" and "only materialized nodes appear in node_snapshots after a run".
- `openspec/changes/engine-tree-walk-outputs/tasks.md` — 4.3/4.4 rewritten to name the actual tests.
- `openspec/changes/engine-tree-walk-outputs/execution-progress.md` — cycle 3 wrap-up recorded.

## Spinoff filed

**HEL-930** (https://linear.app/helioapp/issue/HEL-930) — `PipelineStepRepository.executionOrder`
silently drops a second position-0 sibling instead of surfacing `InvalidGraph`; pre-existing (HEL-904),
unreachable via any live write path today, not fixed in this ticket per CONTRIBUTING's refactor
discipline. (A duplicate, HEL-929, was independently filed later in cycle 2 before this note was
re-read; marked `Duplicate` of HEL-930 via a Linear issue relation.)

## PipelineAnalyzeService deferral

**HEL-906** (existing ticket, "capabilities-at-node") — added a comment naming the deferred
`PipelineAnalyzeService` per-node schema projection requirement (design.md Decision 11 / task 6.4),
since the `pipeline-analyze-api` spec delta describing it was deleted from this change (CR4).
