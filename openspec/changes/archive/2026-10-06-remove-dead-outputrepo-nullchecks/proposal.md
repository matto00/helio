## Why

HEL-1295 made `dbContext` required in `ApiRoutes` and `outputRepo` required in seven services. Production can
therefore never reach the `outputRepo == null` degrade branches, the `None` arm of any `Option(dbContext)`
derivation, or `PublicDashboardRoutes`' `outputRepoOpt = None` default. That dead code misdocuments the wiring
("degrades when no DbContext") and invites new code to copy a convention that no longer exists.

## What Changes

- Remove the `outputRepo == null` branches in `OutputControlsValidator`, `WorkspaceContextService` (two sites),
  `WorkspaceSearchService`, `PatchSetApplyResolvers` (two sites) and the same-shape `PatchSetUndoService:91`
  site the ticket did not name; remove `PatchSetApplyContext.outputRepoUnavailable` once it has no caller.
- Make the "cannot be null" premise mechanical in those classes with `require(outputRepo != null, ...)`, the
  exact pattern HEL-1295 used for the other seven services, and give null-passing fixtures a real or mock repo.
- `PublicDashboardRoutes` takes a required `outputRepo: OutputRepository`; its `None` arms are removed.
- `ApiRoutes`: every `Option(dbContext)` derivation (16 sites) becomes a plain value; `None`/`.orNull`/
  `.fold(reject)` consumers that were only reachable via a null `dbContext` collapse. Downstream service and route
  signatures that take an `Option` for other reasons are NOT changed (`Some(x)` is passed instead).
- Re-indent `PipelineService.createTransactional`'s body (whitespace only).
- Delete the tests that asserted the now-impossible null-repo state (enumerated in design.md).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `patch-set-undo`: REMOVED the requirement "Undo SHALL refuse the whole undo with a typed error when a needed Output repository is unavailable" -- the null-repo state it guarded can no longer occur (see `specs/patch-set-undo/spec.md`). Otherwise a behaviour-preserving refactor.

## Impact

Backend only: `ApiRoutes.scala`, `PublicDashboardRoutes.scala`, `OutputControlsValidator.scala`,
`WorkspaceContextService.scala`, `WorkspaceSearchService.scala`, `PatchSetApply*`/`PatchSetUndoService.scala`,
`PipelineService.scala`, and the specs that construct those classes with a null repo. No API, schema, migration,
or frontend change.

## Non-goals

- Changing downstream signatures that are `Option`/nullable for reasons other than `dbContext` (e.g. `AuthService`'s
  `productEventServiceOpt`, `PublicDashboardRoutes`' `nodeSnapshotRepoOpt`/`pipelineRepoOpt`).
- Other nullable ApiRoutes params (`auditEventRepo`, `mfaRepo`, ...) that remain genuinely optional.
- Fixing any real bug found along the way (spinoff note in the PR instead).
