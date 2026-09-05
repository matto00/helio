# HEL-914: P2.4 — MCP + proposals for branching: lanes and roots in create_pipeline, workspace context, and grounding

## Description

Row **P2.4** of HEL-903 — Phase-2 close-out. Spec section *Agent / MCP surface & proposals* and *Delivery order → Phase 2*, decisions 10, 12. P1.4 gave agents a single-call `create_pipeline` for trunk + tails + outputs; P2.1–P2.3 added lanes, rejoin inputs, and roots. This ticket exposes the full graph to agents and the in-app assistant.

## Scope

* `create_pipeline` / `POST /api/pipelines`: accept a full graph — `roots[]`, `steps[]` with sibling `parentStepId`s (lanes), lane-kind secondary inputs on join/union/lookup, `outputs[]` on any node — in one transactional call. Validation errors name the node path ("roots[1] › steps[3]").
* `add_pipeline_step`: siblings allowed; `analyze_pipeline` and `preview_outputs` cover lanes; a concise mode for `analyze_pipeline` (per-node `{ path, op, validationError }`) lands here and closes the analyze half of HEL-865.
* `get_workspace_context`: pipelines list roots and a compact lane tree with outputs per node; stays under the MCP result cap on the P1.4 fixture.
* **Proposals:** `PipelineProposal` / combined proposals may propose lanes and roots; grounding evaluates each Output against the projected schema at its node across lanes (P2.1's analyze); patch sets add/remove lanes and roots with correct inverses; review pages render lanes (reuse the P2.2 `LaneLayout`).
* `docs/agent-native.md` updated with a worked multi-root example (e.g. the Sleeper "projections ⨝ ADP" board).

## Acceptance criteria

- [ ] MCP E2E: one `create_pipeline` call builds a two-root, two-lane pipeline with a `join` rejoin and three Outputs, then `place_outputs` places them; `get_workspace_context` reflects the graph.
- [ ] Proposal test: an Output on a rejoin node is grounded against the rejoin schema; patch-set undo of "add lane" removes the lane and its Outputs/placements.
- [ ] `analyze_pipeline` concise mode returns per-node paths and is under the result cap for a 40-column, 12-node graph; HEL-865 updated/closed accordingly.
- [ ] Tool-name set test updated; `docs/agent-native.md` example runs.

## Inherited from HEL-913 (product ruling, 2026-09-04)

HEL-913 (P2.3) delivered the multi-root model, but its planning over-reached: it wrote two spec deltas asserting that `PipelineProposal` SHALL carry `roots[]`, duplicating scope **this ticket** already owns. Rather than archive a canonical spec that nothing implements — a permanently-false SHALL that no gate would ever flag again — the deltas were **removed from HEL-913 and reassigned here**. Three independent reviews concurred.

**Why the intermediate state is coherent:** `PipelineProposalService` already builds a one-element `roots` vector, so a proposal today yields a well-formed **single-root** pipeline that `add_root` extends. Nothing is broken; proposals are simply limited to one root until this ticket lifts that.

**This ticket therefore owns, in addition to its original scope:**

1. The two spec deltas themselves — `pipeline-proposal-contract` ("Source is an existing reference or an inline spec" → a non-empty `roots` array; singular `source` removed, not accepted alongside) and `pipeline-proposal-apply` ("Atomic apply of a PipelineProposal" → resolve and create every root before any step; failure to resolve any root rolls back the whole apply). Both were drafted in HEL-913 and are recoverable from its run evidence at `.concertino/runs/HEL-913/evidence/openspec/changes/multi-root-pipelines/`.
2. `schemas/pipelines/pipeline-proposal.schema.json` — `source` → `roots[]` (was HEL-913 task 8.2).
3. `helio-mcp/src/tools/pipelineProposalValidation.ts` — per-root validation (was HEL-913 task 9.7).
4. The **9 correlated sites**, which are one surface rather than scattered debt: `PipelineProposalService`, `PatchSetApplyRollback`, `PatchSetUndoInverse`, `PipelineShapeProtocol`, `PatchSetPreviewProjection`, `RefinementEditShape`, `WorkspaceContextService:293`, `pipeline-proposal.schema.json`, `AssistantProposalToolSchemas.scala`.

**Read HEL-913's `design.md` "Multi-root contract" (R1-R15) before planning this** — `openspec/changes/archive/2026-09-04-multi-root-pipelines/design.md`. In particular **R5** (the runtime graph path and this ticket's `roots[1] › steps[3]` request address are **different addresses of different objects** and do not conflict — this ticket's ACs need no editing), **R13** (`rootClientId` create-time binding), **R14** (HEL-913 already emits the `roots[<i>] › steps[<i>]` request-address format; this ticket inherits it rather than defining it), and **R4**'s representation table (root membership lives in the DB and on the wire, **not** in the domain case classes; it is resolved via a threaded side-map).

## Product rulings binding on this run

* **This runs as ONE ticket.** Do not propose splitting the inherited proposal scope back out — it was deliberately consolidated here, and re-splitting would recreate the seam that caused the problem.
* **`npm run typecheck` cannot catch a wire-shape break.** The frontend's types are not compile-time-coupled to backend JSON — that is exactly how HEL-913 shipped a broken create flow with every gate green, and why HEL-969 existed. This ticket touches the proposal wire shape and `helio-mcp`, so this applies directly. Never cite a green typecheck as evidence a consumer survived.
* **Every file enumeration in this epic's tickets has been stale.** The "9 correlated sites" are a starting point; re-enumerate from the tree and prove completeness with a grep that returns zero, not a hand tally.
* **Delivery artifacts are unreviewed code.** After archiving, grep the repo for the change-directory name and require zero hits. After any `MODIFIED` spec block, recover the original from the base commit and diff it.
* Declare one path per bullet in `files-modified.md`.

## Out of scope

Templates (R1), interactive panels, cross-filtering.
