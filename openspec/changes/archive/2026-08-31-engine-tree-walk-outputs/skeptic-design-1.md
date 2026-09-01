## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read all planning artifacts: ticket.md, proposal.md, design.md, tasks.md, specs/pipeline-execution/spec.md, specs/pipeline-run-sse/spec.md.
- `PipelineExecutionOutcome` shape + every construction/read site: `grep -rn "PipelineExecutionOutcome" --include=*.scala` and `grep -rn "outcome\.(rows|stepCounts|sourceRowCount|primaryStats)"` — 2 construction sites (`InProcessExecutionBackend.scala:27`, `SparkJobSubmitter.scala:131`), 5 `.rows` read sites incl. `PipelineRunService.scala:296,445` and `SparkJobSubmitterSpec.scala:163-164`.
- Tree reads: `PipelineStepRepository.scala:519-592` (`trunkOf` exact `position == 0`; `childrenOf` sibling-scoped sort; `tailsOf` returns `Vector[Vector[PipelineStep]]`; `executionOrder` emits a node's tails BEFORE continuing the trunk, and appends root-level tails at the end).
- Schema: `V94__outputs_model.sql:81-183` — `outputs(node_step_id NULL = root, schema JSONB)`, `node_snapshots(pipeline_id, node_step_id NULL, row_index, data)` with the partial-unique-index pair, RLS, no run_id. Design's "no further migration needed" is correct.
- Persistence seam: `NodeSnapshotRepository.overwriteRows` (line 37-54) — its own `ctx.withSystemContext(DBIO.seq(...).transactionally)`; `OutputRepository.updateSchemaInternal` (line 151) — a separate `Future`.
- `PipelineRunService.onUnblockedRunSuccess` (lines 611-700): a set of independent `Future`s (`nodeSnapshotUpsert`, `binaryRefsUpsert`, `updateMeta`, `updateRun`, `assertionsInsert`, alert eval), NOT one DBIO transaction.
- Disabled-step handling: `PipelineRunService.scala:242` `allSteps.filter(_.enabled)`; `previewStep` at `:281` `sortedSteps.take(k + 1).filter(_.enabled)` over `listByPipelineInternal`'s `executionOrder`.
- Engine fold: `InProcessPipelineEngine.executeWithStepCounts:112-162` — no `enabled` check, no per-step event publication.
- SSE: `PipelineRunRegistry.scala:15-24` `RunStatusEvent(status, rowCount, errorLog)`; the only publish sites are `PipelineRunService.scala:430,440,465,539,595,622` (queued/running/failed/dry_run/succeeded). `frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts:124-136` closes the stream on any terminal status.
- Aggregate: `backend/src/main/scala/com/helio/domain/steps/AggregateStep.scala:76-105` — `rows.groupBy(...)` then `grouped.map`; zero input rows ⇒ empty map ⇒ zero output rows, for empty AND non-empty `groupBy`. `sum` over an empty numeric set returns `0.0` (not null).
- Assertions: `V84__pipeline_run_assertions.sql:19-31` already has a `step_id TEXT NOT NULL` column.
- Existing specs checked for conflict: `openspec/specs/pipeline-run-execution/spec.md:8` (steps "ordered ascending by `position`, applies each step in sequence") and `:185` ("Partial pipeline execution ... positions 0 through K ... slicing happens in the route handler"); `pipeline-aggregate-op/spec.md:55-80`; `pipeline-analyze-api/spec.md:48`; `pipeline-step-tree/spec.md:54`; `pipeline-execution/spec.md` (5 requirements, all about schema inference).
- `SchemaInferenceEngine.inferShallowFromJsObjects` exists (`SchemaInferenceEngine.scala:134`), returns `Seq[InferredField]`; `OutputRepository.updateSchemaInternal` takes `Vector[SchemaField]`.

### Verdict: REFUTE

The tree-walk shape and the snapshot/dry-run/invariant intent are sound, and the tree reads it leans on
really do exist with the sibling-scoped `position` semantics the ticket describes. But four of the seven
design decisions assert things about the current code that are false against ground truth, and the two
biggest are the kind that produce silently-wrong behavior rather than a compile error.

### Change Requests

1. **Disabled steps cannot be handled by list filtering under a tree — design.md has no decision for
   this and tasks.md 6.1 asserts the opposite.** Today `PipelineRunService.scala:242` passes
   `allSteps.filter(_.enabled)` to the engine. Under a tree walk, dropping a disabled mid-trunk step from
   the vector orphans its children: their `parentStepId` points at a removed step, so `childrenOf` returns
   nothing and `trunkOf` silently TRUNCATES the pipeline at the disabled step. "Skip in place" in a tree
   requires splicing (re-parent the disabled node's children onto its parent, preserving position), not
   filtering. Add a design decision specifying the splice (and where it happens — repository helper vs.
   walk-time skip, and note `PipelineStepRepository.scala:450`'s delete-splice already models the shape),
   and rewrite task 6.1: it currently says the behavior "should already hold ... verify", which is wrong.
   Add a test for a disabled step with a child on both trunk and tail.

2. **Decision 3's transaction claim is false.** `onUnblockedRunSuccess` (PipelineRunService.scala:611-700)
   is not a transaction — it is a fan-out of independent `Future`s, each repo call carrying its own
   `withSystemContext(...transactionally)`. There is no "same transaction that already marks the run
   succeeded" to write `node_snapshots` inside. State the achievable guarantee explicitly: per-node
   atomicity via `NodeSnapshotRepository.overwriteRows`'s existing delete+insert transaction, sequenced
   after the walk succeeds; cross-node atomicity (all materialized nodes replaced as one unit) is NOT
   achievable without restructuring — either scope it in with a named approach (one DBIO composed across
   nodes) or declare it a non-goal. The spec delta's "replaced atomically" scenario must be worded to match
   whichever is chosen, or it is untestable as written.

3. **Decision 6's premise is false: there is no per-step/per-node SSE emission point today.** The only
   events are the six lifecycle publishes in `PipelineRunService` (queued/running/failed/dry_run/succeeded)
   — `RunStatusEvent` has no step id, and the engine has no publisher handle at all. Satisfying the
   ticket AC "SSE events carry `nodeId` and per-node row counts" therefore requires: a new non-terminal
   event kind (name it — `usePipelineRunEvents.ts:136` closes the stream on any status in
   `TERMINAL_STATUSES`, and an unrecognised status must not be added there), a new `nodeId`/`rowCount`
   payload on `RunStatusEvent`, and a progress callback plumbed from the engine walk out to
   `PipelineRunService`'s publisher. Rewrite Decision 6 and expand task 5.1 accordingly, or descope the AC
   to a named follow-up ticket. Related: `pipeline_run_assertions.step_id` already exists
   (`V84:22`) and tail steps already have distinct ids, so task 5.2 is likely a no-op — say so explicitly
   so nobody writes a needless migration.

4. **Decision 7 misreads `AggregateStep` and its hedge points the executor at nothing.** There is no
   "skips emitting a row for a group with zero members" behavior — groups are non-empty by construction
   (`AggregateStep.scala:80-82`), and zero input rows yield an empty `groupBy` map, hence zero rows, for
   BOTH empty and non-empty `groupBy`. A net-new branch IS required; delete the "verify before assuming"
   hedge. Also decide and record one thing the spec currently leaves contradictory: `sum` over an empty
   numeric set today returns `0.0` (`case "sum" => nums.sum`, line 96), but the new spec requires `sum =
   null` for the empty-input case. If the fix is scoped to "zero input rows only", say so — otherwise an
   executor will change `sum` globally and break the existing non-empty-group behavior (and the parity
   fixtures).

5. **Decision 1 is a rename presented as additive.** `rows` → `finalRows` breaks all five read sites:
   `PipelineRunService.scala:296`, `:445`, `SparkJobSubmitterSpec.scala:163-164`, plus the two
   construction sites. Either keep the field named `rows` (genuinely additive, as the prose claims) or
   keep the rename and correct the sentence "every caller ... needs no change", enumerating the sites in
   task 2.1. As written the design contradicts itself.

6. **The walk has no way to associate a tail with its parent node, and root-level tails are unhandled.**
   `tailsOf(steps)` (PipelineStepRepository.scala:547) returns a flat `Vector[Vector[PipelineStep]]` with
   no parent key, so Decision 2 step 3's "every entry of `tailsOf(steps)` rooted at that node" is not
   expressible against the existing API. Specify the derivation (group by `tail.head.parentStepId`) or a
   new repo helper. Separately: `tailsOf` includes tails whose parent is `None` (root-level, `position >= 1`)
   — `executionOrder` handles these defensively (line 592) but Decision 2 walks only trunk nodes, so they
   would be silently dropped. Say explicitly whether a root-level tail evaluates from the raw source frame
   or is an `InvalidGraph` violation.

7. **The spec deltas conflict with existing capabilities that are not being modified.** Both delta files
   contain only `## ADDED Requirements`, leaving contradicting requirements live:
   - `pipeline-run-execution/spec.md:8` — "fetches the pipeline's steps ordered ascending by `position`,
     applies each step in sequence" directly contradicts the tree walk. Needs a `## MODIFIED Requirements`
     delta.
   - `pipeline-run-execution/spec.md:185` — "Partial pipeline execution ... positions 0 through K
     inclusive ... slicing happens in the route handler" contradicts tree-aware preview (see CR 8).
   - `pipeline-run-execution/spec.md:143` — "Successful non-dry run writes schema snapshot to Type
     Registry" still describes `pipelines.output_data_type_id` + first-row type inference + a `version`
     bump, which per-Output `inferShallowFromJsObjects` derivation replaces. Modify it.
   - `pipeline-aggregate-op/spec.md:55-80` owns aggregate semantics (including the "Empty groupBy collapses
     all rows to one" scenario); the empty-set rule belongs there as a MODIFIED delta, not solely inside
     `pipeline-execution`, or two capabilities own the same rule.
   - The per-node analyze requirement belongs to `pipeline-analyze-api` (which already has "per-step
     schemas", `:48`), not `pipeline-execution` — whose five existing requirements are all about output
     schema inference. Re-home it or justify the placement.
   - `pipeline-run-sse`'s existing requirement at `:43` enumerates the published event kinds; adding a
     per-node event requires MODIFYING it, not only adding a sibling requirement.

8. **`previewStep`'s prefix slicing is already wrong under a tree and no task owns it.**
   `PipelineRunService.scala:281` does `sortedSteps.take(k + 1)` over `listByPipelineInternal`'s
   `executionOrder`, which emits a node's tails BEFORE continuing the trunk
   (`PipelineStepRepository.scala:583-588`). So previewing a trunk step downstream of a node with a tail
   folds that unrelated tail's steps into the previewed prefix. This ticket is where the engine becomes
   tree-aware, so it must define the correct prefix ("the path from the root to the target node") and add
   a task + test. Currently Decision 5 only says the pattern "generalizes".

9. **Ticket scope bullet with no task or spec coverage:** "The last successful run's node snapshots are what
   Output thumbnails render from; no separate optimistic-preview mechanism (absorbs HEL-334)." Neither
   tasks.md nor either spec delta mentions it. Either add the task/requirement or state explicitly that it
   is satisfied by construction (nothing to build) — per the ticket's own rule 5, a deferral is only real
   if it names a task and an owning ticket.

### Non-blocking notes

- `inferShallowFromJsObjects` returns `Seq[InferredField]` but `OutputRepository.updateSchemaInternal`
  takes `Vector[SchemaField]`; Decision 4 should name the conversion so it is not discovered mid-edit.
- Ticket says "UI gate: N/A — backend-only", but task 5.4 edits `usePipelineRunEvents`. That is fine
  (no visual surface), but the design should say so rather than leaving the two statements in tension.
- `node_snapshots` writes go through `withSystemContext` (RLS-bypassing privileged pool) — worth an
  explicit line in Decision 3 that the walk's per-node writes inherit that, since the table has real
  owner-scoped RLS policies (`V94:165-183`) that will never be exercised on this path.
