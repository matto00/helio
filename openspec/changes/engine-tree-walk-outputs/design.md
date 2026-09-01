## Context

`InProcessPipelineEngine.executeWithStepCounts` folds a flat `Seq[PipelineStep]` and returns a single
`(Seq[Row], Map[String, Long])`. `PipelineExecutionBackend.execute` wraps this in `PipelineExecutionOutcome`
(single `rows`/`stepCounts`). `PipelineStepRepository` already exposes tree-aware reads (`trunkOf`,
`childrenOf`, `tailsOf`) from HEL-904 — the engine has never used them. `outputs`/`node_snapshots`
tables exist (HEL-904) but nothing writes to `node_snapshots` per-node yet — today's single write in
`PipelineRunService.onUnblockedRunSuccess` keys `node_snapshots` by the trunk's LAST step, with an
explicit comment there: "see P1.2/HEL-905 for the real per-node walk." This ticket is that seam.
`SchemaInferenceEngine.inferShallowFromJsObjects` (HEL-891) already does the shallow-union schema
derivation this ticket needs per-node, per-Output.

**Round 2 — revised after design-gate skeptic REFUTE (round 1, `skeptic-design-1.md`), which found four
of the seven original decisions asserted false things about the current code.** Every decision below
was re-verified against the cited line numbers before being restated.

## Goals / Non-Goals

**Goals:** tree-walk execution with correct tail-from-parent-frame semantics; per-node snapshot
persistence at materialized nodes only, atomic-per-node replace-on-success; per-Output schema
derivation; dry-run parity; `InvalidGraph` pre-flight validation; per-node SSE/assertion keys; correct
disabled-step splicing under a tree; empty-set aggregate fix; byte-identical parity for tail-free
pipelines; a correct tree-aware `previewStep` prefix.

**Non-goals:** branching (P2.1/HEL-911), Spark/Dataproc walk implementation (HEL-238 — Spark only
needs to compile against the changed trait), new API routes (P1.3/HEL-906), cross-node
(whole-pipeline) snapshot-write atomicity (see Decision 3 — only per-node atomicity is achievable
without a larger transactional restructuring, which is out of scope here).

## Decisions

### Decision 1 — `PipelineExecutionOutcome` gains `nodeOutcomes`, genuinely additively

Add a per-node result map alongside the existing fields, **without renaming any existing field**
(round 1 proposed `rows` -> `finalRows`, which silently breaks 5 read sites — `PipelineRunService.scala:296,445`,
`SparkJobSubmitterSpec.scala:163-164`, plus 2 construction sites — this round keeps `rows` as-is):

```scala
final case class NodeOutcome(rows: Seq[Row], rowCount: Long)
final case class PipelineExecutionOutcome(
  rows: Seq[Row],                                    // UNCHANGED: trunk's terminal frame
  stepCounts: Map[String, Long],                      // UNCHANGED: per-step row count, trunk + tails
  sourceRowCount: Long,                               // UNCHANGED
  primaryStats: SourceReadStats,                      // UNCHANGED
  nodeOutcomes: Map[Option[String], NodeOutcome] = Map.empty // NEW, additive: every evaluated
                                                       // materialized node's frame, keyed by step id
                                                       // string (None = pipeline root, mirrors
                                                       // outputs.node_step_id's NULL = root convention)
)
```

Because `nodeOutcomes` defaults to `Map.empty` and every other field is untouched, `InProcessExecutionBackend`
is the only mandatory update; `SparkJobSubmitter`'s existing construction site keeps compiling
unmodified (it simply never populates `nodeOutcomes` — consistent with HEL-238 being out of scope).

### Decision 2 — Tree walk shape, tail-parent association, and root-level tails

Do not drive the walk from `tailsOf(steps)`'s flat `Vector[Vector[PipelineStep]]` (it carries no
parent key). Instead, at each node (including the pipeline root, `parent = None`), use
`childrenOf(steps, node)` — already parent-keyed — partitioned into the trunk child (`position == 0`,
at most one) and tail roots (`position >= 1`, any number):

1. Validate the Phase-1 invariant up front over the *entire* tree (see Decision 8) before evaluating
   anything.
