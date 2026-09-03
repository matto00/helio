# HEL-911: P2.1 — Engine: multi-child walk, "other lane" inputs for join/union/lookup, rejoin semantics

## Description

Row **P2.1** of HEL-903 (Epic — Pipelines & Outputs remodel) — the first Phase-2 ticket. Spec sections *Engine* and *Delivery order → Phase 2*, decisions 3, 7, 12. Replaces the design-gated DAG epic HEL-338 and its spike HEL-361 (both cancelled — the model is decided; there is no separate design session).

After P1.2 the engine enforces the Phase-1 graph invariant defined in HEL-905 (at most one `position = 0` child per node; tail nodes have no `position >= 1` children) with a named `InvalidGraph` error; this ticket deletes that check and generalizes the walk.

**Premise-validation correction (this run):** the Phase-1 invariant is enforced at TWO sites, not the one the ticket prose names — `InProcessPipelineEngine.validateGraph` AND `PipelineStepRepository.scala:761-767` (added by HEL-930), with `PipelineService.scala:1298` mapping the latter to an API error. All three sites are in scope.

HEL-912 (editor lanes), HEL-913 (multi-root) and HEL-914 (MCP/proposals for branching) are all planned against the engine contract this ticket defines. The contract must be stated explicitly enough to plan those three from.

## Scope

* **Multi-child walk:** any node may have several step children (lanes). The walk evaluates each lane from the parent's frame; lanes are independent until a rejoin step consumes them. Evaluation order is deterministic (sibling `position`), and per-node snapshots/schema derivation work exactly as in P1.2 for every materialized node in any lane.
* **Rejoin inputs:** `join`, `union`, `lookup` accept `{ kind: "lane", stepId }` as their secondary input alongside today's `{ kind: "source", dataSourceId }`. A rejoin step's parent is one lane; its config names the other lane's terminal step. Cycle detection rejects a lane referencing its own ancestor. `analyze` projects the rejoin schema from both lanes.
* **Trunk definition update:** "trunk" is no longer structurally special to the engine — it is a UI notion (P2.2). The engine treats the graph as a DAG rooted at the source root; the Phase-1 tail rule is deleted, not kept as a mode.
* **Analyze + capabilities:** `PipelineAnalyzeService` and `GET /api/pipelines/:id/capabilities?stepId=` work for any node in any lane; `POST /api/pipelines/:id/preview` returns per-Output previews across lanes.
* **Run reporting:** SSE and run history report per-node counts across lanes; a failing step in one lane names the lane's path (extends HEL-859's "name the failing step").
* **Dataproc/Spark backend:** contract compiles; implementing the multi-lane walk on Spark stays with HEL-238 unless trivial.

## Acceptance criteria

- [ ] Engine tests: two lanes off one node evaluate independently and rejoin via `union`; `join` between lanes produces the expected rows; a lane referencing its ancestor is rejected at write time (400 naming the cycle) and at run time (defensive).
- [ ] P1.2 parity and tail tests still pass unchanged (lanes generalize tails; no behaviour change for existing pipelines).
- [ ] Analyze projects a rejoin schema; capabilities-at-node works in a lane.
- [ ] Route specs for `parentStepId` with siblings and for lane-kind secondary inputs; `schemas/` + OpenSpec updated in the same change.
- [ ] `sbt test` green; `check:scala-quality` clean.

## Out of scope

Editor (P2.2), multi-root (P2.3), MCP/proposals (P2.4).

## Dependencies

Blocked by P1.7 (HEL-910, shipped). Blocks P2.2 (HEL-912) and P2.3 (HEL-913).

## Source of truth

The remodel spec merged in PR #498 (e30a0c72) outranks any ticket prose that predates it.
