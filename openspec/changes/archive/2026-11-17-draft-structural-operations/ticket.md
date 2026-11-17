# HEL-1684: Live draft preview (g): draft the structural operations (add, insert, duplicate, reorder, lanes, roots, shapes, Outputs) instead of blocking them

## Description

Follow-up of HEL-1631 (PR #1072, merged as c1add2394).

Owner ruling on HEL-1631 (block-during-draft-recommended): a draft carries step config edits, enabled toggles and step deletes. Every other structural action is disabled while a draft is open, with "Save or discard your draft first". That covers add, insert, duplicate, reorder, lane and root changes, shapes, and creating, editing or deleting Outputs.

This ticket makes those actions draftable, as `docs/live-draft-preview.md` §8.1 and §8.4 allow. The atomic Save & run endpoint (HEL-1629) must accept them, along with the stale-base 409 and atomic undo. The client evaluator, the kept draft (per-tab sessionStorage with a base fingerprint) and the draft preview must carry them.

## Acceptance Criteria

- Each action works inside a draft, and is applied atomically on Save & run or thrown away on Discard.
- Kept-draft restore and the stale-base path still work.
- Desktop and phone, light and dark, with e2e coverage per action that fails first.
