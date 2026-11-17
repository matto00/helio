# HEL-1750: Dashboard list row ⋮ menu is clipped: only Rename, Duplicate and Share are visible, and the rest of the popover is cut off

## Description

In the dashboard list, the ⋮ actions menu on a dashboard row opens clipped. Only **Rename**, **Duplicate** and **Share** show, and the menu's lower items are cut off by its container. The owner saw this on 2026-11-17 in dark theme, on a list containing two "Standings" dashboards. The selected row had its changed dot showing.

The suspected cause is that the menu renders inside a container that clips or scrolls its content (`overflow: hidden/auto`) rather than in a portal or the top layer. Not verified.

## Acceptance criteria

- [ ] The whole menu is visible and every item can be clicked, from any row of the dashboard list, including the last row and a list long enough to scroll. Check on desktop and phone, in light and dark.
- [ ] The cause is found from a probe, such as the clipping ancestor and its computed overflow. The fix is not to guess a bigger container.
- [ ] Every other ⋮ / ActionsMenu inside a clipping container (rail, sidebar lists, tabs) is checked for the same problem. Any found are fixed or listed.
- [ ] An e2e fails first: open the menu on the last row and assert the last item is inside the viewport and is the element hit at its own centre (`elementFromPoint`).

## Agent notes

The screenshot shows the rail/sidebar dashboard list from the HEL-1570 re-design. The menu is likely the shared ActionsMenu/Popover; HEL-1675 recently changed its hover CSS but not its positioning. Compare against the running app per DESIGN.md.

Premise validation (orchestrator, static reading): ActionsMenu already portals its panel to document.body (or the nearest open <dialog>) with position: fixed, so an overflow ancestor should not clip it on desktop. The live cause is to be probe-confirmed.
