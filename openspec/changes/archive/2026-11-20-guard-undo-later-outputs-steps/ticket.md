# HEL-1795: Undoing a pipeline create deletes Outputs other users added to it

## Description

HEL-1720 (merged as 917c89172, PR #1196) made a create undo refuse with a 409 when the delete would remove a panel the patch set did not create. It still allows undoing a `pipeline` create to delete **Outputs** that another user, such as an editor grantee, added to that pipeline after the apply. Only the panels bound to those Outputs are protected.

**Expected:** follow HEL-1720's owner rulings: refuse the whole undo, all-or-nothing. The message names the Outputs the undoing user can read and gives a count for the rest, never another tenant's names or ids. Steps added later by another user may need the same treatment; check them.

## Acceptance Criteria

* First write a failing test on `helio_app_test`, the role without RLS bypass. User A applies a patch set that creates a pipeline. Editor B adds an Output to it. A's undo deletes B's Output.
* The undo refuses with a 409 and changes nothing. The message follows the HEL-1720 naming rules.
* Same-user later additions follow the same rule as HEL-1720's: only things the patch set itself created are excused.

## Agent notes

* HEL-1720 archived change: `openspec/changes/archive/2026-11-20-guard-undo-bound-output-panels/`. Evidence in `.concertino/runs/HEL-1720/evidence/`.
* Reuse the "bound since the apply" check in `PatchSetUndoService` / `PatchSetUndoConflictCheck` (`PatchSetUndoBoundPanels`, incl. HEL-1792's `describeBlocking`).
* Driver context: main at 763c69f6f. Backend expected; check the REST route, MCP `undo_patch_set` description and the web toast wording ("the whole undo is refused") still hold. No migration expected (V147 free). Queued after: HEL-1796 (dataSource create undo), HEL-1797 (tidy/split PatchSetUndoService) -- do not do their work, keep PatchSetUndoService changes minimal.
