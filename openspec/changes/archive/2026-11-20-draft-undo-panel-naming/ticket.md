# HEL-1792: Pipeline draft-save undo deletes panels bound to its Outputs after the save, including other users' panels

## Description

origin_kind: followup, origin_ticket: HEL-1720.

HEL-1720 makes patch-set undo refuse, with a 409, when a resource it would delete has gained panels since the apply.
Undo stays all-or-nothing. The pipeline editor's draft-save undo uses the same route (`POST /api/patch-sets/:id/undo`),
but it runs a separate restore path. The ticket states that path can delete panels bound to an Output the save created,
without warning, including a panel another user owns (for example a copy an editor grantee made with panel duplicate).

Give draft-save undo the same guard HEL-1720 adds. If panels the save did not create are now bound to an Output the
restore would delete, refuse with a 409 and touch nothing. The message names only the panels the undoing user can read
and gives a count for the rest.

## Original acceptance criteria

- [ ] Draft-save undo never silently deletes a panel created after the save, or a panel another user owns.
- [ ] A test covers the two-user case on the non-BYPASSRLS app role (helio_app_test).

## Restated scope (owner ruling 2026-11-20, `proceed-with-restated-scope`)

Premise validation (`.concertino/runs/HEL-1792/evidence/premise-validation.md`) found the silent delete does not exist on
main: since HEL-1629 `DraftRestore` refuses with 409 (pre-check on internal reads plus `DraftSaveTransaction.cascadeGate`
under the definition locks) and changes nothing, and the draft-undo toast (`usePipelineDraftUndo`) already shows the 409
message. The real gap: the refusal messages list raw panel ids for every blocking panel, including another user's panel
id, and there is no two-user test on `helio_app_test`. Restated acceptance criteria:

- [ ] All three draft-undo 409 messages (`DraftRestore.dependentsOfCreatedOutputs`,
  `DraftRestore.dependentsOfRemovedOutputs`, `DraftSaveTransaction.cascadeGate` in Restore mode) follow HEL-1720's naming
  rule: a blocking panel the undoing user can read is named by title and dashboard name; any other blocking panel is only
  counted; no panel id, and no title or dashboard name of a panel the user cannot read, appears in the message or logs.
- [ ] Reuse HEL-1720's `PatchSetUndoBoundPanels` naming (`describe`, `NameCap`, count wording) with a minimal change to
  `PatchSetUndoBoundPanels`/`PatchSetUndoService`; the in-transaction message may stay count-only (reason in design).
- [ ] Draft-save undo still never silently deletes a panel created after the save, or a panel another user owns
  (409, nothing changed).
- [ ] A two-user test on `helio_app_test` (proves `rolbypassrls = false`) covers it; red first = the other user's panel
  id in the 409 body.
- [ ] No client change (the toast already shows the server message as written).