2. Treat the pipeline root as just another node in the walk: its frame is the loaded source rows.
   Evaluate the root's own tail roots (`childrenOf(steps, None).filter(_.position >= 1)`) from the
   source frame — this resolves round 1's open question about root-level tails: they are ordinary
   tails of the root node, not an `InvalidGraph` case, and not a special-cased no-op.
3. Walk the trunk (`trunkOf(steps)`) in order, reusing the existing fold body verbatim per trunk
   segment (this is what preserves byte-identical parity for a tail-free pipeline — see Decision 9).
4. At each trunk node (root included), before advancing to that node's trunk child, evaluate every
   tail root at that node (from step 2's or the equivalent per-node `childrenOf` filter) as its own
   independent short `foldLeft`, seeded with that node's current frame — never threaded into the
   trunk's continuation, and independent of any sibling tail.
5. Record a `NodeOutcome` for the terminal node of every tail (last step's frame) and for every
   trunk node, keyed as in Decision 1; a **materialized** node is one carrying >= 1 `outputs` row
   (looked up via `OutputRepository.listByPipelineInternal` before or during the walk) — only
   materialized nodes are candidates for the Decision 3/4 persistence step, though `nodeOutcomes`
   itself may carry entries for non-materialized nodes too (harmless, never persisted).

### Decision 3 — Snapshot persistence: per-node atomic replace, sequenced after a successful walk

`PipelineRunService.onUnblockedRunSuccess` (verified: lines 611-700) is **not** a single transaction —
it is a fan-out of independent `Future`s, each repo call carrying its own
`ctx.withSystemContext(...transactionally)` (confirmed for `NodeSnapshotRepository.overwriteRows`,
lines 37-54). There is no ambient transaction to piggyback on. The achievable guarantee, stated
explicitly:

- **Per-node atomicity**: each materialized node's `node_snapshots` replacement uses
  `NodeSnapshotRepository.overwriteRows`'s existing delete-then-insert-in-one-transaction, called once
  per materialized node, sequenced only after the entire in-memory tree walk has completed
  successfully (mirroring today's single-node call site's existing "whole run succeeds or fails as a
  unit before any write happens" behavior — that part is unchanged).
- **Cross-node atomicity is explicitly NOT provided** — if node A's overwrite succeeds and node B's
  then fails (e.g. a transient DB error), A is left updated and B is left with its prior snapshot.
  This is a stated non-goal for this ticket (see Non-Goals above), not silently glossed over. The
  spec delta's "replaced atomically" scenario is worded per-node accordingly (see specs section).
- These writes go through `ctx.withSystemContext` (the RLS-bypassing privileged pool), same as today
  — `node_snapshots`'s real owner-scoped RLS policies (`V94:165-183`) are never exercised on this
  write path, exactly as they are not today.
- A failed run never reaches this step (the walk's `Future` fails before any node write is attempted),
  so every materialized node's prior snapshot is left untouched for free.

### Decision 4 — Per-Output schema derivation

For each materialized node, for each Output attached to it (`outputs` filtered by `node_step_id`),
call `SchemaInferenceEngine.inferShallowFromJsObjects` on that node's row set (converting its
`Seq[InferredField]` result to the `Vector[SchemaField]` `OutputRepository.updateSchemaInternal`
expects — name this conversion explicitly in the executor's code, do not leave it to be discovered
mid-edit) and write the result to `outputs.schema`. Two Outputs on the same node get independently
derived (but identical, since same input rows) schemas — no sharing/caching needed at this scale (row
sets are already capped by `maxRunRows`).

### Decision 5 — Dry run and the corrected `previewStep` prefix

Dry run and step-preview are two distinct existing call sites that both need tree-awareness:

- **Dry run** (`isDry` full-pipeline run): walk the full tree exactly as a live run does (Decision 2),
  but skip Decision 3/4 (no snapshot writes, no schema writes); collect `NodeOutcome.rows` for every
  materialized node into `PipelineExecutionOutcome.nodeOutcomes` (Decision 1). Same walk function as
  the live-run path; a `persist: Boolean` parameter (or equivalent branch) distinguishes the two call
  sites so the walk logic itself is never duplicated.
  **Wire-contract scope, stated explicitly (round 2 CR3 fix): this ticket changes the ENGINE's return
  value only** (`nodeOutcomes`, additive per Decision 1) — it does NOT change
  `POST /api/pipelines/:id/run?dry=true`'s existing HTTP response shape
  (`pipeline-run-execution/spec.md:69`'s `{ rows: [...], rowCount: N }` is untouched by this ticket).
  "Per-Output preview rows" in this ticket's AC and in the `pipeline-execution` spec delta means
  "available on `PipelineExecutionOutcome.nodeOutcomes` for a caller to read," not "exposed over
  HTTP." Exposing it as `POST /api/pipelines/:id/preview`'s per-Output response body is explicitly
  P1.3's job (HEL-906, already named as this ticket's Non-Goal) — that ticket will add its own
  `schemas/`/OpenAPI delta when it does.
- **`previewStep`** (single-step-prefix preview, `PipelineRunService.scala:281`): today's
  `sortedSteps.take(k + 1)` is **already wrong** under `executionOrder`, which (verified,
  `PipelineStepRepository.scala:583-588`) emits a node's tails BEFORE continuing the trunk — so
  previewing a trunk step downstream of a tailed node currently folds that unrelated tail's steps
  into the "prefix." This ticket corrects it: the previewed prefix for a target step is **the path
  from the pipeline root to that step**, following whichever branch (trunk, or the specific tail
  chain) the target actually sits on — never a positional slice over `executionOrder`. Derive this
  path by walking `parentStepId` pointers from the target step back to the root, then evaluating that
  chain (root frame -> ... -> target) with the existing per-step fold body, exactly as it evaluates
  each trunk segment in Decision 2.

### Decision 6 — SSE / assertions per-node (round 3: frontend correction)

**Round 1 was wrong that a per-step SSE emission point already exists.** Verified: the only publishes
are the six lifecycle events in `PipelineRunService` (`queued`/`running`/`failed`/`dry_run`/`succeeded`,
lines 430/440/465/539/595/622); `RunStatusEvent` (`PipelineRunRegistry.scala:15-24`) has no step/node
id, and the engine has no publisher handle at all today. This ticket adds:

- A new **non-terminal** `RunStatusEvent` status value, `"node-progress"`, carrying new optional
  `nodeId: Option[String]` and reusing the existing `rowCount: Option[Int]` field. It is deliberately
  **not** added to `RunStatusEvent.TerminalStatuses` (`PipelineRunRegistry.scala:24`) — the SSE stream
  must stay open across it.
- A progress-callback parameter threaded through `PipelineExecutionBackend.execute` (an additional
  parameter, `onNodeProgress: (nodeId: Option[String], rowCount: Long) => Unit`, defaulted to a no-op
  so every existing call site keeps compiling) that the tree walk invokes once per node as it
  completes. `PipelineRunService` supplies the real implementation (`publish(pidStr,
  RunStatusEvent("node-progress", nodeId = ..., rowCount = ...))`); `SparkJobSubmitter` (no per-node
  concept) simply never calls it — same "leave untouched" convention the trait doc comment already
  states for `assertionSink`/`truncationSink`.
- `pipeline_run_assertions.step_id` already exists (`V84__pipeline_run_assertions.sql:19-31`, `step_id
  TEXT NOT NULL`) and tail steps already have distinct ids in the tree — **task 6.3 is a no-op**, since
  assertion results are already keyed correctly by virtue of carrying the evaluating step's own id.
  Stated explicitly here so no needless migration or schema change is attempted.

**Round 2's REFUTE caught a genuine false-against-code frontend claim, corrected here.** A
`node-progress` event does NOT flow through harmlessly: `PipelineDetailFooter.tsx:165-186`'s
`displayStatus = sseData.status ?? runStatus` has five literal equality branches
(`queued`/`running`/`succeeded`/`dry_run`/`failed`) and renders nothing recognizable for
`"node-progress"` — the status pill goes blank mid-run until the next terminal event. Separately,
`:169`'s `displayRowCount = sseData.rowCount !== null ? sseData.rowCount : ...` (and the identical
preference at `PipelineDetailPage.tsx:749-752` feeding `PipelinePreviewModal`) would show a
**per-node** row count as though it were the run's own count. `usePipelineRunEvents.ts:3`'s
`SseRunStatus` is a closed union, so `RunEventsState.status` cannot even hold the new value without a
type change. This IS a required frontend change, not an optional one:

- Widen `SseRunStatus` to include `"node-progress"`.
- Add two new fields to `RunEventsState` (or an equivalent shape): `nodeId: string | null` and
  `nodeRowCount: number | null`, populated only by a `node-progress` event.
- Change `usePipelineRunEvents`'s state-update logic so a `node-progress` event does NOT overwrite
  `status` or `rowCount` (the run-level fields the footer/preview-modal already read) — it updates
  only the new per-node fields. This is the smallest change that keeps `displayStatus`/`displayRowCount`
  correct with zero changes to `PipelineDetailFooter.tsx`'s existing five-branch render logic (the
  footer simply never sees `"node-progress"` as `sseData.status`).
- `PipelineDetailFooter`/`PipelineDetailPage` MAY optionally surface the new per-node fields (e.g. "3
  of 5 nodes done") — this is a nice-to-have, not required by the ticket's AC, which only requires the
  SSE wire event to carry `nodeId`/row count and a test asserting tail-node events arrive (see task
  6.6). Do not gold-plate the UI beyond that AC.
- This makes the ticket **not** purely backend-only — task 10.7's "UI gate: N/A" is corrected below to
  reflect the one real (small) frontend surface this decision touches.

### Decision 7 — Disabled steps require a splice, not a filter

**Round 1's Decision was absent and tasks.md 6.1 asserted the opposite ("should already hold").**
Verified: `PipelineRunService.scala:242` passes `allSteps.filter(_.enabled)` to the engine today. Under
a tree, dropping a disabled mid-trunk (or mid-tail) step from the vector **orphans its children** —
their `parentStepId` points at a step no longer present in the working set, so `childrenOf`/`trunkOf`
silently truncate the pipeline at the disabled step (a correctness regression, not merely a missed
enhancement). Fix: `PipelineRunService` stops pre-filtering by `enabled` — it passes the **full**
step list (trunk + tails, disabled steps included) to `backend.execute`. The tree-walk engine itself
skips a disabled step **in place**: when the walk reaches a disabled node, it does not call
`step.evaluate`, and passes that node's *incoming* frame through unchanged to that node's own trunk
child and tail roots — i.e. the disabled node is transparent, exactly mirroring
`PipelineStepRepository.deleteInternal`'s existing delete-splice shape (`PipelineStepRepository.scala:450-465`:
re-parent the position-0 child, in this case "skip" rather than "remove") without actually rewriting
any `parentStepId`. This applies uniformly on trunk and tail nodes.

**Round 2 caught a second instance of the same bug, in a second call site (CR4).** `previewStep`
(`PipelineRunService.scala:279`) does its own `sortedSteps.take(k + 1).filter(_.enabled)` on the
sliced prefix — independent of, and not fixed by, the `:242` change above. Once Decision 5 replaces
that positional slice with a `parentStepId`-derived root-to-target path, filtering a disabled
*ancestor* out of that vector breaks the chain exactly the same way: the resolved path's own
`childrenOf`/parent-chase over a step list missing a disabled ancestor cannot find its way past the
gap. Fix identically: `previewStep` also stops pre-filtering by `enabled` on the resolved path and
relies on the engine's in-place skip (this decision's own mechanism, not a second one) — the
pre-existing, separate guard that rejects previewing a disabled step *itself*
(`PipelineRunService.scala`'s `case k if !sortedSteps(k).enabled => ... "step is disabled"`) is
unrelated and stays exactly as it is (it fires on the *target* step, not an ancestor, per task 3.5).

### Decision 8 — Phase-1 graph invariant, `InvalidGraph`

Before evaluating any step, validate over the whole tree (using `childrenOf` per node, partitioned by
`position == 0` vs `>= 1`, as in Decision 2): every node has at most one `position = 0` child; a tail
node (any node reached via a `position >= 1` edge) has no `position >= 1` children of its own. A
violation is rejected with a named `InvalidGraph` error identifying the offending node
(`InvalidGraph: node <id> has N children at position 0`), before any step evaluates — never silently
picking one child.

**Known gap (HEL-930, filed cycle 2):** this `InvalidGraph` check is enforced ONLY at the engine
layer (`InProcessPipelineEngine.validateGraph`, called from `executeTree`). The repository layer's
own `PipelineStepRepository.executionOrder`/`walk` (pre-existing, from HEL-904, untouched by this
ticket) does NOT enforce the same invariant — its `children.find(_.position == 0)` silently picks
the first match and drops a second position-0 sibling instead of raising `InvalidGraph`, contrary to
that method's own scaladoc claim of defensive handling. The two layers disagree silently. Currently
unreachable via any live write path (verified: `insertInternal`/`spliceInsertAtInternal`/
`reorderInternal` all structurally prevent creating the violating shape), so this ticket's own
`InvalidGraph` coverage (task 2.7) is not weakened by it, but a reader should not have to discover
this cross-layer gap independently — see HEL-930 for the fix.

### Decision 9 — Parity with the pre-tree-walk engine for tail-free pipelines

For a pipeline whose step tree has no tails (a pure trunk), Decision 2 step 3's trunk fold reuses the
existing fold body verbatim (same per-step config-validation-then-evaluate-then-catch shape as
`executeWithStepCounts` today) — no tail evaluation ever triggers, no disabled-step splice changes
behavior versus today's own (differently-implemented but behaviorally-filtering) skip. This is the
basis for the byte-identical parity requirement (see "Red-first proof" below) and AC1.

### Decision 10 — Empty-set aggregate fix, scoped precisely

**Round 1 misread `AggregateStep` (`AggregateStep.scala:76-105`, verified).** There is no
"skips emitting a row for an empty group" behavior today — `rows.groupBy(...)` on zero input rows
produces an empty map, hence **zero output rows for both empty and non-empty `groupBy`** as things
stand; a net-new branch is required, not a verification step. The fix is scoped to exactly one new
top-level branch, added before the existing `groupBy`-based logic, so it never touches the existing
non-empty-input behavior (including the existing `nums.sum = 0.0`-for-an-empty-numeric-set behavior
within a real, non-empty group, which stays exactly as it is today — the fixtures/parity tests must
not regress it):

```
if (rows.isEmpty && groupByFields.isEmpty) {
  // one row: count = 0L, every other requested fn = null
} else {
  // existing rows.groupBy(...) logic, completely unchanged — this already
  // yields zero output rows when rows.isEmpty && groupByFields.nonEmpty
  // (HEL-744's anti-over-fix guard; no code change needed for that arm)
}
```

### Decision 11 — Per-node schema projection belongs to `pipeline-analyze-api`, not `pipeline-execution` — DEFERRED TO HEL-906 (round 4 correction)

Round 1 placed this in the `pipeline-execution` spec delta; `pipeline-execution`'s five existing
requirements are all specifically about *output schema inference from row data*, and
`pipeline-analyze-api` already owns "per-step schemas" (`openspec/specs/pipeline-analyze-api/spec.md:48`,
"Step N's `inputSchema` SHALL equal step N-1's `outputSchema`" — itself a flat-list statement that
would need a MODIFIED delta to become tree-aware).

**Cycle-2 correction (evaluation-1.md CR4):** `PipelineAnalyzeService`'s extension to project a
schema per node (trunk and tails) — task 6.4 — was never implemented in this ticket. Shipping a spec
delta asserting tree-aware per-step schemas without the corresponding code would publish a false
requirement on archive. The `specs/pipeline-analyze-api/spec.md` delta file was therefore **deleted
from this change**; the requirement is handed to HEL-906 (P1.3, "capabilities-at-node"), which already
needs per-node schema data for its own scope and has been updated with an explicit note naming this
handoff. `PipelineAnalyzeService` in this ticket's diff is otherwise unchanged — it still projects
schema per flat step, exactly as before.

### Decision 12 — HEL-334 (no separate optimistic-preview mechanism) is satisfied by construction

Verified: no backend "optimistic preview" persistence mechanism exists to remove (the only
`optimistic` hits in the codebase are unrelated frontend UI-state optimism for step
editing/reordering — `PipelineDetailPage.tsx`). Once Decision 3/4 land, the last successful run's
`node_snapshots` *are* what an Output thumbnail reads — there is nothing else to build or delete for
this bullet. No task or spec delta is needed beyond stating this explicitly, per the ticket's own
rule 5 ("a deferral is only real if it names a task and an owning ticket" — the converse also holds:
a bullet fully satisfied by other decisions in this same design needs no task of its own, as long as
it is said out loud, which this decision does).

### Decision 13 — `executeWithStepCounts` as the parity oracle: production reachability and mutation-failure proof (cycle 2, coordinator investigation)

The "Red-first proof" section below describes capturing frozen on-disk fixtures before touching the
old engine (tasks 1.1/1.2). What actually happened: the old `executeWithStepCounts` foldLeft's
per-step body was extracted verbatim into a shared `evalOneStep` helper, reused unchanged by both
`executeWithStepCounts` (untouched otherwise) and the new `executeTree`, and a live comparison test
(`InProcessPipelineEngineTreeWalkSpec`, "AC1") asserts the two produce identical output on the same
input instead of comparing against frozen files. Two questions had to be resolved before accepting
this as sound, both investigated directly rather than assumed:

**1. Is `executeWithStepCounts` still reachable from production code, or only from tests?**
Checked every non-test caller in `backend/src/main/scala`: `execute()` (line ~117) delegates to it,
but `execute()` itself has zero production callers — `grep -rn "\.execute(" backend/src/main/scala`
shows the only real production run path is `PipelineRunService` calling
`PipelineExecutionBackend.execute(...)` (the trait method, a different signature entirely, taking a
`pipeline`/`dataSource`/`onNodeProgress`), which `InProcessExecutionBackend` implements by calling
`engine.executeTree(...)` exclusively (`InProcessExecutionBackend.scala:14` on). Every remaining
`executeWithStepCounts`/`execute` call site is in `backend/src/test/scala`. **Conclusion:
test-only.** The ticket's core scope (`InProcessExecutionBackend` uses the tree walk for every real
run) IS met — there is no live production fold left to worry about. `executeWithStepCounts`'s
Scaladoc (`InProcessPipelineEngine.scala`) now says this explicitly, so a future contributor doesn't
delete it as apparent dead code and destroy the parity proof along with it.

