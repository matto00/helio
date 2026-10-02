## Context

See proposal.md. Current state (verified on main e184391c):
- `PipelineRiverView` renders root 0's trunk lane inline with index-based `handleMoveUp/Down` and drag state
  (`draggedIndex/overIndex`) keyed to `firstRootId`. Roots 1.. render via `RootColumn` -> `LaneColumn`
  (`isCompact=false`), whose `StepCard`s get `onMoveUp/onMoveDown = NOOP_MOVE` (undefined) => the buttons
  render disabled; `onStepDragStart/End` are `() => {}` => the drag handle is inert. Branch lanes (child
  lanes) go through the same `LaneColumn` with the same NOOP wiring; one-step "compact" lanes render
  `isTail` cards that show no move/drag controls at all.
- `reorderLane(graph, laneId, from, to)` (stepTree.ts) is already lane- and root-generic: it relinks the lane
  and moves `rootId` with the head when `lane.parentStepId === undefined`.
- `handleReorderSteps(newOrder)` builds one trunk lane per root and sends the union; the backend
  (`PipelineService.reorderSteps` -> `reorderTrunkInternal`) requires exactly the union of every root's trunk
  ids and relinks per root.

## Goals / Non-Goals

**Goals:** make every root's trunk lane reorderable by keyboard and drag; remove `NOOP_MOVE`; lane-identifying
accessible names; focus follows the moved step; prove the contract with a non-first-root request; evidence-based
CR2 guard coverage; real-browser e2e.

**Non-Goals:** reordering branch lanes (backend does not permute them; a tail follows its trunk step);
backend changes; cross-lane/cross-root drag; changing `handleReorderSteps` payload construction.

## Decisions

1. **Lane-scoped reorder handlers, one set for all trunk lanes.** Hoist the move/drag logic in
   `PipelineRiverView` from "the primary lane" to "the trunk lane of root R": `handleMoveUp(stepId)` /
   `handleMoveDown(stepId)` locate the step's own trunk lane (`parentStepId === undefined`, any `rootId`) by
   step id instead of closing over `firstRootId`. Drag state becomes `{laneId, index}`; a drop only applies
   when the over-lane equals the dragged lane (no cross-lane drops). Root 0's rendering is unchanged.
   Alternative (separate handler set per root) rejected: duplication, and the id-lookup form keeps handler
   identity stable for the `React.memo`'d `StepCard`.
1a. **Root-0-relative sites that must change (exhaustive list for the executor to verify by grep, not trust):** the drop-indicator render (index vs lane); the per-card `onDragOver`/`onDrop` wrapper, which `LaneColumn` currently lacks; the real `stepIndex` (lane-column cards currently pass `-1`, so `onStepDragStart(stepIndex)` would report a bogus index); edge-disabling (first card's Move up, last card's Move down) in lane-column cards, which today is by `undefined` prop and must become position-aware; a drop whose over-lane differs from the dragged lane is ignored (no cross-lane/cross-root move); a one-step ROOT trunk lane renders a full (non-compact) card with both Move buttons disabled by position and a draggable handle that can only no-op.
2. **`LaneColumn` gets optional `onMoveStep`-style props (`onMoveUp/onMoveDown(stepId)`, drag start/end/over/drop)
   and a `reorderable` flag.** `RootColumn` passes them for its trunk lane and sets `reorderable`; child lanes
   pass `reorderable=false` and `StepCard` hides move/drag controls for such lanes (reusing the existing
   `isTail`-style conditional, generalised via a `hideReorder`-type prop). `NOOP_MOVE` is deleted. Branch
   lanes thus stop showing permanently disabled controls, which was the same "inert, no indication" defect.
   Alternative (leave disabled buttons on branch lanes) rejected: it preserves the confusion the ticket cites.
   The executor MUST verify no existing test depends on disabled controls in branch lanes and update such
   tests with justification.
3. **Accessible names:** `aria-label` of Move buttons becomes `Move step up in <lane label>` /
   `Move step down in <lane label>` where lane label = the root's `dataSourceName` for a root trunk lane
   (root 0 included; with a single root the label still names the source). `title` matches. Existing tests
   that query by the old exact name are updated.
3a. **Name ambiguity (accepted, bounded).** Every card in a lane shares the label `Move step up in <source>` (the position/step is conveyed by the surrounding card region, as today's identical "Move step up" labels do). Two roots may share a `dataSourceName`; in that case their lanes' labels are identical. Accepted trade-off, recorded here: the root column already carries `aria-label="Source: <name>"` as its landmark, the pre-existing HEL-968 UI does not disambiguate duplicate names either, and the e2e/component tests use distinct source names. If cheap, the executor may append the 1-based root ordinal only when two roots share a name; not required.
4. **Focus follows the moved step:** after a reorder from a Move button, focus is restored to the same
   direction button on the moved step's card (by step id, after the re-render); if that button is now disabled
   (step reached the end), focus goes to the opposite Move button, else the card's action cluster. The wrapped
   `StepCard` is `React.memo`, so the mechanism is an effect in the lane owner keyed on a `pendingFocus`
   `{stepId, direction}` ref, not a prop that busts memoisation. The button is located through a `data-step-id` attribute on the Move buttons (plus direction), not a ref passed through the memoised card. `pendingFocus` is cleared when consumed AND on every no-commit path (the `!id` early return, the CR2 refusal, a failed PUT that rolls back), so a stale value can never steal focus on a later unrelated `laneGraph` change (e.g. typing in a step editor); a component test covers this.
5. **No change to `handleReorderSteps`' payload.** Verified, not assumed: (a) contract per
   `PipelineService.reorderSteps`/`pipeline-step-reorder` spec; (b) executor MUST exercise it with a request
   from a non-first root against the real backend (curl/Playwright network capture) and show persisted order
   and unchanged ownership; (c) backend test coverage for a non-first-root-only permutation is checked, and
   added only if missing (backend gate `sbt testFull` then applies).
6. **CR2 guard coverage.** After wiring, the executor MUST determine with evidence whether any live path makes
   "root had steps, trunk lane came back empty" occur (candidate: stale `roots` closure vs `stepsRef` after a root
   is added/removed; the reorder callers all go through `reorderLane`, which carries `rootId` with the head, so
   a UI move cannot empty a trunk). Outcomes: (i) a reachable path is found => drive the test through it;
   (ii) none is reachable => do NOT fabricate: record the evidence, rewrite the code note to say the guard is
   defense-in-depth, and the orchestrator escalates the coverage question to the human with a recommendation.
   A direct call of the hook callback with a hand-built `newOrder` is a unit test of a defensive branch, not
   proof of reachability, and must be labelled as such if the human approves it.

## Risks / Trade-offs

- Hiding controls on branch lanes changes a visible affordance -> covered by spec scenario + test updates.
- Drag on desktop only (HTML5 DnD) -> keyboard Move buttons are the accessible path (existing design.md decision
  in StepCard); e2e covers keyboard; drag covered by a component test with DataTransfer events.
- Focus management under `React.memo` -> handled via effect keyed on step id, verified in e2e.
- Shared dev DB / Flyway: no migration here; e2e creates its own pipeline and deletes it by exact id.
