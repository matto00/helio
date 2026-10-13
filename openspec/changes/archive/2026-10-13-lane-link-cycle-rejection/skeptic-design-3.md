## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD `67cf9e0e0451b781be463e82db25c57a8c8795bf`. The change dir is untracked and there are no code changes yet.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/lane-link-cycle-rejection/HEL-1521`.

- **Round-2 CR1 (task 2.4 proof could not be satisfied): resolved.**
  - D2(b) and task 2.4 now state the proof positively and scope it to the write-time lane cycle check on create, update, duplicate and reorder.
  - The required claim is narrow: `validateLaneReference` and `LaneCycleViolations.of` get their relation and sets only from `LaneCycleViolations`, and the `LaneScope` built by create, update and duplicate uses the builders in `LaneCycleViolations`.
  - The three surviving lane-aware sites from round 2 are now named as out of scope and unchanged:
    - `PipelineRootWrites` keeps `descendantStepIds`;
    - the engine's run-time check, `InProcessPipelineEngine`;
    - `PipelineCreatePreflight`, both `laneChecks` and `unresolvedLaneClientId`.
  - I checked this proof against the live call graph. It can be met without touching any non-goal code:
    - `grep -rn "ancestorChainOf|descendantStepIds|validateLaneReference|LaneScope(|LaneCycleViolations|reparentedIds"` finds lane-scope construction only at `PipelineStepCreate.scala:95-96` and `PipelineStepWrites.scala:92-93,265`.
    - The only call to `validateLaneReference` is `StepReferenceChecks.scala:58`.
    - The only use of `LaneCycleViolations` is `PipelineStepRepository.scala:916`.
    - `descendantStepIds` has one other caller, `PipelineRootWrites.scala:188`, which D2(a) explicitly lets keep it.
    - Once the lane scopes switch over, `ancestorChainOf` has no remaining caller. D2(a) allows it to delegate or to remain.
  - Design and tasks no longer disagree.

- **Round-2 non-blocking notes: adopted.**
  - D6 now says `computeAncestorIds` is used unchanged. It also says the mismatch with the picker spec scenario "non-ancestor node is selectable" is a known, pre-existing issue tracked as HEL-1543, and is not a failure of task 4.2.
  - tasks.md `## Standing Constraints` now reads `(none yet)`. That matches `CONSTRAINTS: []` in workflow-state.

- **Fresh soundness review against live code:**
  - **D1/D2 builders.** `LaneCycleViolations.of` (`LaneCycleViolations.scala:24-42`) has a private cycle-safe walk over `parentOf`/`ancestors`. `PipelineService.ancestorChainOf` (`PipelineService.scala:418-428`) includes the starting parent and stops at a missing id. An ancestor builder that takes an `Option[String]` start can reproduce both on acyclic graphs. The domain version is also cycle-safe.
  - **D4 create.** The seeds are `StepPlacement.reparentedIds(anchor, current, rootIdOfStep)` (`StepPlacement.scala:63-72`), the same derivation the descendant set already uses at `PipelineStepCreate.scala:94-95`.
    - A new step N closes a cycle exactly when its lane target depends on N.
    - The steps that depend on N are the re-parented seeds and their reverse closure.
    - Re-parenting only changes the seeds' outgoing parent edges, and a reverse closure never follows those. The closure over `current` is therefore exact.
  - **D4 duplicate.** `reparentedIds(CreateAnchor(Some(existing.id), None, false), ...)` returns `existing`'s direct children; the `rootIdOfStep` argument is unused for a `Some` anchor. This matches `spliceInsertAtInternal` (`PipelineStepWrites.scala:268`).
    - The clone copies `existing`'s lane target.
    - On an acyclic stored graph that target cannot depend on `existing`'s children: if it did, it would already depend on `existing`.
    - So duplicate rejects nothing new, and task 3.2 pins that case.
  - **D4 update.** The reverse closure from `existing` never follows `existing`'s own stored lane edge, so re-saving the current target cannot produce a false positive. Task 3.2 pins this. `UpdatePipelineStepRequest` (`PipelineStepProtocol.scala:233`) carries `position`. The update scope's `existing.parentStepId` ancestor basis is today's behaviour and is not changed by this ticket.
  - **D4 reorder.** `introduced` keeps its `(step, target)` key. The message template at `PipelineStepRepository.scala:917-919` reads `relation.describe`, so the new `DependentViaLane` describe string slots in as D3 states.
  - **Spec scenario "upstream through another lane link is not a cycle".** The server ancestor set is parent-chain only and the target is not a dependent, so the server accepts this case. That is consistent with D2.
  - **Precedence.** The order is Itself, then missing (422), then Ancestor, then Descendant, then DependentViaLane. It matches the current `validateLaneReference` (`PipelineService.scala:358-371`) with one branch appended, so existing statuses and messages stay byte-identical.

- **Frontend targets exist:**
  - `secondaryInputOf` is at `laneLayout.ts:61` and `computeAncestorIds` at `laneLayout.ts:177`.
  - The picker's single `disabled` flag and its "(would create a cycle)" label are at `SecondaryInputPicker.tsx:69-82`.
  - `laneLayout.test.ts`, `SecondaryInputPicker.test.tsx` and `e2e/support/userCleanupCore.cjs` all exist.
  - D6/D7 add no new UI element and reuse the shared `Select` disabled state, as DESIGN.md requires.

- **Spec deltas:** I re-read both. They are consistent with D3/D4/D6, and `npx openspec validate lane-link-cycle-rejection --type change` printed `Change 'lane-link-cycle-rejection' is valid`.

- **AC coverage:**

  | AC | Covered by |
  |---|---|
  | AC1 | D3/D4, tasks 2.2 and 3.2 |
  | AC2 | D4 reorder, tasks 2.3 and 3.2 |
  | AC3 | D1/D2, tasks 2.1 and 2.4 |
  | AC4 | D6, task 4.2 |
  | AC5 | the spec deltas in `specs/` |
  | AC6 | tasks 1.1/1.2, 3.1, 4.1, 4.3 |

  The red-first tasks cover update, create and reorder.

- **Placeholders and contradictions:** none found. The only "TBD"-like phrase is "the executor chooses the exact signature", and D2 constrains it with a concrete requirement.

- **Product call:** the widened rule and the new wording are recorded as assumed product calls in the proposal, design D3, workflow-state `ASSUMED_PRODUCT_CALLS` and `AGENT_MERGE: false`. Per the overnight rules, I did not refute on this.

### Verdict: CONFIRM

### Non-blocking notes

- The duplicate arm in task 2.2 needs a `rootIdOfStep` argument for `reparentedIds`, which duplicate does not currently compute. Passing `Map.empty` is correct for a `Some(existing.id)` anchor. The executor should say so in a comment rather than add a DB read; D5 says no new read.
- Gate defect check (CON-160): not applicable. No evidence that depends on mtime ordering was involved.
