# HEL-1736: Narrow useTopModalDialog's MutationObserver (it observes the whole body subtree)

## Description

origin_kind: followup
origin_ticket: HEL-1675

`frontend/src/shared/ui/useTopModalDialog.ts` (HEL-1668 D2, used by Toast) observes `document.body` with `subtree: true`. Modal `<dialog>`s mount in-tree wherever their owner renders, in 12 files, so there is no narrower root to observe. Narrowing needs something like an open-dialog registry that `Modal` and the raw `<dialog>` users report to.

HEL-1675 listed this as a tidy item and dropped it here because it grew past a tidy edit.

## Acceptance Criteria

- The hook no longer observes the whole body subtree.
- Toast-above-modal behaviour (HEL-1668 item 2) is unchanged, with its e2e (`e2e/hel1668-phone-sheet.spec.ts`, run in full) still green.

## Driver notes (claims, verified at Planning)

- Re-enumerate raw `<dialog>` users from the tree; none may be missed; add a guard test that fails if a new raw `<dialog>`/`showModal()` appears without registering, or justify why not.
- Red first: a test that fails while the body-subtree observer exists, and a test proving toast-above-modal still works, each with a recorded mutation.
- Include the shared bottom sheet (HEL-1746 ask drawer, BottomSheet) in the enumeration.
- Avoid `usePortalPopover` (HEL-1762 concurrent lane). Pure frontend, no migration.
