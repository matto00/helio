# HEL-1388: Output editor: Kind select is editable in edit mode but the server can't change an Output's kind (dev-worded 400)

## Description

origin_kind: followup
origin_ticket: HEL-1313

In the Output editor (edit mode) the Kind select can be changed, but the server can't change an existing Output's kind.
Before HEL-1313 the stray keys were silently stored. Since HEL-1313 (e93bebc32) the save fails with a developer-worded
400 naming a wrong-kind config key. Screenshots: `.concertino/runs/HEL-1313/evidence/`.

## Acceptance criteria

* Kind is disabled in edit mode, with a short reason (DESIGN.md disabled-state pattern), unless a real kind change is
  supported. If supporting it is preferred, escalate (product call).
* Test: edit mode renders Kind disabled; create mode is unchanged.

## Driver context (verified at Setup — see premise-validation evidence)

* HEL-1389 (#876) made edit-mode Save send a config patch; a kind change still sends the full built config
  (`OutputEditorSheet.tsx` `buildEditConfig`, `kind !== output.kind` branch). Locking Kind closes that path.
* The control must be accessible: no dead focusable control, and the reason exposed to assistive tech.
* DESIGN.md has no named "disabled-state pattern" (premise minor-staleness); follow in-repo precedent instead:
  `FormFieldRow.tsx`'s disabled Toggle + "Required by the dataset" hint, shared `Select` `disabled`/`ariaDescribedBy`.
* Visual cohesion: verify against the RUNNING app in both themes.
* Out of scope: HEL-1430 (OutputEditorSheet split, test comment, sheet key).
