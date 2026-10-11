## Why

Undoing an applied patch-set pipeline-create deletes only the pipeline (`PatchSetUndoService`, `("pipeline","create")`).
An inline root source the apply created, and the implicit "Auto:" Connector of a bare-`url` REST root, stay behind as
clutter the user never asked for. HEL-1475 fixed every other leak path and deferred this one to the owner.

Owner decision (HEL-1493 escalation, 2026-10-11): **B** -- undo removes each inline source the apply created, only when
nothing references it; patch sets journaled before this ships keep today's behaviour; a kept source is reported on the
wire and in the undo toast.

## What Changes

- Apply journals, for a `pipeline` `create` edit, the ids of the inline root sources it created (and whether each made
  an implicit Connector). Older journal rows still parse (the field is optional).
- Undo of that edit deletes the pipeline, then each journaled inline source through `DataSourceService.delete` (409
  reference guard intact), then its implicit Connector. A still-referenced source is kept and reported.
- `EditUndoOutcome` gains an optional `inlineSources` array (backend, JSON schema, frontend and helio-mcp types).
- The undo toast names any kept source; the data-source list is refreshed when one was removed.

## Capabilities

### New Capabilities

### Modified Capabilities
- `patch-set-undo`: undo of a pipeline create removes the unreferenced inline root sources that create made.

## Impact

Backend `services/patchsets` (journal, undo), `services/sources/InlineSourceCleanup`, `PatchSetApplicationRepository`
journal shape (JSON column, no migration), `PatchSetUndoProtocol`; `schemas/patch-sets/patch-set-undo-response.schema.json`;
frontend `features/patchSets`; `helio-mcp/src/types.ts`.

## Non-goals

- Cleaning up orphans already in prod (HEL-1495).
- Any heuristic for legacy journal rows (owner: keep the source).
- Option C's "unmodified since apply" check.
- Changing apply-time rollback or single-call create cleanup (HEL-1469/HEL-1475 behaviour stays as is).
