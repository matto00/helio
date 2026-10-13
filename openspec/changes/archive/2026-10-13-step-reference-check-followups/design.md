## Context

HEL-1515 (#974, 7359a676a) introduced `StepReferenceChecks.referenceChecksF`, the one chain step create/update/duplicate share: secondary-source ownership (caller) -> `lane` reference -> `beforeUpsertF` (create: pipeline lookup + editor check) -> upsert-target ownership (pipeline owner). Re-verified on fe63a2518 (evidence: `.concertino/runs/HEL-1523/evidence/premise-validation.md`):

- `PipelineStepWrites.reorderSteps` -> `PipelineStepRepository.reorderTrunkInternal` relinks trunk parents with no lane check. Example: trunk `A -> B -> C`; a tail `T` of `A` with a lane ref to `C` is legal (C is neither ancestor nor descendant of T). Reorder to `C, A, B`: now `C` is an ancestor of `A` and so of `T` -> stored cycle the create/update checks would refuse.
- `PipelineStepCreate.laneScopeF` resolves `prospectiveParent` as `req.parentStepId` else trunk-last, while `StepPlacement.resolveCreateAnchor` anchors a bare `position` at `current(position - 1)` (the comment there admits the mismatch).
- Create passes the pipeline access check as `beforeUpsertF`, i.e. AFTER `laneCheckF`. `laneScopeF` reads the pipeline's steps through `*Internal` (no ACL) reads, so for a pipeline the caller cannot see: lane ref to a nonexistent id -> `422 "... does not exist in this pipeline."`; lane ref to an existing non-ancestor step -> passes, then `404 Pipeline not found`; to the trunk-last step or its ancestors -> `400 ... ancestor`. Three distinguishable answers = an existence/structure probe on another user's pipeline.
- `PipelineCreateTransaction` (`checkOwnedSource`, ~L125/L144) and `PatchSetPipelineStepResolvers` (update ~L62, `authorizeSecondSourceForCreate` ~L255) each inline `secondaryDataSourceId` + `findByIdOwned`.

## Goals / Non-Goals

**Goals:** ticket items 1-6 (see ticket.md AC1-AC6).

**Non-Goals:**
- Items 7 (picker polish), 8 (`hel908-tail-attach` e2e), 9 (wording) -> one Follow-up ticket (assumed scope call, driver-authorized).
- HEL-1521: cycles THROUGH lane links (multi-hop: A lanes to B, B's chain lanes to A). This change checks only the direct relation the HEL-1515 rule defines: a step's lane target vs. that step's own ancestors/descendants/self.
- Changing rollback/undo behaviour for deleted tail-adjacent lane steps (item 4 is a pin, not a fix; if the pinned outcome looks wrong, that is a follow-up, not this change).
- No frontend, no migration.

## Decisions

### D1. Reorder lane check lives inside `reorderTrunkInternal`'s transaction, against the post-update rows
After the relink `updates` run and `finalRows` are read (same `transactionally` action), compute lane-cycle violations over `finalRows` and over the pre-update `steps`; if `after -- before` is non-empty, fail the DBIO so the transaction rolls back. Rationale: the existing reorder already re-derives everything from a fresh in-transaction read; checking there narrows (but, at READ COMMITTED with no row locks, does not eliminate) the window against a concurrent step update -- the same residual race create/update already have, backstopped by the run-time rejection. The failure MUST be raised with `DBIO.failed` inside `.transactionally` so the relink rolls back; returning a `Left` after the updates would commit them. A violation is the pair `(referencingStepId, laneTargetId)` where the target is the referencing step itself, one of its ancestors, or one of its descendants (parent-chain), computed with the existing pure helpers (`PipelineService.ancestorChainOf` / `descendantStepIds`, or one new pure function `laneCycleViolations(steps): Set[(String,String)]` placed in a package both the repository and the service can reach (e.g. `com.helio.domain.pipelines`; the existing helpers are private to `services.pipelines`) -- ONE implementation). Every step with a lane ref is checked, tails included (a tail's ancestry changes when its trunk owner moves).

Only NEWLY introduced violations block: a legacy row already cyclic before the reorder must not make every reorder of that pipeline fail (that would strand the user; the run-time rejection already covers such a graph).

### D2. Reorder lane-cycle status is `400`, not the permutation `422`
The permutation-shape errors stay `422` (request does not describe the trunk). A lane cycle is the same class of error as create/update's lane-cycle rejection, which the spec fixes at `400 Bad Request` naming the cycle; the message names the referencing step and the target, e.g. `Reorder would create a cycle: step '<ref>' has a lane reference to '<target>', which would be its ancestor.` The repository signals it distinctly from a permutation error (typed result or a dedicated exception the service maps) so the service can return `ServiceError.BadRequest` for it and `UnprocessableEntity` for the rest.

The web editor's existing reorder-failure path (drag reorder -> PUT /steps/order) is verified to surface/revert on a non-2xx; no UI change is in scope. If the executor finds it swallows a 400 silently, record it for the follow-up rather than building UI here.

### D3. Create's lane scope uses the placement anchor for every arm
`laneScopeF` derives `prospectiveParent` from `StepPlacement.resolveCreateAnchor(...)` (already computed there for the descendants) -- `anchor.anchor` for every successful resolution, including `attachAsTail` (a tail's parent is its anchor) and bare `position`. When placement resolution FAILS (`Left`), keep today's fallback (`req.parentStepId` else trunk-last; rootId arm: none) so the error precedence of existing tests does not move; `persistNewStep` returns the placement error afterward as today. Remove the "pre-existing mismatch, left as it was" comment.

### D4. Access first in the shared chain
`referenceChecksF` order becomes: **access** -> secondary-source ownership -> lane -> upsert target. Rename the `beforeUpsertF` parameter to reflect that it is the access stage (e.g. `accessF`) and evaluate it first; update/duplicate keep passing their already-resolved `Future.successful(Right(pipeline))`, so their observable behaviour is unchanged. Create's `pipelineAccessF` thus runs before `laneScopeF` is ever evaluated: a caller without access gets `404 Pipeline not found: <id>` (no grant) or the viewer `403` (viewer grant) regardless of the lane reference. Update the class doc ("The stage order lives here and nowhere else").

Side-effect to verify: ownership-before-access also moves -- a non-grantee whose secondary DataSource id is not theirs now gets the pipeline 404 instead of `Data source not found`. That reveals strictly less; any test pinning the old order is updated with a note.

Red-first proof (security item): a route-level test with two users -- owner creates a pipeline with steps; stranger POSTs a step with a lane ref to (a) an existing step id of that pipeline and (b) a random UUID (and, for completeness, (c) the trunk-last step). Assert identical status and body across all. Committed/run FIRST against unmodified code and shown failing (status differs), then passing after D4. Also a viewer-grantee variant (identical 403s).

Audit (no change expected): the patch-set create/update lane paths and `PipelineCreatePreflight.laneChecks` -- confirm each establishes pipeline access before reading any foreign pipeline's steps; record the evidence in the executor report.

### D5. One ownership check, three call sites
Expose from `StepReferenceChecks` (widen visibility to `private[services]` or a companion object function taking `DataSourceRepository`) a `secondarySourceOwnershipF(typedConfig, user): Future[Either[String /*data source id*/, Unit]]`-shaped primitive, or equivalent, so each caller formats its own error. Observable output stays byte-identical: `PipelineService`/`PipelineCreateTransaction` -> `NotFound("Data source not found: <id>")`; patch-set -> `NotFound("edit <index>: data source not found: <id>")`. `PipelineCreateTransaction.checkOwnedSource` and the two patch-set inline blocks are deleted. Pure refactor -- existing tests are the guard; add none unless a site was untested (then a pin).

### D6. Rollback/undo pin (item 4) and stale-and-cyclic pin (item 5)
Item 4 is characterization: build a pipeline where a lane step is tail-adjacent (a tail of a trunk step, referenced or referencing via lane), run a patch-set apply that deletes it and then fails a later edit, and assert the actual rollback outcome (the ticket claims: the step stays deleted and the rollback report marks it `unrecoverable`; undo likewise recreates without `attachAsTail`). Pin what the code ACTUALLY does; if it differs from the ticket's description, pin reality and state the difference in the report. Item 5: a patch-set edit whose target changed since preview AND whose new config is a lane cycle -> `409 PATCH_SET_STALE` (staleness checked first).

## Risks / Trade-offs

- [Reorder 400 is a new status on an existing endpoint] -> only for reorders that would store a cycle the create/update paths already refuse; client handles non-2xx generically (verified in D2).
- [Chain reorder changes error precedence for create] -> intended (the security fix); every test whose expectation moves is updated with the reason recorded.
- [HEL-1521 touches the same code next] -> keep the lane-cycle helper single and pure so HEL-1521 can extend it to lane-link cycles.

## Open Questions

None that change what gets built. Assumed scope call (items 7-9 deferred) is driver-authorized and recorded in proposal.md.
