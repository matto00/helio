## Why

Undoing a patch set that created a pipeline deletes the pipeline, and the database cascades that delete to every Output and step on it. HEL-1720 stopped this from deleting panels the patch set did not create, but the Outputs (and steps) themselves are still deleted, including ones an editor grantee or the same user added after the apply. That silently destroys other people's work, against HEL-1720's owner ruling (refuse, all-or-nothing). Undoing a `pipelineStep` create has the same hole: the step delete removes descendant steps and the Outputs on them.

## What Changes

- Undo of a `pipeline` create edit is refused with `409` (nothing restored) when the pipeline carries an Output or a step the patch set did not create.
- Undo of a `pipelineStep` create edit is refused the same way when the step delete would remove an Output, or a descendant step, the patch set did not create.
- The apply journals, for `pipeline` and `pipelineStep` create edits, the ids of the steps and Outputs that create itself made, so "created by the patch set" is exact rather than inferred. Journal rows written before this change fall back to a documented rule (design D2).
- The refusal names the Outputs (and steps) the undoing user can read and counts the rest, never naming or exposing ids of unreadable ones, following HEL-1720/HEL-1792's panel rules.
- Phase 2 re-checks immediately before each delete, as HEL-1720 does for panels.
- No response-schema, route, helio-mcp tool or web client change; their "whole undo is refused" wording is re-verified.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `patch-set-undo`: adds a requirement that create-undo refuses when it would delete Outputs or steps the patch set did not create.

## Impact

- Backend only: `services/patchsets` (`PatchSetUndoBoundPanels` or a sibling helper, `PatchSetUndoConflictCheck`, minimal touch to `PatchSetUndoService`'s Phase-2 re-check, the apply's journaling), `PatchSetApplicationRepository.JournaledEdit` (one optional JSON field, no migration).
- Tests on the `helio_app_test` NOBYPASSRLS role.
