## Why

HEL-1469 made single-call `POST /api/pipelines` leave no orphan inline source, but listed four sibling paths where a data source (or the implicit "Auto:" Connector a bare-`url` REST source creates) is committed and then survives a later failure: `addRoot` with an inline root, the implicit Connector on every compensation path, `SourceService`/`DataSourceService` creates that fail after their own insert, and patch-set undo. Orphans are invisible clutter in the user's source and connector lists and carry encrypted credential rows nobody owns.

## What Changes

- One shared "delete what this call created" helper for an inline source that also removes the implicit Connector a bare-`url` REST root created (guarded: never a Connector another source still references). Used by single-call create (`PipelineCreateWrites`), `addRoot` (`PipelineRootWrites`), patch-set mid-set rollback (`PatchSetApplyRollback`) and pipeline-proposal apply's own failure cleanup (`PipelineProposalService`).
- `addRoot` compensates an inline root it created when anything after creation fails (Left or failed Future), returning the original error.
- `SourceService.createSql`/`createRest` delete their own inserted row (and the implicit Connector) when a step after the insert fails, then re-raise the original failure. Also covers the bare-`url` case where the Connector was created but the source insert itself failed.
- `PatchSetApplyRollback.deleteInlineRootSources` warns and reports `unrecoverable` when roots do not line up, instead of silently skipping, and deletes nothing when the root counts differ.
- Patch-set UNDO of an inline-root pipeline create: unchanged here (product call, deferred to owner via follow-up).
- No status code or message change on any success or existing failure response. No migration.

## Capabilities

### New Capabilities
- `inline-source-create-atomicity`: a call that creates a data source (directly or as an inline pipeline root) leaves no data source or implicit Connector behind when it fails.

### Modified Capabilities

## Impact

Backend only: `services/pipelines/PipelineCreateWrites.scala`, `PipelineRootWrites.scala`, `PipelineProposalService.scala`, `services/patchsets/PatchSetApplyRollback.scala`, `services/sources/SourceService.scala`, plus wiring and new specs. No API shape, schema or frontend change.
