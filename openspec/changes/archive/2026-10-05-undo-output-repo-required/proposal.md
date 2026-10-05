## Why

HEL-1239 made `PatchSetApplyContext.outputRepo` a required parameter so an omitted collaborator is a compile error, not
a runtime NPE. The undo path was left on the old convention: `PatchSetUndoService` and `PatchSetUndoContext` still
default `outputRepo = null`. A live construction site (`PatchSetUndoRoutesSpec`) already omits it, and undo's
`restoreBoundOutputs` dereferences it unguarded after recreating a step, so a null repo yields a 500 with a
half-restored lane. `countPlacementsForStep` silently reports `0` instead.

## What Changes

- Remove the `= null` default from `PatchSetUndoService.outputRepo` and `PatchSetUndoContext.outputRepo`; build the
  context through one required-parameter construction path, mirroring `PatchSetApplyContext.build`.
- Undo reads `outputRepo` only through its context, so the context is the single source the parity test covers.
- Before any restore, an application whose edits need the Output repository (a `pipelineStep` create, or a
  `pipelineStep` delete whose journal captured bound Outputs) is rejected with the same typed
  `InternalError("Output repository is not configured")` HEL-1239 introduced. It is never an NPE, a partial restore,
  or a silent `0`.
- Fix the omitting construction site in `PatchSetUndoRoutesSpec`.
- Add a structural parity test and a null-repo typed-rejection test.

## Capabilities

### New Capabilities

### Modified Capabilities
- `patch-set-undo`: adds a requirement that a missing Output repository refuses the whole undo with a typed error
  before any restore.

## Impact

- `backend/.../services/patchsets/PatchSetUndoService.scala`, `PatchSetUndoTypes.scala`, `ApiRoutes.scala` (named
  arg already passes it explicitly; verify only).
- Tests: `PatchSetUndoServiceSpec`, `PatchSetUndoRoutesSpec`.
- No API shape change, no migration, no frontend change. Prod always wires a DbContext, so prod behavior is unchanged.

## Non-goals

- The other services still carrying `outputRepo: OutputRepository = null` (PanelService, PipelineService,
  DashboardService, etc.) are out of scope; they get noted as a follow-up only.
- Undo's ACL or conflict semantics do not change.
