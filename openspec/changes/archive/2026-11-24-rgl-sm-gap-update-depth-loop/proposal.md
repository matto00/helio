## Why

A full page load of some dashboards logs "Maximum update depth exceeded" 3-9 times (HEL-1618 final gate, text panels
only). The page settles, but a render loop on load wastes work, can starve the main thread on slower devices, and
hides any real error in the console. The ticket blamed a column gap in a valid `sm` layout; the probe REFUTED that:
a layout with no gap loops too. The real trigger is a stored breakpoint layout that is empty (derived at render, e.g.
`md` empty with `sm` authored), with several panels, on a load where the loading skeleton's pre-measure breakpoint
(`md`, from `initialWidth` 1280) differs from the measured one (seen at `sm` and `lg`). The looping grid is the
loading skeleton's `Responsive`, not `DesktopPanelGrid`: one render changes both its `layouts` and its breakpoint, the
react-grid-layout 2.2.4 defect HEL-1575 met, and the skeleton key (dashboard id) did not cover it.

## What Changes

- Key the skeleton grid (`DesktopPanelGridSkeleton.tsx`) by dashboard id AND active breakpoint, so a load never
  changes breakpoint and layouts in one render of a live instance. The fix removes the cause, never filters the
  console error, and is not tied to one viewport width.
- Add a red-first end-to-end test of the reproducing layout (zero "Maximum update depth" errors, no layout `PATCH`
  during load, stored `sm` positions) and a jest guard on the skeleton.

## Capabilities

### New Capabilities

### Modified Capabilities
- `breakpoint-layout-resolution`: adds a requirement that loading a dashboard renders its grid without a render loop
  and without writing its layout.

## Non-goals

- Changing any layout geometry, derivation or repair rule (`breakpoint-layout-resolution` rules stay as they are).
- Patching, forking or upgrading react-grid-layout. A required library change is escalated first.
- The mobile stack (< 768 px), which does not use RGL.

## Impact

- `frontend/src/features/panels/ui/grid/DesktopPanelGridSkeleton.tsx` (the fixed file; the real `DesktopPanelGrid`
  is untouched).
- New e2e spec under `e2e/`; new or extended jest test next to the grid.
- No backend, schema or migration change. No visual change.
