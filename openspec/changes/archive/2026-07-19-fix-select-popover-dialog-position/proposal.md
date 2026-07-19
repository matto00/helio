## Why

On mobile (390×844), the chart-type `Select` popover in the panel-creation modal renders ~283px below its
trigger, leaving options off-target and effectively untappable. The popover uses `position: fixed` and is
portalled into the open `<dialog>`; `.panel-creation-modal[open]` runs an entrance `animation` that animates
`transform` with `animation-fill-mode: both`, so the dialog keeps a lingering `transform` after the animation
and remains the containing block for fixed descendants — displacing the popover by the dialog's origin. This
exact defect was already diagnosed and fixed for the shared `Modal` primitive (`Modal.css`, commit
`d7fb3816`) by switching the fill mode to `backwards`; `PanelCreationModal` duplicates the dialog+animation and
never received that fix. Because HEL-305 made the chart-type selection meaningful, this misposition now blocks
a real task.

## What Changes

- Fix the root cause in `PanelCreationModal.css`: change the entrance animation's fill mode from `both` to
  `backwards`, mirroring the shipped `Modal.css` fix, so the dialog leaves no lingering `transform` at rest and
  no longer acts as a containing block for the portalled `position: fixed` popover.
- Audit every `<dialog>` / `Select` / `usePortalPopover` call site for the same lingering-transform condition
  (concretely: entrance-animation `animation-fill-mode`), confirming each is fixed or already correct.
- Add regression coverage asserting the panel-creation dialog's entrance animation does not persist a
  containing-block `transform` (fill mode is not `both`/`forwards`) so a Select portalled into it stays aligned
  to its trigger.

## Capabilities

### New Capabilities

- (none)

### Modified Capabilities

- `portal-popover-hook`: strengthen the guarantee that a popover portalled into a modal `<dialog>` aligns to
  its trigger — modal dialogs that host portalled popovers MUST NOT leave a lingering `transform` (containing
  block) after their entrance animation.

## Impact

- `frontend/src/features/panels/ui/PanelCreationModal.css` — one-line CSS fill-mode change (behavior-only).
- No change to `usePortalPopover`/`Select` (the shared JS positioning is already correct once the containing
  block is removed). No backend, API, or schema changes.

## Non-goals

- Building generic JS containing-block-offset compensation into `usePortalPopover`/`Select` — unnecessary given
  the audited scope is one CSS file, and higher regression risk on the non-dialog path.
- Migrating `PanelCreationModal` onto the shared `Modal` primitive (larger refactor; out of scope).
- Touch-target sizing (HEL-308, already shipped).
