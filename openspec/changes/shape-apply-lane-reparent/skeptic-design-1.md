## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 41db49cee08f358a491253a1021e594b74d9dd6a (planning artifacts are untracked in the change dir).
The owner's option (b) is taken as given and not relitigated.

### What I verified (with evidence)

1. **The shared bookkeeping in Decision 2 is sound.**
   - `usePipelineStepCreation.ts:90-115` owns `pendingParentRef`, `userRemovedTempIdsRef` and `applyCreated`.
     `applyCreated` reads and deletes the claim outside the updater, and the updater's only side effect is
     an idempotent `pendingParent.set` (`applyCreatedStep.ts:92-94`). That makes it StrictMode-safe for any caller.
   - With a synthetic temp id that is never local and not in `userRemoved`, `applyCreatedStep` skips
     Case 1 (unless a concurrent sync already brought `created.id` in, which is handled correctly), skips Case 3
     (`:72`), and takes the append branch (`:80-82`). That is the same append the current hook does by hand
     (`usePipelineShapeInstantiation.ts:102`), so the array order is unchanged.
   - Repro walk-through against `applyCreatedStep`. Create 1 (sort) reports L. L is local and its chain
     L->B->A does not reach sort, so L becomes a child of sort. Create 2 (limit) reports L. The chain L->sort->B
     does not reach limit, so L becomes a child of limit. That matches the server.
   - Threading has no cycle. `usePipelineStepStructure.ts` calls `usePipelineStepCreation` (`:82`) before
     `usePipelineShapeInstantiation` (`:150`), so `applyCreated` only has to be added to the creation hook's
     return value and passed down. The design's "if threading proves impossible" escape hatch is not
     needed (see the notes).
   - `applyCreatedStep` changes only `parentStepId`/`rootId` on reparented rows and leaves `position` alone.
     That matches the backend: `spliceInsertReportingInternal` (PipelineStepRepository) updates only
     `(parentStepId, rootId, updatedAt)` on moved children (`.update((Some(newId), None, now))`). The new row
     gets `position` 0 (`newRow = PipelineStepRow(newId, ..., 0, ...)`), and the response carries `position`
     (`PipelineStepResponse.position: Int`). So after the fix, every field `buildLaneGraph` reads (parent,
     root, position, plus array order only as a tie-break in `sortSiblings`) matches the server.

2. **The MODIFIED requirement keeps every existing scenario's intent.** I compared it with
   `openspec/specs/pipeline-shape-instantiation-ui/spec.md:74-132`. All six original scenarios are still there.
   Only "Instantiating into a non-empty pipeline" changes meaning, from tail-attach to splice. The live
   text was already false: the hook has always sent `attachAsTail=false` (`usePipelineShapeInstantiation.ts:95`).
   The Output-fixture scenario's "new tail" wording becomes "seeded after that step", which is correct.
   Three scenarios are added: the lane moves below the shape, a partial apply reflects reported
   reparents, and drafts survive. "Every existing child of the anchor becomes a child of the shape's last
   step" assumes a linear expansion. That holds: `ShapeStepExpansion(kind, config)` is a plain Vector chained
   by clientId in every registered shape (TopN, PivotMatrix, Passthrough, SingleRow, TimeSeries).

3. **The test plan would be red on main.** On main, L keeps `parentStepId = B` after the apply because the
   hook ignores `reparentedStepIds` (`:101-102`). The 3.1 assertion `L<-limit` therefore fails on main.
   3.2 is also red on main (L stays under B after a partial apply). 3.3 (draft survival) passes on main by
   design. It is a guard that would catch a `syncStepsFromServer`-based "fix", because
   `usePipelineStepStructure.ts:64-70` replaces the list wholesale from the server and drops temp drafts.
   3.4 requires the real `createPipelineStep` mapping (`pipelineService.ts:140-143`, `reparentedStepIds ?? []`).

