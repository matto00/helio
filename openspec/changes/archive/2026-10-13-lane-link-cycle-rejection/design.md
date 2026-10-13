## Context

The engine's run-time walk (`InProcessPipelineEngine.executeTree`, `isReady`) makes a step ready only when its parent AND its `lane` target are evaluated. So the step dependency graph has an edge `s -> parent(s)` and an edge `s -> laneTarget(s)`. A lane write `a -> t` closes a cycle exactly when `t` already (transitively) depends on `a` through those edges.

Today two separate write-time checks look only at DIRECT relations (self, parent-chain ancestor, parent-chain descendant):
- `PipelineService.validateLaneReference` (create, update, duplicate via `StepReferenceChecks.referenceChecksF` and the `LaneScope` each caller builds);
- `domain.pipelines.LaneCycleViolations.of/introduced` (trunk reorder, HEL-1523), whose scaladoc defers cycles THROUGH lane links to this ticket.

So `a` lanes to `x`, `x` lanes to a descendant of `a`, is accepted and every run fails. HEL-1515 built the dependents closure and the picker change; the owner cut them pending a product call. HEL-1523's design.md risk note: "keep the lane-cycle helper single and pure so HEL-1521 can extend it."

## Goals / Non-Goals

**Goals:**
- Reject every lane write that would close a cycle in the step dependency graph (parent + lane edges), on create, update, duplicate and reorder.
- ONE pure implementation of "how does lane target `t` relate to writing step `a`" in `com.helio.domain.pipelines.LaneCycleViolations`, used by both `validateLaneReference` and the reorder check.
- Picker disables exactly those additional choices.

**Non-Goals:**
- HEL-1542 items (rejected-choice display, raw UUID in messages, `saveErrorIsValidation` for join/union/lookup, `hel908-tail-attach`, "dependent"->"descendant" wording in old comments). Do not touch those.
- The picker's existing "ancestor" set (`computeAncestorIds`, an UPSTREAM closure over parent and lane edges, which includes the step's own current lane target and nodes upstream only through another step's lane link). It is broader than what the server rejects; narrowing it is a behaviour change outside this ticket -> filed as HEL-1543 (Follow-up, relatedTo HEL-1521), not here.
- Pipeline create (`PipelineCreatePreflight.laneChecks`): its lane references must name an EARLIER clientId and parents must be earlier, so the request graph is acyclic by construction; no change.
- Changing the engine's run-time rejection.
- No migration.

## Decisions

### D1. The closure: dependents over reverse edges, in the domain object
Add to `LaneCycleViolations` a pure, cycle-safe function `dependentsOf(seeds: Set[String], steps: Vector[PipelineStep]): Set[String]` = the reverse-edge closure starting at `seeds` (a step is added when its parent OR its lane target is already in the set), INCLUDING the seeds. Visited-set walk, so a corrupt/legacy cyclic graph cannot hang it. `PipelineService.descendantStepIds` stays (parent-only; used by root removal and still needed to tell a descendant from a lane-linked dependent).

