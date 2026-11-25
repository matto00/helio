## Why

HEL-1652 let editor grantees add and remove pipeline roots on the privileged (RLS-bypassing) connection, after a
service-layer owner-or-editor check. Two gaps remain (HEL-1707): a root add for a pipeline deleted mid-request
answers 500 instead of 404, and a grant revoked between the service check and the privileged transaction is never
re-checked, on root add/remove, draft save and step writes. Planning also found that `DELETE /api/outputs/:id` and
patch-set undo of an Output create authorize only by who created the Output, so a creator later downgraded to
viewer can still delete it (owner ruling R2: fix in this change).

## What Changes

- Root add answers the unknown-pipeline `404` (never 500) when the pipeline disappears between the access check and
  the write: both the missing pipeline-name read and a pipeline-row lock that finds the row gone.
- Root add, root remove, draft save (including the undo restore that goes through it) and every step write (create,
  update, delete, reorder, duplicate) re-check, inside their own privileged transaction and right after the existing
  pipeline-row lock, that the acting user is still the pipeline owner or holds an `editor` grant. A refused re-check
  writes nothing and answers what the service-layer check would have answered had the revoke landed first (`403` for
  a remaining viewer grant, the existing `404` for no grant). Outside the race nothing a user sees changes.
- **Visible change outside the race:** `DELETE /api/outputs/:id` requires the caller to have created the Output AND
  to be the pipeline owner or a current `editor` right now; a creator downgraded to viewer (or revoked) gets the `404`
  a viewer or stranger gets today, and nothing is deleted. Patch-set undo of an Output create adds the same current
  owner-or-editor check and answers `NotFound "Output not found"` when refused. Nobody gains delete rights; PATCH is
  unchanged.
- Test-only: NOBYPASSRLS regression guards for an editor attaching another user's source as a root and an editor
  naming another pipeline's root id on remove; `PipelineRootWriteGrantsSpec` pins `UPDATE` on `panels` and
  `EXECUTE` on `hel1629_lock_pipelines` for `helio_privileged`. No migration (both grants already exist: V129, V137).

## Capabilities

### New Capabilities
- `pipeline-editor-grant-recheck`: editor-reachable privileged pipeline writes re-check the acting user's current
  owner-or-editor access inside the write transaction; Output delete and its undo require current access.

### Modified Capabilities
- `pipeline-root-write-access`: root add for a pipeline deleted mid-request answers `404`, never `500`.
- `output-routes-api`: `DELETE /api/outputs/:id` additionally requires current owner-or-editor access on the pipeline.

## Impact

- Backend only: `PipelineRootRepository`, `PipelineRootWrites`, `PipelineStepRepository` and its step-write services,
  `DraftSaveTransaction`/`DraftSaveService`, `OutputRepository`/`OutputService`, `PatchSetUndoService`, plus a shared
  in-transaction owner-or-editor predicate (the run-admission rule, `PipelineRunRepository.submitterMayRunAction`).
- Out of scope (owner ruling, follow-up HEL-1882): Output create, insight refresh, dashboard-editor writes. No
  pipeline-run write path is touched (sibling HEL-1541). No schema change, no API shape change.