4. **The bottom "+ add step" precedent holds against the code.** `handleAddStep` calls
   `handleInsertStep(op, length)`, which sets `isAppend` and leaves `anchor` undefined. `insertWireArgs`
   (`insertAnchor.ts:48`) then returns `{ rootId }`. On the backend, `PipelineStepCreate.scala:186-210` takes
   the `(None, Some(rootId))` branch, then `resolveRootTrunkAnchor` with no position (trunk-last), then
   `spliceInsertReportingInternal`. That reparents all of trunk-last's children, lanes included (comment
   `:192-197`). Finally `applyCreated(tempStep.id, created)` runs (`usePipelineStepCreation.ts:194`).
   The backend's trunk-last (first position-0 chain) is the same node as the river's primary-lane last step
   (`stepTree.ts` continuation = the position-0 child).

5. **No other path in the shape flow drops reparent data.**
   - `PipelineRiverView.tsx` has exactly two shape triggers: the empty state (`:341-347`, anchor `undefined`)
     and the bottom row (`:488-494`, anchor = `primarySteps[last]`). Both go through `ShapePickerModal` and
     `onInstantiateShape`, which is the hook under repair.
   - The per-step "+ output" (`onAddOutput`, `OutputsRail`) opens the Output sheet, not a shape flow.
     `handleAddOutputViaAggregateTail` uses `attachAsTail: true` (never reparents) and then a full resync.
   - Lane creation uses `attachAsTail`, and drafts go through `applyCreated`.
   - The old `ShapeInstantiateStep.tsx` is gone. `expandPipelineShape` is called only from `ShapePickerModal`.
   - The empty-state trigger cannot reparent anything in practice: root 0 has no steps, so a rootId splice has
     no root-level children to move. It is covered by the same per-create apply anyway.

6. **The pre-fix symptom was re-derived from the probe, not taken from the narrative.**
   `/home/matt/Development/helio/.concertino/runs/HEL-1484/evidence/probe/HEL-1484-anchor-base.json` shows
   `serverAfter` with `L2<-limit`, and both POSTs report `["L2"]`. It also shows
   `uiAfterApply = [A, B, lane-row, tail-chain, L2, Sort, Limit]` and `uiAfterReload = [A, B, Sort, Limit, lane-row, L2]`.
   `PipelineRiverView.tsx:420-440` renders each primary step's child lanes directly after that step's card.
   So before the fix, Sort and Limit are already in the primary lane (position 0 under B). The only wrong
   thing is that L2's lane hangs off B instead of off Limit. The ticket's "shape cards render inside the lane"
   misreads a flat DOM dump. This does not change the fix, but it does matter for how the test is written
   (see the first note).

### Verdict: CONFIRM

### Non-blocking notes
- **Test 3.1's red signal must be L's placement.** On main the shape cards are not inside the lane, so an
  assertion like "Sort/Limit are not inside a lane-row" passes on main and proves nothing. The rendered
  assertion should be that L's lane-row (`aria-label="Lanes"`) sits under Limit's card, not B's, together
  with the `L<-limit` parent check. Task 3.1 already requires a recorded red run, which will catch a
  wrongly aimed assertion, but the executor should aim it correctly the first time. Also correct the "shape
  cards inside the lane" wording in proposal.md "Why" (and the ticket repro line 5) to "L's lane stays under
  B". That claim is factually wrong per item 6.
- **Decision 2's escape hatch should not be taken.** Threading has no cycle (item 1). The executor should
  add `applyCreated` to `usePipelineStepCreation`'s return value and pass it to the shape hook. A second
  hook-local `pendingParent` map would defeat the "one shared delta path" goal.
- **Synthetic temp ids must be unique per create** (for example from `makeStep`'s id scheme or a per-call
  counter) and must never be added to `userRemovedTempIdsRef`.
- **Task 2.3 misses a related stale comment.** Besides the KNOWN HAZARD blocks, `PipelineRiverView.tsx:170-175`
  says the bottom anchor is "always a leaf, so `handleInstantiateShape` resolves it to plain primary-lane
  continuation". That is false when the anchor has lanes; reword it in the same pass. The
  "Reparenting audit" trailer at `usePipelineShapeInstantiation.ts:123-128` also says "no resync is done
  here", which will no longer be true.
- **Out of scope (recorded only).** The live spec's entry-point requirement
  (`spec.md:10-35`: a per-step "+ output" menu and a gallery-tab shape entry) does not match the code,
  which has only the empty-state and bottom triggers. The proposal's non-goal correctly leaves this alone.
  It is worth a follow-up ticket.
