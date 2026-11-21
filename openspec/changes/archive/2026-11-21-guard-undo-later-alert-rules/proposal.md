## Why

Undoing a patch set that created a pipeline deletes the pipeline, and the database cascades that delete further than HEL-1720/HEL-1795/HEL-1796 guard. Alert rules target Outputs (`alert_rules.target_output_id ON DELETE CASCADE`, V94), so an alert rule added after the apply to an Output the patch set created is deleted without warning. The same cascade removes a schedule added later to a created pipeline (`pipeline_schedules.pipeline_id`, V62) and an extra root added later (`pipeline_roots.pipeline_id`, V98, owner or editor via `addRoot`). This contradicts the owner rulings: refuse the whole undo, excuse only what the patch set itself created. The draft-save undo already refuses on alert rules targeting created Outputs; the per-edit undo does not.

## What Changes

- Undo of a `pipeline`, `pipelineStep` or `output` `create` edit is refused with `409` (nothing restored) when an alert rule targets any Output that undo would delete. A patch set never creates alert rules, so every such rule blocks, whoever owns it.
- Undo of a `pipeline` `create` edit is also refused when the pipeline has a schedule (a patch set never creates one) or a root the create did not make.
- The apply journals the ids of the roots a `pipeline` create made (one more optional field in the existing `createdChildren` journal object); journal rows written before this change fall back to the HEL-1795 timestamp rule.
- The refusal names alert rules only for their owner (the draft-save undo's rule, shared rather than copied), names extra roots by data source name when the undoing user can read the source, counts the rest, and never carries an id.
- Phase 2 re-checks immediately before each delete (counts only); the `output` arm counts alert rules inside its existing delete transaction.
- No response-schema, route, helio-mcp tool or web client change; their "whole undo is refused" wording is re-verified.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `patch-set-undo`: adds a requirement that create-undo refuses when it would delete alert rules, a schedule or pipeline roots the patch set did not create.

## Impact

- Backend only: `services/patchsets` (`PatchSetUndoLaterChildren`, `PatchSetUndoBoundPanels`, `PatchSetUndoConflictCheck`, a minimal touch to `PatchSetUndoService`'s Phase-2 re-check and `output` arm, the apply's `createdChildren` capture), `DraftRestore` (moves its alert-rule naming onto the shared helper, output text unchanged), `PatchSetApplicationRepository.JournaledCreatedChildren` (one optional field, no migration), small internal reads in `OutputRepository` / `PipelineRepository` if needed.
- Tests on the `helio_app_test` NOBYPASSRLS role.
