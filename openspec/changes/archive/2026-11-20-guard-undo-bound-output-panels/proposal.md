## Why

Undoing a patch set that created an Output, a pipeline step, a pipeline or a dashboard deletes that resource. It also deletes every panel bound to it or placed on it, including panels added after the apply and panels another user owns (HEL-1720, raised by HEL-1639's final skeptic). The deletion runs on the privileged pool and through foreign-key cascades, so row-level security does not stop it. The undo reports success. One user's undo can silently remove another user's work.

## What Changes

- Undo of a patch set refuses the whole undo (409, nothing restored) when any resource a create edit's undo would delete now carries panels that this patch set did not create. This applies to the `output`, `pipelineStep`, `pipeline` and `dashboard` create arms. Undo stays all-or-nothing, as HEL-413 established.
- The refusal message names each blocking panel the undoing user can read (panel title and dashboard name), and gives only a count for panels the user cannot read. It never discloses another tenant's titles.
- Panels the same patch set itself created do not block. The reverse walk deletes them before the resource is deleted. No other panel is excused.
- The Output delete re-checks for blocking panels inside its own transaction, so a panel bound between the check and the delete is not deleted silently.
- No change to the REST route, the response schema, the helio-mcp `undo_patch_set` contract (its description already promises a whole-undo refusal), or the web undo toast (it already shows the server's 409 message).
- Out of scope: pipeline-editor draft-save undo (`DraftRestore`), filed as HEL-1792.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `patch-set-undo`: adds a requirement that undo refuses when a resource it would delete carries panels the patch set did not create, and states how the refusal names them.

## Impact

- Backend: `PatchSetUndoConflictCheck` (new Phase-1 blocker for the four create arms), a shared bound-panels check, `PatchSetUndoService` / `OutputRepository.deleteWithPanelsInternal` (in-transaction re-check for the Output delete).
- Tests: `PatchSetUndoBoundOutputPanelsSpec` (red committed in 0167f9d0e) plus new cases for the other arms, run on the non-BYPASSRLS app role `helio_app_test`.
- No migration, no API contract change, no frontend or helio-mcp code change expected.
