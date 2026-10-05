# HEL-1256: PatchSetUndoService/PatchSetUndoContext default outputRepo = null (same silent-null class as HEL-1239)

## Description

Found during HEL-1239: after removing the `= null` default on `PatchSetApplyContext.outputRepo`,
`PatchSetUndoService` / `PatchSetUndoContext` still default `outputRepo = null`, so an undo construction site can
silently omit the collaborator. Audit undo's resolvers for dereferences/null guards, remove the default (or make it a
typed rejection), and add a structural parity test like HEL-1239's.

origin_kind: followup
origin_ticket: HEL-1239

## Acceptance Criteria

- `PatchSetUndoService` and `PatchSetUndoContext` have no `outputRepo = null` default; omitting the collaborator at
  a construction site is a compile error.
- Every undo dereference of `outputRepo` is audited: none can NPE, and none silently degrades (no silent `0` count /
  silent skip). A null `outputRepo` that an application's edits actually need yields a typed `ServiceError` before
  any mutation.
- A structural parity test (like HEL-1239's `PatchSetApplyContext parity`) proves the undo context carries every
  supplied collaborator, non-null and identical, and fails when a new context field is added without being wired.

## Premise validation notes (orchestrator, 2026-10-05, main @ 1f955abd)

- Both defaults confirmed (PatchSetUndoService.scala:60, PatchSetUndoTypes.scala:28).
- Live omission: `PatchSetUndoRoutesSpec.scala:110` constructs `PatchSetUndoService` without `outputRepo`.
- Unguarded dereference: `restoreBoundOutputs` (PatchSetUndoService.scala:298) calls `outputRepo.insertInternal` with
  no null check, AFTER the step has already been recreated -> NPE -> 500 with the step recreated but its outputs not.
- Silent degrade: `countPlacementsForStep` (:340) returns `0` when `outputRepo == null`.
- `PatchSetUndoContext.outputRepo` is never read (no `ctx.outputRepo` in PatchSetUndoConflictCheck/Inverse).
- Driver framing "undo silently returns null" is imprecise: undo never returns null; the defect is the silently
  defaulted null collaborator plus the unguarded dereference above.