### D2. Relation classification lives in one place, precedence unchanged
Extend `LaneCycleViolations.Relation` with `DependentViaLane` (describe: `"a step that depends on it through a lane link"`). One pure classifier is the single source of the relation for every caller, e.g. `relationOf(target, selfId: Option[String], ancestors: Set[String], descendants: Set[String], dependents: Set[String]): Option[Relation]` with precedence Itself > Ancestor > Descendant > DependentViaLane. `of(steps)` computes those sets per lane-bearing step and calls the classifier; `validateLaneReference` maps the classifier's result to its existing messages (missing-step 422 check stays where it is, between self and ancestor, so status precedence is byte-identical for every pre-existing case). The executor chooses the exact signature; the requirement is that no second implementation of the relation remains. Concretely: (a) the relation sets used for lane checks (ancestor chain, parent-chain descendants, dependents) are each computed by ONE builder that lives in `LaneCycleViolations` and is used both by `of` (reorder) and by the `LaneScope` construction in create/update/duplicate -- `of`'s private `parentOf`/`ancestors` walk is replaced by those builders (an ancestor builder taking a starting parent `Option[String]`, so create's not-yet-existing step works); `PipelineService.ancestorChainOf`/`descendantStepIds` either delegate to them or remain only for their non-lane callers (e.g. root removal); (b) the proof is stated POSITIVELY and is scoped to the WRITE-TIME LANE CYCLE CHECK on create, update, duplicate and reorder only: `validateLaneReference` and `LaneCycleViolations.of` obtain the relation (and the sets it is computed from) ONLY from `LaneCycleViolations`. Nothing else is required to change; lane-related code outside that check is out of scope and stays as it is -- explicitly including root removal's dangling-lane check (`PipelineRootWrites`, which keeps `descendantStepIds`), the engine's run-time check (`InProcessPipelineEngine`), and single-call pipeline create (`PipelineCreatePreflight.laneChecks` / `unresolvedLaneClientId`).

### D3. Messages (assumed product call -- OWNER REVIEW)
- Create/update/duplicate, lane-linked dependent that is NOT a parent-chain descendant: `400 "Lane reference '<id>' would create a cycle (it depends on this step through a lane link)."`
- On create the wording describes the relationship the insert would produce (the target would depend on the new step); the OWNER REVIEW note says so explicitly.
- Every existing message (self, missing 422, ancestor, descendant) is unchanged, character for character. A parent-chain descendant keeps the owner-ruled descendant message even though it is also a dependent.
- Reorder: the existing template, with the new relation's `describe`: `Reorder would create a cycle: step '<ref>' has a lane reference to '<target>', which would be a step that depends on it through a lane link.`

### D4. Scope per write path
- **Update:** `LaneScope.dependents = dependentsOf(Set(existing.id), current) - existing.id`; `descendants` as today. Note: the closure must be computed over the graph WITHOUT the step's own outgoing lane edge being relevant -- a reverse-edge closure from `existing` never follows `existing`'s outgoing edges, so the stored (about-to-be-replaced) config cannot produce a false positive. A test pins this (re-saving `a` with its current, valid lane target still succeeds).
- **Create:** seeds = `StepPlacement.reparentedIds(anchor, current, rootIdOfStep)` (the same derivation the descendant set uses today, PipelineStepCreate.scala ~L94); `dependents = dependentsOf(seeds, current)`; empty when placement resolution fails (today's behaviour for descendants).
- **Duplicate:** the clone is spliced as `existing`'s trunk-continuation child and takes over all of `existing`'s children (`spliceInsertAtInternal` with anchor `existing.id`). Compute it exactly rather than arguing it away: seeds = the steps that splice re-parents (derived from the same anchor logic the insert uses -- reuse `StepPlacement.reparentedIds` or the equivalent for a `Some(existing.id)` anchor), `dependents = dependentsOf(seeds, current)`, descendants = parent-only closure of the same seeds. On an acyclic stored graph this never rejects a duplicate that succeeds today (anything depending on the clone depended on `existing` before); a test pins that duplicate of a valid lane step still succeeds.
- **Reorder:** `of(steps)` includes `DependentViaLane` per lane-bearing step (dependents of `{s}`, minus `s`); `introduced` stays keyed on `(step, target)` so a pre-existing cycle never blocks an unrelated reorder (HEL-1523 D1 semantics). Known, accepted consequence: a reorder on a graph that ALREADY has a violation on lane edge `(s, t)` is not blocked even if it changes which relation that same edge has (e.g. breaks one cycle and forms another through the same edge); the graph was already unrunnable and the run-time rejection still covers it. Not a gap for AC2.

### D5. `LaneScope` gains `dependents`
`LaneScope(steps, ancestors, descendants, dependents, selfId)`. `StepReferenceChecks.laneCheckF` passes it through. Laziness of `laneScopeF` (HEL-1515) is preserved: no new read; the closure reuses the step list already fetched.

### D6. Frontend mirror
`computeDependentIds(steps, stepId): Set<string>` in `laneLayout.ts`: reverse closure over `parentStepId` and lane `secondaryInput` (via the existing `secondaryInputOf`), excluding `stepId`, visited-set. `SecondaryInputPicker` disables `ancestorIds ∪ dependentIds` (the existing `computeAncestorIds` is used unchanged -- it is broader than the server's ancestor set, which the picker spec's "non-ancestor node is selectable" scenario reads against; that mismatch is pre-existing and tracked as HEL-1543, not a task 4.2 failure) with the existing label suffix `(would create a cycle)` -- same wording, same `Select` disabled-option mechanism, no new UI element, no new style (DESIGN.md: reuse the shared component and its existing disabled state). Unit tests in `laneLayout.test.ts` (descendant, lane-linked dependent, diamond, cycle-safe on a legacy cyclic graph) and a picker test.

### D7. e2e
One Playwright spec (`e2e/hel1521-lane-picker-dependents.spec.ts`) that builds a pipeline via the API with a lane-linked dependent, opens the configuring step's picker and asserts the dependent and a descendant are disabled with the cycle text while an unrelated node is enabled. Throwaway `@example.test` user only, deleted by exact (id, email) via `e2e/support/userCleanupCore.cjs` `buildUserDeleteSql`; follow the repo's existing e2e patterns.

## Risks / Trade-offs

- [Product scope: "descendant" rule widened to "anything that depends on this step"] -> the ticket asks for the owner's call; under the overnight rules this is an assumed product call, the PR carries an OWNER REVIEW section and is parked unmerged.
- [Wider 400 on existing endpoints] -> only for writes that produce a graph no run can ever schedule; clients already show a rejected lane save inline (HEL-1515 captureErrors).
- [Closure cost] -> O(steps x edges) per check on pipelines of tens of steps; reorder does it per lane-bearing step; acceptable. The reorder check runs inside the transaction already (HEL-1523).
- [Residual race] -> unchanged from HEL-1523 D1 (READ COMMITTED, no row locks); the run-time rejection is the backstop.

## Open Questions

None that change what gets built. Assumed product calls (widened rule, new wording) are recorded in proposal.md and go to OWNER REVIEW.
