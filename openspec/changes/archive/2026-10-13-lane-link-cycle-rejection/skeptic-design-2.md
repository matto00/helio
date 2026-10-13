## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `67cf9e0e0451b781be463e82db25c57a8c8795bf` (change dir untracked, no code changes yet).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/lane-link-cycle-rejection/HEL-1521`.
- **Round-1 CR2 (follow-up task): resolved.** Task 5.0 names HEL-1543. I checked Linear directly: HEL-1543 exists, has the label `Follow-up`, is `relatedTo` HEL-1521, and its description covers both false-disable cases (the step's own current lane target, and nodes that are upstream only through another step's lane link). The design Non-Goals cite it. `FOLLOWUPS_FILED: ["HEL-1543"]` is in workflow-state.
- **Round-1 CR1, second half (the `of` walk): resolved.** D2(a) now replaces `LaneCycleViolations.of`'s private `parentOf`/`ancestors` walk (`LaneCycleViolations.scala:26-34`) with shared builders that also serve `LaneScope` construction. The ancestor builder takes an `Option` start, so create's not-yet-existing step still works. That matches the live callers:
  - `ancestorChainOf` is called only from the lane scopes (`PipelineStepCreate.scala:96`, `PipelineStepWrites.scala:93,265`).
  - `descendantStepIds` is called from the lane scopes plus root removal (`PipelineRootWrites.scala:188`).
  - Side benefit: `ancestorChainOf` (`PipelineService.scala:418-428`) is not cycle-safe on a corrupt parent loop, and the domain walk is. Unifying on the cycle-safe walk is safe because both walks agree on acyclic graphs.
- **Round-1 CR1, first half (the carve-out): only partially resolved.** See CR1 below.
- **Non-blocking notes adopted:**
  - D4 now computes duplicate's dependents exactly. Seeds are the children of `existing`, through `StepPlacement.reparentedIds` with anchor `Some(existing.id)`. I confirmed that `spliceInsertAtInternal` delegates to `spliceInsertReportingInternal` (`PipelineStepRepository.scala:651-659`), and `reparentedIds` documents that it mirrors that method, so the check and the insert cannot disagree.
  - D4 has the reorder same-edge note.
  - D3 has the create wording note.
- **Closure soundness:** the engine's `isReady` (`InProcessPipelineEngine.scala:452`) requires parent and lane dependency. A reverse closure seeded at the writing step, or at create/duplicate's re-parented steps, is therefore exactly the set whose selection closes a cycle. It never follows the seed's own outgoing lane edge, so the update re-save cannot false-positive. Task 3.2 pins that case.
- **Frontend D6:** `secondaryInputOf` (`laneLayout.ts:61`) and `computeAncestorIds` (`laneLayout.ts:177-200`) are as described. `SecondaryInputPicker.tsx:69-83` uses a single `disabled` flag and the existing label suffix, so the union is a one-line change that reuses the shared `Select`.
- **Spec deltas:** I read both. They are consistent with D3/D4, and `npx openspec validate lane-link-cycle-rejection --type change` -> `Change 'lane-link-cycle-rejection' is valid`.
- **AC coverage:** AC1 -> 2.2/3.2, AC2 -> 2.3/3.2, AC3 -> 2.1/2.4, AC4 -> 4.2, AC5 -> specs, AC6 -> 1.x/3.1/4.1/4.3. Complete.
- **Product call:** recorded as assumed (proposal, workflow-state, `AGENT_MERGE: false`). Per instructions, I did not refute on this.

### Verdict: REFUTE

### Change Requests

1. **Task 2.4's grep proof still cannot be satisfied as written, and it contradicts D2.** Task 2.4 says no "ancestor/descendant/dependent builder or lane-target membership test remains outside `LaneCycleViolations`, with **exactly one** named exception: `PipelineCreatePreflight.laneChecks`". Live code has more surviving hits that the plan itself says to keep:
   - `PipelineService.descendantStepIds` plus root removal's dangling-lane check (`PipelineRootWrites.scala:188-195`, `secondaryLaneStepId(...).filter(doomedIds.contains)`). D2(a) explicitly allows `descendantStepIds` to "remain only for their non-lane callers (e.g. root removal)", so design and task disagree.
   - The engine's own run-time self/missing/ancestor relation test (`InProcessPipelineEngine.scala:377-414`, `laneViolation`). This is a second implementation of the relation, and the design Non-Goals say not to change it ("Changing the engine's run-time rejection").
   - `PipelineCreatePreflight.unresolvedLaneClientId` (`PipelineCreatePreflight.scala:172-173`). This is a lane-target membership test outside `laneChecks`.

   An executor reading 2.4 literally either moves the engine and root-removal checks into a non-goal refactor, or fails its own proof. An evaluator grepping literally would flag a fail. This is the same defect class as round-1 CR1.

   **Fix:** scope 2.4 (and the D2(b) sentence) to the write-time lane *cycle* relation for create/update/duplicate/reorder. Enumerate every allowed non-cycle-check or out-of-scope consumer by file:
   - the engine run-time check (non-goal);
   - root removal's dangling-reference check and its `descendantStepIds` use;
   - `PipelineCreatePreflight` (`laneChecks` + `unresolvedLaneClientId`, clientId-keyed, acyclic by construction).

   Alternatively, phrase the proof positively: "`validateLaneReference` and `of` both derive their relation solely from `LaneCycleViolations`' builders and classifier; `ancestorChainOf` has no remaining caller, or delegates."

### Non-blocking notes

- tasks.md still has an empty `## Standing Constraints` heading (round-1 note, not adopted). Remove it or fill it.
- The picker spec scenario "A non-ancestor node in any lane is selectable" says a node that is neither an ancestor nor a dependent is enabled. `computeAncestorIds` still disables lane-upstream nodes and the current target. That is pre-existing, and HEL-1543 tracks it. The evaluator should not fail 4.2 on it. One line in D6 pointing at HEL-1543 would pre-empt that.
- Gate defect check (CON-160): not applicable. No mtime-ordered evidence was involved.
