## Context

The three step-write paths each assemble the same chain inline. All three live under `backend/src/main/scala/com/helio/services/pipelines/`.

- **Create**: `PipelineStepCreate.addStepReporting` (~L57-146) runs `aclCheckF` (`dataSourceRepo.findByIdOwned`, caller,
  404 `Data source not found: <id>`), then `laneCheckF` (`PipelineService.validateLaneReference` against the
  prospective parent's `ancestorChainOf`, with a `rootId`+`position` arm via `resolveRootTrunkAnchor`), then
  `findByIdShared` (404 `Pipeline not found`), then `requireEditorAccess` for a non-owner, then `upsertOwnershipCheckF`
  (pipeline-owner identity).
- **Update**: `PipelineStepWrites.updateStep` (~L84-120) runs the same chain with ancestors =
  `ancestorChainOf(existing.parentStepId)` and `selfId = Some(existing.id)`. The pipeline is already resolved and the
  editor is already checked before this point.
- **Duplicate**: `PipelineStepWrites.duplicateReferenceChecksF` (~L309-341, HEL-1514). Ancestors =
  `ancestorChainOf(Some(existing.id))`, and `selfId = None`.

`validateLaneReference` (PipelineService ~L348) returns 400 for self, 422 for a missing step, and 400 "would create a
cycle (it is an ancestor of this step)". `InProcessPipelineEngine.executeTree` (~L379-450) documents that a reference to
one's own DESCENDANT is caught only by `loop`'s "no ready node remains" fallback, which fails the run with
`Cyclic or unresolved lane reference among pipeline steps: ...`. The lane-rejoin spec currently *permits* any
non-ancestor at write time. That contradiction was escalated to the owner (see Planner Notes).

## Goals / Non-Goals

**Goals:** one chain implementation (AC1), pinned duplicate lane messages (AC2), a reproduced and decided
descendant-cycle audit (AC3), and a decided e2e quarantine (AC4).

**Non-Goals:** `PipelineCreateTransaction` (single-call pipeline create) and `PatchSetPipelineStepResolvers` have their
own ownership arms with different semantics. They are out of scope. The executor records in its report whether either
carries a lane check that drifts from the shared chain, and if so it is listed as a follow-up. `reorderSteps` turning a
stored reference cyclic is also out of scope.

## Decisions

**D1 - Shared chain shape.** Add `StepReferenceChecks.scala` (package `com.helio.services.pipelines`), a small class
constructed with `dataSourceRepo` (or a method on `PipelineServiceSupport` beside `upsertOwnershipCheckF`, whichever
fits the existing DI). It exposes one method in roughly this form:

```
def referenceChecksF[A](typedConfig: Any, user: AuthenticatedUser,
    laneScopeF: => Future[LaneScope],                    // evaluated only when secondaryLaneStepId is Some
    beforeUpsertF: => Future[Either[ServiceError, A]],   // create: pipeline lookup + editor check; else Right(pipeline)
    upsertOwner: A => UserId): Future[Either[ServiceError, A]]
```

`LaneScope(steps, ancestors, descendants, selfId)` feeds `validateLaneReference`. Stage order is fixed in that one
place: ownership, then lane, then `beforeUpsertF`, then upsert. This is the single site that orders those four stages;
update and duplicate settle editor/type/raw-config precedence earlier in their own callers, before this method runs,
and that earlier precedence is unchanged. A `Left` at any stage short-circuits. Create keeps its
pipeline-lookup and editor check exactly between lane and upsert, so a 404/403 still takes the same precedence. The
exact signature is the executor's call, but the stage ORDER must live in the shared method and nowhere else. No caller
may re-sequence it.

**D2 - Behaviour preservation proof (AC1).** These run unmodified and green, before and after the refactor:
`DuplicateStepReferenceChecksSpec`, `PipelineStepRoutesSpec`, `ExistenceNotLeakedRoutesSpec`,
`PipelineCreateTransactionalSpec`, `MultiRootIsolationSpec`, and every spec whose name matches `*Lane*`, `*Rejoin*`,
`*Upsert*`, `*JoinStep*Acl*`, `*StepCreate*` or `*StepWrites*`. The executor enumerates the actual list by grep and
records it. Plus mutations applied once in the shared method, each reverted after:
(a) ownership stage -> `Right`; (b) lane stage -> `Right`; (c) upsert stage -> `Right` -- each must turn at least one
existing test red on EACH of create, update and duplicate (if a stage x path has no red test, add a test first; never
edit an existing assertion). A single mutation going red on all three paths is also the evidence the paths share code.
Ordering mutations (skeptic-design-1 #1; ownership/lane/upsert never apply to the same config, so swapping those three
is unobservable and is NOT required): (d1) run `beforeUpsertF` first -- expected red on CREATE only (a viewer with an
ancestor lane gets 403 not 400; a no-access caller with a foreign source gets "Pipeline not found" not "Data source not
found"); There is no shared-method d2: upsert-after-lookup is enforced by the data dependency
(`upsertOwner: A => UserId` needs `beforeUpsertF`'s result), so no edit to the shared method can reorder it
(skeptic-design-2 #1). Instead, (d2') is a CREATE call-site mutation: drop the editor check from create's
`beforeUpsertF`. Its guard test, added first if absent, is that a viewer with an upsert target not owned by the pipeline
owner gets today's 403. Update and duplicate are expected to stay green under d1 (their precedence is settled earlier);
record that too. Add the create tests for d1/d2' first if none exists. The diff of existing spec files for AC1 must be
empty except for the AC2 message pins.

**D3 - AC2 message pins.** In `DuplicateStepReferenceChecksSpec`, each lane-check case asserts `responseAs[String]`
contains the exact message `validateLaneReference` returns: `does not exist in this pipeline` with the id for the 422,
and `would create a cycle (it is an ancestor of this step)` for the 400. Assert it for BOTH duplicate and the matching
create/update call in that test, so "same message" is a comparison, not two independent literals. Pinning is additive
assertions only.

**D4 - Descendant audit (AC3), reproduce first.** Write a failing (red) test on unmodified main code. Seed a trunk
`head -> A -> B`, then PATCH A's config to a join with lane `B`. Record today's status (expected 200), then run the
pipeline and record the run outcome (expected failure "Cyclic or unresolved lane reference"). Also probe create with
`rootId` + `position` spliced in front of B, with a lane to B. Record both outcomes in the report with the raw responses.
Then:
- If it does NOT reproduce (the run succeeds), there is no fix. Report the evidence and drop the spec delta.
- If it reproduces: (C1, assumed product call) the lane check gains a DEPENDENTS set -- every step that already
  transitively depends on the writing step via parent edges OR lane edges (skeptic-design-1 #4: the engine's Kahn walk
  treats lane links as dependencies, so A->lane X where X lanes into A's subtree is equally unrunnable). Compute it as a
  pure closure over reverse edges (children + lane referrers), next to `descendantStepIds` in `PipelineService`.
  `validateLaneReference` gains a branch: `400 "Lane reference '<id>' would create a cycle (it depends on this step)."`
  The existing self/missing/ancestor branches and messages are unchanged and keep precedence.
  - Update: seeds = `existing.id`; result excludes `existing.id`.
  - Create (skeptic-design-1 #2): seeds = the steps the insert will RE-PARENT under the new step, derived from the SAME
    anchor resolution the insert uses (`spliceInsertReportingInternal` moves every direct child of the anchor, tails
    included). Arms: `parentStepId` splice -> all children of that parent; `parentStepId` + `attachAsTail` -> none (`attachAsTail` is ignored in the `rootId`/no-anchor arms); `rootId` with
    `Some(a)` -> `a`'s children; `rootId` with `None` anchor -> that root's parentless steps; `rootId` out-of-range
    (`Left`) -> none (insert 422s anyway); plain append (no parent/root/position) -> trunk-last's children; `position k`
    without parent/root -> children of `current(k-1)`, or all root-level steps when k = 0. The executor verifies each arm
    against `persistNewStep`/`spliceInsertReportingInternal` and factors the anchor->reparented-ids derivation so the
    check and the insert cannot disagree. The re-parented steps are themselves part of the rejected set (as are
    everything depending on them via parent or lane links). Reuse the step list already fetched for the lane check
    for the closure. The roots read needed to detect the multi-root/neither-id guard is still made; that guard is not bent.
  - Create placement guard (skeptic-design-2 #2): the dependents set is EMPTY whenever `persistNewStep` would itself
    reject the placement, so today's status/message wins: an out-of-range `position` (range-check before indexing --
    never an `IndexOutOfBoundsException`/500), both `parentStepId` and `rootId` (L179-185), neither on a multi-root
    pipeline (L260-263), unknown `rootId` (L201-202), unknown `parentStepId` (L226-229). Test: out-of-range `position`
    with a lane reference still returns today's 422 and message.
  - Ancestors stay exactly as today (C2), including the pre-existing mismatch in the no-parent/no-root `position` arm
    (ancestors from trunk-last at L110-113, insert anchored at `current(index-1)` at L314) -- skeptic-design-1 #3. That
    mismatch is reported as a follow-up, not fixed here.
  - Duplicate passes an empty dependents set, preserving its behaviour: the clone takes over all of the original's
    children, so a reference into them was already cyclic on the original (stored-row case seeded at
    `DuplicateStepReferenceChecksSpec` L148-152). Note this in the report.
  - Red tests first (update descendant; update lane-transitive -- must also go red under a parent-only-closure mutation; plain-append onto trunk-last's tail; `parentStepId`
    splice; `rootId` splice), then green, plus a mutation (drop the new branch -> red). If a probe does NOT reproduce, that
    arm gets no test claim of a fix -- record the evidence instead.
- Frontend (corrected after review: the original premise, that the 400 would surface through an existing save-error
  path, was false -- join/union/lookup swallowed a rejected PATCH, so the new 400 silently lost the edit). Built:
  `onUnionChange`/`onLookupChange`/`onJoinChange` opt into `captureErrors`, the three configs render `saveError` via
  `SecondaryInputPicker`, and the picker disables dependents (`computeDependentIds` in `laneLayout.ts`, parent and lane
  edges, mirroring `StepPlacement.dependentStepIds`) with the "would create a cycle" text. The `pipeline-lane-rejoin-picker`
  spec carries a MODIFIED delta.

**D5 - e2e (AC4).** The spec's `getByRole("button", {name: "Add tail step"})` matches nothing in `frontend/src`. HEL-943
(#528) reworked the tail affordance. Determine the current accessible name and the flow. If the four tests' behaviour
still exists and only locators or the flow are stale, update the spec to the current affordance without weakening an
assertion. Run it 3 times consecutively (must be 3/3 green) against this lane's own dev/backend ports. Remove it from
`testIgnore` and the comment in `playwright.config.ts`. Report HEL-962 as fixable-by-this-PR; the orchestrator closes
it after merge. If any test needs a behaviour that no longer exists, or fails for a product reason, leave the quarantine
and the tickets untouched and report why.

## Risks / Trade-offs

- A lazy `laneScopeF` changes WHEN the step list is fetched (create used to start it eagerly). It is not observable in
  status or message. A DB failure inside the lane fetch while ownership already failed returned the ownership `Left`
  before, and still does.
- e2e runs share one browser profile with other lanes (MEMORY hazard). Use this lane's ports, a throwaway
  @example.test user, and `nice -n 19`.

## Planner Notes

- Existing-fixture hits (C3, skeptic-design-3 #1): after task 1.6, re-run EVERY spec that creates or updates a
  lane-referencing step (grep `"kind":"lane"` / `laneJoin` / `lane` in test sources). Known hit:
  `services/patchsets/PatchSetUndoLaneSpec.scala` L141-145. It seeds a union under `anchor` with a lane to `L` (already
  `anchor`'s child) without `attachAsTail`, so the insert re-parents `L` under the union. That is a cyclic graph, and it
  contradicts the test's own "SIBLINGS" comment. The allowed fix is fixture-only, restoring the stated intent (e.g.
  `attachAsTail = Some(true)`), with no assertion edited. Each such hit is listed under OWNER REVIEW. If a hit cannot be
  fixed that way (its assertion depends on the cyclic shape), stop and escalate.
- Patch-set paths (skeptic-design-3 #2): `PatchSetApplyForward` (L93/L99), `PatchSetApplyRollback` (L161/L248) and
  `PatchSetUndoService` (L247/L281) call `addStep`/`updateStep` directly, so they inherit the new 400. Concretely, an
  undo/rollback that recreates a deleted step whose lane names a sibling under the same parent re-parents that sibling
  under it. Today that silently restores an unrunnable cyclic pipeline; after this change it fails with 400. Task 1.2
  probes that undo arm and records the outcome. This goes in OWNER REVIEW, and the undo-fidelity defect (recreate
  re-parents siblings) is reported as a follow-up. `PatchSetPipelineStepResolvers`' own ownership arm stays out of scope.
- The dependents check shares today's ancestor check's time-of-check/time-of-use window; the run-time engine check
  remains the backstop.
- Follow-ups to report (not fixed here): the create position-arm ancestor/anchor mismatch (#3); pre-existing
  existence-probing in create's lane check, which runs before pipeline access and reads steps via
  `listByPipelineInternal` (skeptic note); `reorderSteps` making a stored lane reference cyclic.
- PR OWNER REVIEW section must also note: with `rejectIfReparents = true`, a lane to a would-be dependent used to fail
  in the repo with `ReparentRejected`; it now gets the 400 first.
- Self-approved: the D1 helper placement, keeping duplicate's descendants empty, and leaving patch-set and single-call
  create out of scope (reported instead).
- Escalated (raised at planning, still unanswered): the descendant rejection. It amends the lane-rejoin spec's
  permission, which arguably changes what users can save. Under the owner's overnight rule (a), the reversible
  recommended option `reject-at-write` is taken as an ASSUMED product call (C1). The PR is flagged OWNER REVIEW and
  parked for the owner, and the auditor does not merge it. D4's fix branch runs if the red repro reproduces.