**2. Is the parity assertion failable by mutation, or does it pass vacuously because both sides
happen to call the same underlying code?** Demonstrated live, not asserted: in the widened AC1 test
("multi-step trunk, including a disabled step"), the tree walk's disabled-step stepCounts-skip logic
(`walkTrunk`'s `if (trunkChild.enabled) countsAfterTails.updated(...) else countsAfterTails`) was
temporarily replaced with an unconditional `.updated(...)` (removing the `enabled` check). Re-running
the suite immediately turned that specific test red — `Set("s1", "s2", "s3") contained element
"s2"` — because the mutated tree walk now produced a `stepCounts` entry for the disabled step that
the parity comparator does not expect. The mutation was then reverted and the suite re-confirmed
green. This proves the comparator is sensitive to a real behavioral divergence between the two
implementations, not merely asserting that identical code produces identical output.

**Resolution:** `executeWithStepCounts` is intentionally retained as a test-only parity oracle
(never re-added to any production call path), and the live-comparison mechanism is accepted as
methodologically sound in place of frozen on-disk fixtures. Tasks 1.1/1.2 are rewritten in tasks.md
to describe this mechanism as what was actually done, rather than left checked/unchecked against a
description that no longer matches reality.

## Spec-delta scope (design.md Decision 11 CR7 fix)

Round 1's spec deltas were `## ADDED Requirements`-only against `pipeline-execution` and
`pipeline-run-sse`, leaving contradicting existing requirements live. This round's spec files (see
`specs/` under this change) instead:
- `pipeline-run-execution`: MODIFY the position-ordering requirement (tree walk, not flat `position`
  order), MODIFY the partial-execution requirement (tree-aware prefix per Decision 5), MODIFY the
  stale "writes schema snapshot to Type Registry" requirement (which still describes
  `pipelines.output_data_type_id`/first-row inference/a `version` bump — all superseded by per-Output
  `inferShallowFromJsObjects` derivation at materialized nodes), and (round 2 CR2 fix) MODIFY the
  sibling dry-run requirement (`:69-82`, "POST /api/pipelines/:id/run?dry=true returns preview rows
  without side effects") — its own "SHALL NOT write results to the Type Registry" / "the Output's
  `fields` and `version` are unchanged" scenario directly contradicts the just-stated fact that
  `version` no longer exists; restate it in `node_snapshots`/`outputs.schema` terms (a dry run writes
  to neither) without changing the requirement's actual behavior (a dry run still has no persistence
  side effect).
