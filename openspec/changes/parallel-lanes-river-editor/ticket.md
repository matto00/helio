# HEL-912: P2.2 — Editor: parallel lanes in the river, lane-aware Output rail, add-lane / rejoin affordances

## Description

Row **P2.2** of HEL-903. Spec section *Pipeline page UX* (last paragraph), decision 7: branches render as **parallel lanes in the river** that can rejoin — the user's stated reason for choosing the river over a tree view was exactly this ("you should be able to place two rows next to each other, i.e. divergent steps that could later be reconciled via joins"). P1.5 built the river with tails; this ticket generalizes tails into lanes.

## Scope

* **Lanes:** a step with several step children renders its children side by side as lanes below it; each lane is its own vertical mini-river with its own Outputs rail; lanes are laid out on a shared column grid so a rejoin step visually spans back to one column. Tails from P1.5 are just one-step lanes with an Output and keep their compact rendering.
* **Affordances:** "+ lane" on any step; "rejoin" on a lane's terminal step opens the join/union/lookup config with "other lane" selectable from the visible lanes (cycle-invalid lanes greyed with a reason); drag-reorder works within a lane; moving a step between lanes is out of scope unless trivial.
* **Analyze + previews:** per-node schema and validation errors render on every lane; per-Output thumbnails and the Outputs tab list lanes in the "off <step>" subtitle (e.g. "off filter › lane 2 › aggregate").
* **Run:** SSE row counts render per node across lanes; a failing node highlights its lane path.
* **Mobile:** lanes stack vertically with a lane header at phone widths; the ≥44px guard holds.
* Reuse the primitives from P1.5; no new state library. Keep files under the ~400-line guidance by extracting a `LaneLayout` unit.

## Acceptance criteria

- [ ] Playwright: add a lane off a filter, add an aggregate in each lane, rejoin with `union`, add a table Output on the rejoin, dry-run, see per-lane row counts and the Output thumbnail.
- [ ] Jest: layout assigns lanes to columns deterministically; rejoin picker excludes ancestor lanes; tails render identically to P1.5 snapshots.
- [ ] Mobile stacking verified at 375px/430px.
- [ ] `npm run lint` / `typecheck` / `test` green.

## Out of scope

Multi-root roots in the editor (P2.3 adds them); MCP (P2.4).

## Dependencies

Blocked by P2.1 (HEL-911, merged a45e9881, PR #541). Blocks P2.4 (HEL-914, in flight concurrently).

## Binding ground truth — P2.1 Engine contract

`openspec/changes/archive/2026-09-03-multi-lane-pipeline-engine/design.md` § "Engine contract" (12 items) is the contract this ticket is planned FROM, not re-derived. Load-bearing points:

1. Wire shape is `secondaryInput: {kind:"source",dataSourceId} | {kind:"lane",stepId}`. V97 cut over hard; the flat `otherDataSourceId`/`rightDataSourceId`/`referenceDataSourceId` shape is **INVALID, not legacy**. (Frontend already widens correctly at `useStepCardState.ts:367-381`; the UI-local narrowed view-model still names the flat fields and encodes source-kind only — that narrowed model must grow a lane-kind arm.)
2. A lane reference is a real DAG edge: topological walk, sibling `position` as tiebreak, any acyclic reference legal, cycle rejected 400 at write time.
3. A lane ref may name **any** node in another lane, and one lane may feed several rejoins — diamonds are legal. The editor must NOT assume terminal-only or single-consumer.
4. Item 6a: same-pipeline membership is a security boundary enforced at write and run time.
5. Item 6b: forward references are an **inherited request-body convention, NOT an engine limit**. The incremental `addStep`/`updateStep` path — which is what the editor uses — has **no ordering constraint**. Do not build a rightward-only restriction into the UI on the belief that the engine requires it; it does not.
6. Item 2: "trunk" is a **UI notion owned by this ticket**; the engine gives `position = 0` no structural meaning beyond ordering tiebreak.
7. Item 11: lane path format is pinned as step ids from the virtual root (`root`) to the failing step, joined by `" > "` — e.g. `root > s1 > s4 > s7`. Ids, not names; **the editor may substitute display names at render time**.
8. Item 12: analyze / capabilities / preview operate at any node in any lane; a rejoin's projected schema derives from **both** inputs.

## Constraints for this run

- Bound by `DESIGN.md` for all frontend work and `CONTRIBUTING.md` for code quality.
- **This run owns `frontend/**` only.** HEL-914 is delivering concurrently and owns `helio-mcp/**` and the proposal/patch-set paths. Any change needed outside `frontend/**` — especially `schemas/` or backend protocols — is a STOP-and-escalate, not an edit.
- Shared dev Postgres and a shared Playwright browser session with the concurrent run. Suspect contention before suspecting a product bug. A Flyway validation failure is a STOP-and-report (Applied/Resolved values), never a scratch-DB fallback.
- Related open bug HEL-966 (deleting a branching node absorbs one lane and deletes every other lane's subtree) is a backend delete-semantics defect, explicitly NOT in scope here. Do not fix it; do not build UI that depends on it being fixed.
