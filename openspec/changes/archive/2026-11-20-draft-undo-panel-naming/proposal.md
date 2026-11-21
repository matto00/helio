## Why

HEL-1792 was filed as "draft-save undo silently deletes panels". It does not: since HEL-1629 the restore refuses with a
409 and changes nothing. But each refusal message lists raw panel ids for every blocking panel, including a panel
another user owns. HEL-1720 set the rule for undo refusals: name what the undoing user can read, count the rest, never
expose another user's panel. The draft path breaks that rule, and its cross-user case has no test on the app role.

## What Changes

- The pre-check refusal for panels bound to Outputs the save created names readable blocking panels by title and
  dashboard (at most 10), counts the rest, and carries no panel id. It reuses HEL-1720's naming from
  `PatchSetUndoBoundPanels`.
- The refusal for panels and alert rules the save's cascade removed reports counts only: those panels no longer exist,
  so there is nothing the user can read to name, and the journal's ids and alert rule names may belong to other users.
- The in-transaction Restore refusal (`cascadeGate`) becomes count-only, like HEL-1720's `boundDuringUndo`.
- Alert rules in the created-Outputs refusal follow the same rule: a rule the undoing user owns is named, others counted.
- A two-user spec on the `helio_app_test` NOBYPASSRLS role.

## Capabilities

### New Capabilities

### Modified Capabilities
- `patch-set-undo`: the pipeline-definition-save undo's refusal message no longer names each panel and alert rule by id;
  it follows the readable-named, rest-counted rule.

## Impact

- `backend/.../services/pipelines/draft/DraftRestore.scala`, `DraftSaveTransaction.scala`
- `backend/.../services/patchsets/PatchSetUndoBoundPanels.scala` (expose the naming helper; minimal)
- `backend/.../api/ApiRoutes.scala` (DraftRestore construction gains the dashboard repo, if needed)
- Tests: `DraftSaveUndoSpec` assertions on message text; a new two-user spec.
- No API shape, schema, migration or client change.

## Non-goals

- Pipeline-create undo deleting other users' Outputs (HEL-1795), data-source create undo (HEL-1796), splitting
  `PatchSetUndoService` (HEL-1797).
- Changing whether the draft undo refuses (it already refuses correctly).
- Any frontend change.