- `pipeline-aggregate-op`: MODIFY "Empty groupBy collapses all rows to one" to state the zero-input-rows
  sub-case precisely (Decision 10), keeping the non-empty-input empty-groupBy behavior — and the
  anti-over-fix guard for a non-empty `groupBy` — exactly as already specified.
- `pipeline-run-sse`: MODIFY the event-enumeration requirement to include `node-progress` alongside
  the existing five, and ADD the per-node `nodeId`/row-count requirement.
- `pipeline-analyze-api`: NOT modified in this change — see Decision 11 (round 4 correction). The
  per-node schema projection requirement is deferred to HEL-906.
- `pipeline-execution`: keep only what Decision 1-5/8-10 actually add (tree walk, snapshot semantics,
  dry-run parity, `InvalidGraph`, aggregate fix) — no analyze-service requirement here.

## Final-gate plan (coordinator addition, carried forward for Phase 2's final gate)

The final gate (post-evaluator-PASS skeptic review) for this ticket fans out into parallel cold
skeptic spawns (model: opus, passed explicitly), one per axis, all part of the SAME final-gate round
(not separate budget draws):
1. Engine correctness / parity (Decision 9, AC1) — including verifying the pre-tree-walk engine's
   output was captured as fixtures BEFORE it was modified/deleted (Decision 9 / red-first proof below;
   unrecoverable if skipped).
