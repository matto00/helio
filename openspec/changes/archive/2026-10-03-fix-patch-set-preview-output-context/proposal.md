## Why
`POST /api/patch-sets/preview` 500s for any `output` update/delete: `PatchSetPreviewService` builds `PatchSetApplyContext` without `outputRepo` (defaults to null, NPE in the resolvers), and even once wired, `PatchSetPreviewProjection` has no case for the Output resolved actions (MatchError). A nullable default on a shared context also lets one construction site silently omit a collaborator.

## What Changes
- Wire `outputRepo` into `PatchSetPreviewService` via a shared context factory; remove the `= null` default; typed ServiceError where the repo is genuinely absent (no DbContext).
- Teach `PatchSetPreviewProjection` (and decide Impact) for `OutputUpdate`/`OutputDelete`.
- Audit every context field, null guard (including the silent `boundOutputs` degradation for pipelineStep delete) and every sealed `ResolvedAction` case per (kind, op).
- Structural parity test, full-schema write-free test, and ExistenceNotLeakedRoutesSpec Output rows replacing the exemption.

## Capabilities
### Modified Capabilities
- `patch-set-preview`: output update/delete previews resolve correctly, never 500, never write; preview's pipelineStep-delete prior state reports boundOutputs like apply.

## Impact
Backend only: `PatchSetPreviewService`, `PatchSetPreviewProjection`, `PatchSetApplyTypes`/`PatchSetApplyService`/`PatchSetApplyResolvers`, `ApiRoutes`, tests.
