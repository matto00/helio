# HEL-1752: Output editor: "Confirm delete (removes from N dashboards)" label overflows its button at 375px

## Description

origin_kind: followup
origin_ticket: HEL-1733

On a 375px phone, the Output editor sheet's second Delete click shows "Confirm delete (removes from 1 dashboard)".
That label overflows its button.

This predates HEL-1733: the footer component (`OutputEditorFooter.tsx`) was not changed there. HEL-1733 makes the same
confirm reachable inside a pipeline draft too, so more users will now see it.

## Acceptance Criteria

- At 375px the confirm label fits its button (wraps or shortens within the design language), in light and dark.
- (Driver/orchestrator scope, folded in because it is the same footer row and the same root cause) At 375px the
  footer's "Add as tail with aggregate" label also fits its button without the button being squeezed to a narrow
  multi-line column.
- The full confirm label, including the dashboard count, stays visible (no copy change that drops information).
- Desktop (1280px) footer layout is unchanged: one row of single-line buttons at `--control-md` height, in the same
  horizontal arrangement measured on the running app before the fix (task 1.0). No desktop layout change is in scope.

## Agent notes

- Seen by HEL-1733's final-gate skeptic. Screenshot:
  `.concertino/runs/HEL-1733/evidence/.concertino/scratch/HEL-1733/sk-phone-dark-confirm-delete.png` in the main checkout.
- Same sheet, also pre-existing: at 375px the footer's "Add as tail with aggregate" button wraps to three lines.
