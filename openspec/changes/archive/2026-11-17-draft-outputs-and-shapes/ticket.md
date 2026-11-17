# HEL-1733: Live draft preview (h): create, edit and delete Outputs inside a draft, then shapes

## Description

Split out of HEL-1684 by owner ruling (split-as-proposed). HEL-1684 makes add, insert, duplicate, "+ lane" and reorder
draftable. This ticket covers Outputs and shapes.

Today, creating, editing or deleting an Output and adding a shape are blocked while a draft is open ("Save or discard
your draft first", HEL-1631 ruling).

## Scope

- Create, edit and delete Outputs inside a draft. The atomic save (`POST /api/pipelines/:id/draft/save`) already accepts
  Output create/edit/delete, so this is mostly client work.
- Show draft Outputs in the Live Output column (HEL-1632, HEL-1705).
- Then shapes: a shape adds several steps plus Outputs in one action. Build it on the draft step model from HEL-1684 and
  the draft Outputs above.

## Acceptance criteria

- Each action works inside a draft, and is applied atomically on Save & run or thrown away on Discard.
- Kept-draft restore and the stale-base path still work.
- Desktop and phone, light and dark, with e2e coverage per action that fails first.

## Driver context (claims, verified in premise-validation.md)

- Decide and state what a draft Output delete does to bound panels at Save; it must match today's non-draft delete. If
  it cannot, or the confirm UX would differ, escalate.
- If Outputs plus shapes is too big for one PR, escalate with a proposed split. Anything not covered stays blocked with
  "Save or discard your draft first".
- Keep root routing out of the diff (HEL-1734).
