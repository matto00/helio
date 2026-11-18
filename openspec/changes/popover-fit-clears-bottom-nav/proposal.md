## Why

On phone, the shared popover fit (HEL-1750/HEL-1756) sizes popovers against the whole window height, so a popover that
opens below its trigger can extend into the band the floating bottom nav (and the home-indicator safe area) occupies.
The HEL-1744 evaluator measured the provenance popover's bottom at y=800 against a nav top of ~776 at 390x844: its last
item sits in the nav's band instead of in the area the app reserves for content.

## What Changes

- The shared vertical fit learns a bottom inset: the band at the bottom of the viewport that is not usable (the bottom
  nav's measured band when the nav is rendered and not covered by an open modal dialog, else the bottom safe-area
  inset). Room below a trigger is measured to the top of that band; the CSS anchor values are still computed against
  the real viewport.
- One shared reader measures that inset from the real layout (the rendered `.bottom-nav` element's rect, and the
  `env(safe-area-inset-bottom)` value), not a hard-coded pixel constant.
- Every consumer of the shared fit passes the inset: the provenance popover (panel trigger and citation chip), the
  shared actions menu, the Select listbox, and the dashboard appearance editor. The Output schema panel, which already
  measured the nav itself, switches to the shared reader so there is one definition.
- e2e at 390x844 and a short phone viewport, light and dark, proving the popover's last item clears the nav (red
  before, green after).

## Capabilities

### New Capabilities

### Modified Capabilities
- `popover-viewport-fit`: adds a requirement that popovers using the shared fit treat the phone bottom nav and the
  bottom safe-area inset as outside the usable area.

## Impact

- `frontend/src/shared/ui/panelFit.ts` (+ test), `frontend/src/shared/ui/selectPanelFit.ts` (+ test),
  `frontend/src/shared/ui/Select.tsx`, `frontend/src/shared/chrome/ActionsMenu.tsx`,
  `frontend/src/features/panels/provenance/useProvenancePopoverHost.tsx`,
  `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.tsx`,
  `frontend/src/features/pipelines/ui/outputSchemaPanelPlacement.ts`.
- New e2e spec `e2e/hel1762-popover-clears-bottom-nav.spec.ts`.
- No backend, schema or API change. Desktop placement is unchanged (no nav rendered, safe area 0).
