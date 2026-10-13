## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD fe63a251886c3dfba142151afb8913fb025ef43b. The planning artifacts are uncommitted (`?? openspec/changes/step-reference-check-followups/`).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/step-reference-check-followups/HEL-1523`.
- **Artifacts are valid:**
  - `openspec validate step-reference-check-followups --strict` returned "Change ... is valid".
  - `scripts/check-openspec-hygiene.mjs` returned "openspec/ is clean".
  - The premise evidence file exists at `.concertino/runs/HEL-1523/evidence/premise-validation.md`.

- **Round-1 CR1 (task 4.1 acceptance grep): addressed.**
  - Task 4.1 now uses `grep -rn "secondaryDataSourceId(" backend/src/main/scala`.
  - I ran it today and got 5 hits: the codec definition (PipelineStepConfigCodec.scala:114), StepReferenceChecks.scala:56, PipelineCreateTransaction.scala:125, and PatchSetPipelineStepResolvers.scala:62 and :255.
  - After D5, only the first two should remain. The signal is now achievable, and it is scoped to the secondary-source check: root-source/proposal `findByIdOwned` sites are explicitly out of scope.
  - I confirmed the messages D5 promises to keep byte-identical against the source:
    - `checkOwnedSource` (L142-146): `Data source not found: <id>`
    - Patch-set L62-66 and L255-259: `edit $index: data source not found: $id`
  - D5 names the visibility problem: `StepReferenceChecks` is `private[pipelines]`, and patchsets is a sibling package. It gives a companion-object or `private[services]` option to solve it.

- **Round-1 CR2 (task 2.1's red test): addressed.** I traced the new fixture against the code:
  - `laneScopeF`'s `current` comes from `listWithRootIdsInternal`, which returns `executionOrder(...)` (PipelineStepRepository.scala L336-342). For trunk A->B->C with tail T of A, `executionOrder` (L1290-1305) gives [A, T, B, C].
  - `resolveCreateAnchor`'s bare-position arm (StepPlacement.scala L50-55) makes `position=2` anchor at `steps(1)` = T. `reparentedIds` = T's children = none.
  - **Old code** sets `prospectiveParent` to trunk-last C (PipelineStepCreate.scala L80-81). `ancestorChainOf(C)` = {C, B, A}, so a lane ref to B gets 400 "ancestor" (PipelineService.scala L365-366).
  - **New code (D3)** sets the parent to anchor T. `ancestorChainOf(T)` = {T, A}, and descendants are empty, so a lane ref to B gets 201.
  - The outcome genuinely flips. The rejection cases (lane ref to T or to A gives 400) hold on the new code.
  - The spec scenario "A bare-position create checks ancestors of its real anchor" now states the not-re-parented precondition and the outcome "the step is created".

- **Round-1 non-blocking notes: all folded in.**
  - D1 now says the in-transaction check narrows the race window but does not eliminate it.
  - D1 and task 3.1 place the single pure helper in a package the repository can reach.
  - D1 and task 3.2 require `DBIO.failed` inside `.transactionally` plus a `.recover` in `reorderSteps`, so the error is never a 500.
  - The proposal's "PUT/POST" wording is gone. Impact names only `PUT .../steps/order`.

- **Fresh review of D3:** only the bare-position arm changes. For the other arms the current `prospectiveParent` already equals `anchor.anchor`:
  - parentStepId and attachAsTail: `req.parentStepId`
  - rootId: `resolveRootTrunkAnchor`
  - bare default: trunk-last

  The fallback on a placement `Left` keeps the existing error precedence.

- **Fresh review of D4:** `referenceChecksF` (StepReferenceChecks.scala L32-48) currently runs ownership, then lane, then `beforeUpsertF`. Create passes `pipelineAccessF` as `beforeUpsertF`, so `laneScopeF` (an `*Internal`, no-ACL read) runs before access. The premise holds.
  - Moving access first means a non-grantee or viewer gets 404/403 before any step read.
  - Update and duplicate pass an already-resolved access value, so they are unaffected.
  - The spec adds a scenario requiring identical responses, and task 1.1 requires red-first.

- **Fresh review of D1/D2:** the item-1 example checks out.
  - Before the reorder, T's ancestors are {A}, so T's lane ref to C is legal.
  - Reordering to C,A,B makes C an ancestor of T.
  - The (ref, target) pair-diff "newly introduced only" rule is sound and does not strand legacy rows.
  - Returning 400 matches the lane-cycle family in `validateLaneReference`.

- **Scope:** AC1-AC6 each map to a task:
  - AC3 -> 1.x
  - AC2 -> 2.1
  - AC1 -> 3.x
  - AC6 -> 4.1
  - AC4/AC5 -> 5.x

  Items 7-9 are deferred, and the deferral is recorded consistently in ticket.md, proposal.md and design.md. HEL-1521 is excluded. No contract delta is missing: there are no schema or shape changes. The new 400 on reorder is documented in the proposal Impact and in the spec delta.

### Verdict: CONFIRM

### Non-blocking notes
- Task 2.1's "confirm execution order is [A, T, B, C] in the test itself": the order that actually matters is `listWithRootIdsInternal`'s, which is `executionOrder`. The test should assert on the list that feeds `resolveCreateAnchor`, or check placement by reading the created step's `parentStepId == T`, rather than recomputing the order independently.
- D4 also moves ownership-before-access for create: a non-grantee with a foreign secondary DataSource now gets the pipeline 404. Expect at most a handful of existing expectations to move. Each one should be noted with its reason, as D4 already requires.
- D6 / task 5.1 is characterization. If reality differs from the ticket's description, the executor must say so plainly, not adjust the ticket's wording to fit.
