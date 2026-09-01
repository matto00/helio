# HEL-905: P1.2 — Engine tree-walk: tails, materialized-node snapshots, per-Output dry-run previews

## Description

Row **P1.2** of HEL-903 (Pipelines & Outputs remodel). Spec section *Engine*, decisions 2, 3, 13. `InProcessPipelineEngine` (`backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala:122`) is a `steps.foldLeft(initial)` over a linear list; `PipelineRunService.onUnblockedRunSuccess → upsertFieldsFromRows` (`PipelineRunService.scala:608-777`) writes the single output type's schema. After P1.1 the step table is a tree and Outputs hang off nodes; this ticket makes the engine walk it.

**The design spec at `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md` WINS over this ticket wherever they disagree — consult it, correct the ticket, don't follow it blindly.**

## Scope

- Behind `PipelineExecutionBackend` (HEL-330): replace the fold with a **tree walk** — load the root frame; walk the trunk in order; at each node, before advancing, evaluate every tail from that node's frame (each tail is its own short fold); at every **materialized node** (>= 1 Output) persist the frame to `node_snapshots` and derive each Output's `schema` with the HEL-891 shallow union inference (`SchemaInferenceEngine.inferShallowFromJsObjects`). Non-materialized frames are never persisted.
- Dry runs walk the same tree in memory and return **per-Output preview rows** (the payload P1.3 exposes as `POST /api/pipelines/:id/preview` and P1.4 as `preview_outputs`).
- SSE run events (`PipelineRunStreamRoutes` / `usePipelineRunEvents`) report row counts **per node id**, tails included; assertion results (`pipeline_run_assertions`) are keyed by node.
- `PipelineAnalyzeService` projects schema per node (trunk and tails) so capabilities-at-node (P1.3) and proposal grounding (P1.4) can ask "what is the frame at node X".
- Disabled steps (`enabled = false`, HEL-412) are skipped in place on trunk and tails alike.
- Aggregate over an empty filtered set yields **one zero-value row**, not zero rows (absorbs HEL-744) — a metric Output off an empty filter must show 0.
- The last successful run's node snapshots are what Output thumbnails render from; no separate "optimistic preview" mechanism (absorbs HEL-334).

## Acceptance criteria

- [ ] Parity test: for every fixture pipeline with no tails, the tree walk's persisted rows and derived schema are byte-identical to the pre-P1.2 `foldLeft` output (capture the old engine's output as fixtures before deleting it — this is the red-first proof).
- [ ] Tail test: a tail off a mid-trunk step evaluates from that step's frame, not the trunk's tail frame; two Outputs on one node share one snapshot row set.
- [ ] Only materialized nodes appear in `node_snapshots` after a run.
- [ ] Dry-run preview rows for each Output equal the live-run snapshot for the same input.
- [ ] HEL-744: with an **empty** `groupBy`, `aggregate count` over zero rows returns one row with `0` and `sum`/`avg`/`min`/`max` return one row with `null` (rule stated in the step's doc comment); with a **non-empty** `groupBy` over zero rows it still returns zero rows.
- [ ] Snapshot semantics: `node_snapshots` for a materialized node are replaced atomically per successful run (latest only, no history); a failed run leaves the previous snapshot intact; a dry run persists nothing.
- [ ] SSE events carry `nodeId` and per-node row counts; a Playwright or unit test asserts tail rows arrive.
- [ ] Spark backend compiles against the new `PipelineExecutionBackend` contract; the in-process backend is the only one required to implement the walk in this ticket (Dataproc parity is HEL-238's).
- [ ] `sbt test` green; `check:scala-quality` clean.

## Phase-1 graph invariant (engine MUST enforce; the P1.5 editor prevents)

A **tail** is any child reached through a `position >= 1` edge, and everything below it. The invariant: (1) every node has **at most one child at** `position = 0` (the trunk continuation); (2) a tail node has **no children at** `position >= 1` and at most one child at `position = 0` (a tail is a straight chain); (3) tails end in >= 1 Output or are empty. A node may have any number of tails. The engine rejects a violating graph before running with a named error (`InvalidGraph: node <id> has N children at position 0`) — never silently picks one. P2.1 (HEL-911) deletes this check when lanes arrive.

## Out of scope

Branching (multiple `position = 0` children of one node) — P2.1.

## Dependencies

Blocked by P1.1 (HEL-904, merged as 2ec2a5bc). Blocks P1.3 (HEL-906).

## Hard-won context from P1.1 (from the human, verify before relying on)

1. `position` is SIBLING-SCOPED, not whole-pipeline. Trunk = child at position 0; a tail = a child at position >= 1 and its descendants. Whole-pipeline ordering comes from the `parent_step_id` chain, NOT a global `position` sort. Never write `.sortBy(_.position)` over a whole pipeline.
2. Green tests are not evidence unless you check what actually ran. Root `npm test` is `jest --passWithNoTests && npm --prefix frontend test` — inside a delivery worktree root jest finds ZERO helio-mcp tests, so `--passWithNoTests` silently passes. `check:no-credential-leak` only scans the frontend assistant surface, not test resources.
3. The backend suite is flaky under parallel execution (embedded-postgres contention, HEL-924). Never report a raw failure count as verdict — re-run failing suites in isolation, or use `sbt 'set Test/parallelExecution := false' test` for a clean number.
4. Hand-built fixtures miss real shapes. Reuse `backend/src/test/resources/db/fixtures/hel904-real-dump.sql` for data-correctness questions. Scrub any new/regenerated fixture from real data.
5. A deferral is only real if it names a task that exists and a ticket that owns it.

## UI gate

N/A for this row — backend-only change. State this explicitly rather than skipping it silently.
