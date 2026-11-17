- `frontend/src/shared/ui/panelFit.ts` — new shared vertical-fit helper (prefer side, flip when other side roomier, cap to room, no-layout rule)
- `frontend/src/shared/ui/panelFit.test.ts` — unit tests of the helper (both prefer sides, flip, cap, no-layout)
- `frontend/src/shared/ui/selectPanelFit.ts` — `fitSelectPanel` now a wrapper over the helper (gap 4, cap 280, prefer below); `selectPanelFit.test.ts` untouched and green
- `frontend/src/shared/chrome/ActionsMenu.tsx` — measured placement via `usePortalPopover` `place`; hidden until placed; maxHeight inline; focus once placed; `align` doc rewritten
- `frontend/src/shared/chrome/ActionsMenu.css` — `overflow-y: auto` on the panel
- `frontend/src/shared/chrome/ActionsMenu.test.tsx` — new describe "viewport fit (HEL-1750)" appended; existing tests (incl. HEL-719 align) unmodified
- `e2e/hel1750-actions-menu-viewport-fit.spec.ts` — new e2e (desktop rail last row 1280x400; phone-width short viewport step sheet)
- `frontend/src/hooks/usePortalPopover.ts` — imports the shared `VIEWPORT_MARGIN` constant (cycle 2; no behaviour change)

## Evidence (scratch: /home/matt/Development/helio/.concertino/scratch/HEL-1750/)

### 1.1 Probe on unchanged code (last dashboard-list row, 1280x400, e2e run)
trigger y=357 (h 24); panel top 394, bottom 624 (this run; 5 items); innerHeight 400; last item "Delete" top 575 bottom 619;
`elementFromPoint` at its centre is NOT the item (hitIsItem false). Cause: portalled `position: fixed` panel at one-shot
`trigger.bottom + 8`, no collision handling. No clipping ancestor (premise-validation.md).

### 1.2 e2e red on unchanged code (e2e-red-unfixed.txt)
- desktop: `Expected: <= 400  Received: 619` (last item bottom), hitIsItem false.
- phone (short viewport, step sheet "Step actions"): innerHeight 300, last item bottom 342, hitIsItem false.
Green after fix (e2e-green-fixed.txt): desktop panel 124-354, last item 305-349 hit true; phone panel 73-292 (capped, scrolls) last item hit true.

DEVIATION from design D8 (phone case): the Output menu (SpineOutputs, ONE item) cannot be made red on a phone. Its trigger must sit above
`.bottom-nav` (68px) to be tappable, which always leaves >= room for one touch item (menu bottom lands at innerHeight-14, inside
the 8px margin). Measured on unchanged code at 390x844: trigger bottom 732, menu 740-794, fits, hit true. SpineStepRow has no phone
row menu (phone rows have no menu; Step actions lives in the sheet). The phone case therefore uses the multi-item step sheet menu
(MobileStepSheet, inside a modal dialog) at 390x300 (short phone, e.g. landscape/keyboard). Alternative tried and recorded: Output menu.

### Unit-test reds (design D9, labelled honestly)
- Against UNFIXED ActionsMenu.tsx (unit-red-unfixed.txt): red = flip, open-below(maxHeight inline), cap, hidden-when-first-measured.
- Focus test: red only against the INTERMEDIATE state (visibility hidden added, focus still on `[isOpen]`) — unit-red-intermediate-focus.txt. Passes on today's code (never hidden), as the design gate predicted.
- Left-edge test: a GUARD, not red against unfixed code (the hook's existing clamp already shifts a right-anchored panel). It is failable by mutation: removing BOTH the new place clamp and the hook clamp turns it red (unit-red-mutation-noclamp.txt). The test asserts exact right = 242px, so a double shift (place + hook) would fail it: no double-shift observed (hook measures the already-fitting panel, overflowLeft < 1, no-op).

### 3.2 Call-site audit (13 production sites; all share ActionsMenu, so all inherit the fit)
| Site | Live probe (last item inside viewport + hit) |
|---|---|
| DashboardList (rail) | YES, e2e + audit, 1280x400 light+dark: flipped above, hit true |
| SidebarItemList | NOT reachable live: its ActionsMenu renders only when the `onDelete` prop is set, and its only production consumer (AssistantContextList) passes none (HEL-663: no delete endpoint), so no instance of this site renders a menu in the app today. Probed instead: DashboardList, which renders the same `dashboard-list__item-row` markup/CSS and the same ActionsMenu trigger structure (flipped above, hit true). Covered by the shared component. |
| DashboardFolderGroup | inherits (same rail list); not probed |
| CommandBar | inherits (top of page, opens below with room); not probed |
| DashboardMetaRow | inherits (top bar); not probed |
| PanelCardHeader | YES, panel low on a dashboard, 1280x400 light+dark: panel 234-368 flipped above, hit true |
| MobilePipelineHeader | inherits (top of phone page); not probed |
| MobileStepSheet | YES, in dialog, 390x300 light+dark: capped 73-292, scrolls, last item hit true; panel is inside the dialog (portal target) and is not clipped by it |
| SpineOutputs | YES (unchanged-code probe above, 390x844): fits; one item |
| PipelineSpineHeader | inherits; not probed |
| SpineSourceCard | inherits; not probed |
| SpineStepRow | YES, desktop 1280x400 light+dark: panel 59-224 flipped above, hit true |
| ConnectorsPage | inherits; not probed |
Phone dashboard list (MobileNavSheet: Share button only) and phone panel cards (PanelCardBody, no header) have no three-dot menu — satisfied by absence (confirmed at design gate).
Other popovers (UserMenu, DashboardAppearanceEditor, panel provenance) are NOT changed; follow-up candidates if exposed to the same short-viewport overflow (not probed).

### 3.3 Visual check
Screenshots in scratch: dashlist-{dark,light}.png, panelcard-*, spinestep-*, phone-stepsheet-{dark,light}.png (flipped above / capped with internal scroll; styling unchanged).

## Cycle 2 (evaluation-1.md)
- CR1: spec scenario, design D8 phone bullet (SpineOutputs arithmetic 776+8+54=838 <= 844) and tasks 3.1 amended to the built phone case (step sheet, 390x300).
- CR2: `hasTouch` now only on a nested `phone` describe; the desktop case runs with a fine pointer (mouse menu, 165px panel). Red re-confirmed against the UNFIXED base ActionsMenu.tsx (e2e-red-unfixed-cycle2.txt): desktop last item bottom 554 > 400, panel 394-559, hit false; phone 342 > 300. (A first revert run appeared green because Vite had not yet reloaded the reverted file; re-run after a 5s wait is the recorded red.) Green after restoring the fix: 2 passed (e2e-green-cycle2.txt).
- CR3: see the SidebarItemList row above (no rendering instance exists).
- Non-blocking taken: one shared `VIEWPORT_MARGIN` (exported from panelFit.ts, used by ActionsMenu and usePortalPopover); spec reworded to the left-edge-only clamp; phone tap asserts the menu closed; unit test renamed "opens below at its natural height when it fits". Files also touched: `frontend/src/hooks/usePortalPopover.ts` (import of the shared constant).
