## Why

HEL-1515 (#974) put create/update/duplicate's step reference checks into one chain (`StepReferenceChecks`) and rejected a lane reference to a step's own descendant. Its delivery lane left correctness and security gaps it reported but did not file: a trunk reorder can still produce exactly the cyclic lane reference create/update now refuse; create's bare-`position` arm checks ancestors from a different anchor than it inserts at; and create's lane check runs before the pipeline access check, so a caller without access can learn whether a step id exists in someone else's pipeline. Two rollback/staleness outcomes are unpinned, and the secondary-source ownership check is still hand-copied in two places.

## What Changes

- `reorderSteps` (`PipelineStepRepository.reorderTrunkInternal`) rejects a reorder that introduces a lane reference to the referencing step's own ancestor or descendant -- checked inside the reorder transaction against the post-reorder rows, so it rolls back with nothing persisted. Response `400 Bad Request` naming the cycle (the lane-cycle family's status), not the permutation-shape `422`. Pre-existing violations that the reorder does not introduce do not block it.
- Step create's lane scope derives its prospective parent from `StepPlacement.resolveCreateAnchor` -- the exact anchor `persistNewStep` inserts at -- for every arm, including bare `position`.
- `StepReferenceChecks.referenceChecksF` runs the pipeline access stage FIRST (before secondary-source ownership and the lane check). Create's access check therefore precedes any read of the target pipeline's steps; update/duplicate already resolve access before entering the chain and are unchanged.
- `StepReferenceChecks` exposes its secondary-source ownership check, and `PipelineCreateTransaction` and `PatchSetPipelineStepResolvers` (update and create pre-authorization) call it instead of inline copies. Each call site keeps its existing error text (patch-set's `edit N: data source not found: <id>` prefix included).
- New backend tests: a red-first existence-probe test; reorder-cycle tests; create-`position` anchor test; patch-set rollback/undo outcome pin for a deleted tail-adjacent lane step; stale-and-cyclic edit gets `409 PATCH_SET_STALE`.

**Assumed scope call (driver-authorized):** ticket items 7 (lane picker polish), 8 (`hel908-tail-attach` e2e repair, HEL-962) and 9 ("dependent" -> "descendant" wording) are NOT delivered here; they go to one Follow-up ticket, HEL-1542 (label Follow-up, relatedTo HEL-1523). HEL-1521 (cycles through lane links, picker disabling) stays out of scope.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-lane-rejoin-input`: the lane-cycle rejection extends to trunk reorder, and the create ancestor scope is defined by the insert anchor; a lane reference on a pipeline the caller cannot edit discloses nothing about the referenced step.

## Impact

- Backend only: `services/pipelines/{StepReferenceChecks,PipelineStepCreate,PipelineStepWrites,PipelineCreateTransaction,PipelineService}.scala`, `services/patchsets/PatchSetPipelineStepResolvers.scala`, `infrastructure/persistence/pipelines/PipelineStepRepository.scala` (reorder), plus tests.
- API: `PUT /api/pipelines/:id/steps/order` may now return `400` for a reorder that would create a lane cycle. Create on an inaccessible pipeline returns the pipeline-access error regardless of the lane reference.
- No migration, no frontend change (the editor's existing reorder-error path is verified, not changed).