2. Snapshot semantics (Decision 3) — materialized-only, per-node atomic replace, failed-run
   untouched, dry-run persists nothing.
3. Graph-invariant enforcement (Decision 8) — named `InvalidGraph`, never silently picks a child;
   tails evaluate from the parent's frame (Decision 2).
4. Wire/contract + SSE (Decision 1, 6) — per-node `nodeId`/row counts, assertions keyed by node, no
   contract drift on existing callers.

Evidence discipline for the executor and for whichever gate reviews the result: confirm what each
cited gate (`sbt test`, `check:scala-quality`, any frontend check) actually scans before citing it;
prove the `InvalidGraph`/snapshot/parity guards failable by mutation (back the fix out, watch red,
restore); use `backend/src/test/resources/db/fixtures/hel904-real-dump.sql` for anything shaped like a
data-correctness question; classify any backend test failure per HEL-924 rather than reporting a raw
count (prefer `sbt 'set Test/parallelExecution := false' test` for a clean number); explicitly test
BOTH arms of the empty-set aggregate rule (empty `groupBy` -> one zero/null row; non-empty `groupBy`
over zero rows -> still zero rows — the second arm is the anti-over-fix guard and a fix that only
satisfies the first arm is not correct).

## Migration / Compatibility

No further schema migration needed — `node_snapshots`/`outputs.schema` already exist from HEL-904.
This ticket is purely engine + service-layer + route-projection behavior. `PipelineExecutionOutcome`'s
new field is additive with a default, so every existing construction site
(`InProcessExecutionBackend`, `SparkJobSubmitter`, test fixtures) keeps compiling; only
`InProcessExecutionBackend` needs a real update to populate `nodeOutcomes`.

## Red-first proof (parity)

Before editing `InProcessPipelineEngine`, capture the current `foldLeft` engine's output (rows +
derived schema) for the existing fixture pipelines with no tails as fixtures on disk — this capture is
unrecoverable once the old engine is modified/deleted, per the coordinator's note above. After the
tree-walk lands, assert byte-identical equality against those captured fixtures — this is the
ticket's own AC1 and doubles as the regression guard for this refactor.
