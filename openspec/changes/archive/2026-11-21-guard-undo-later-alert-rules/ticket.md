# HEL-1811: Undoing a pipeline create deletes alert rules added later to its Outputs

## Description

origin_kind: followup
origin_ticket: HEL-1795

HEL-1795 made undoing a `pipeline` or `pipelineStep` create refuse (409, nothing restored) when it would delete an Output or step the patch set did not create. It does not cover **alert rules**. An alert rule targets an Output (`alert_rules.target_output_id ON DELETE CASCADE`, V94). When someone adds an alert rule after the apply to an Output the patch set created, undo still deletes that rule without warning. Who added it does not matter: the applier, an editor or anyone else.

**Expected:** follow the HEL-1720 / HEL-1795 rulings. Refuse the whole undo. Name the rules the undoing user can read, count the rest, never show ids. The draft-save undo already refuses when an alert rule targets a created Output (`openspec/specs/patch-set-undo/spec.md`, the draft-save requirement). Reuse that.

**Also check:** schedules and extra roots added later to a created pipeline. These cascade too. Runs, history and insights are pipeline by-products and are out of scope.

## Acceptance Criteria

* First write a failing test on `helio_app_test`. A applies a patch set that creates a pipeline with an Output. A, or an editor, then adds an alert rule on that Output. Today, A's undo deletes the rule.
* After the fix the undo refuses with a 409 and nothing changes. The message follows the HEL-1720 naming rules.

## Agent notes

* HEL-1795 archived change: `openspec/changes/archive/2026-11-20-guard-undo-later-outputs-steps/`. The helper `PatchSetUndoLaterChildren` and the shared `PatchSetUndoBoundPanels.doomedRows` / `nameList` are the place to extend.
* Evidence is in `.concertino/runs/HEL-1795/evidence/`.

## Owner rulings that bind (HEL-1720 -> HEL-1795 -> HEL-1796, 2026-11-20/21, relayed by the driver)

* Refuse the WHOLE undo with 409; nothing changes.
* Name only what the undoing user can read (alert rules: named only for the rule's owner, per HEL-1792), count the rest; never ids in the message or INFO+ logs.
* Only what the patch set itself created is excused; same-user later additions block too.
