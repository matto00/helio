## Why

HEL-1750 fixed the shared ⋮ `ActionsMenu`, which was clipped in short windows, by fitting it with the shared
`fitPanelVertically` helper (`frontend/src/shared/ui/panelFit.ts`) through `usePortalPopover`'s measured `place`
option. Three other portalled popovers (UserMenu, DashboardAppearanceEditor, the panel provenance popover) still place
themselves from the trigger rect alone, with no measurement of their own height, so each may run past the bottom or an
edge of a short window. HEL-1750's review also found that its rail page-height guard only hovers a middle row with the
page unscrolled; hovering the last row with the page scrolled to its end catches the 34px row shift on its own.

## What Changes

- Probe each of the three popovers at short desktop windows (1280x400 and similar) and on phone (390 wide, short), in
  light and dark, and record per popover whether any item/control can end up outside the viewport or unreachable.
- Every popover the probe shows can clip moves to `usePortalPopover({ place })` plus `fitPanelVertically` (and the
  horizontal clamp pattern `ActionsMenu` already uses), opening on its existing preferred side, flipping when the other
  side has more room, else capping its height and scrolling inside itself. Each such fix gets an e2e that is red on the
  unfixed code, asserting `document.elementFromPoint` at the centre of the popover's last item/control returns it.
- A popover the probe shows already fits is left unchanged, and the PR states why, with the probe numbers.
- The `e2e/hel1750-actions-menu-viewport-fit.spec.ts` rail guard additionally hovers the LAST rail row with the page
  scrolled to its end and asserts the row does not move; the mutation that turns this alone red (reverting D10's
  `position: relative` on `.dashboard-list`) is recorded.
- No backend change, no Flyway migration, no model call. `panelFit.ts` is reused unchanged. `usePortalPopover.ts`
  gets one additive, backward-compatible change if any popover is converted: it returns a `reposition()` function that
  re-runs an opted-in `place` (design D7), so a popover whose content grows after open can re-fit. Existing consumers
  are unaffected; the PR names this shared-file edit.

## Capabilities

### New Capabilities
- `popover-viewport-fit`: UserMenu, DashboardAppearanceEditor and the panel provenance popover keep every item/control
  reachable inside the viewport in short windows on desktop and phone.

### Modified Capabilities
- `actions-menu-viewport-fit`: adds a requirement that hovering the last dashboard-list row, with the page scrolled to
  its end, does not move the row (the D10 phantom-page-scroll regression, guarded on the last row).

## Impact

- Frontend only: `frontend/src/features/auth/ui/UserMenu.tsx`,
  `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.tsx`,
  `frontend/src/features/panels/provenance/ProvenanceTrigger.tsx` / `ProvenancePopover.tsx` (only those the probe
  shows can clip), plus their CSS if a scroll container is needed.
- New e2e spec for the fixed popovers; extended `e2e/hel1750-actions-menu-viewport-fit.spec.ts`; unit tests beside each
  placement function.
- Shared files: `panelFit.ts` untouched; `usePortalPopover.ts` gets the one additive `reposition()` return (D7) if any
  popover is converted. Concurrent lanes HEL-1734/HEL-1742 may touch the provenance popover; the PR names every shared
  file edited.
