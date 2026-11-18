# Files modified (HEL-1756)

Shared files edited (named for the PR):
- `frontend/src/hooks/usePortalPopover.ts` -- one additive return value, `reposition()` (stable callback that re-runs the opted-in `place`; the resize listener now calls it). Existing consumers unaffected; own unit test.
- `frontend/src/features/panels/provenance/ProvenanceTrigger.tsx` -- `computePos`/`MIN_ROOM_BELOW` replaced by a measured `placeProvenance` using `fitPanelVertically` with the 70vh/480px cap and 8px horizontal clamp; passes `placed`, `panelRef`, `reposition` down.
- `frontend/src/features/panels/provenance/ProvenancePopover.tsx` -- merges the hook's `panelRef` with its local ref, hidden until placed, `maxHeight` applied, focus-in keyed on `placed`, ResizeObserver on a new inner content wrapper calls `reposition()`, HEL-1207 doc comment updated.
- `frontend/src/features/panels/provenance/ProvenancePopover.css` -- the column layout and gap moved to `.provenance-popover__inner`; the panel keeps the cap and scroll (spacing unchanged).
- `frontend/src/shared/ui/panelFit.ts` -- NOT touched.
- `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.css` -- (cycle 2) the new `.dashboard-appearance-editor__panel` scroll class.
- `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.tsx` -- (cycle 2) measured placement via `fitPanelVertically`, hook `panelRef` on the form, hidden until placed, `maxHeight`, scroll on the new `.dashboard-appearance-editor__panel` class, ResizeObserver on an inner wrapper calling `reposition()`. (cycle 3, D14) focus moves into the form once placed.
- UserMenu -- NOT touched (probes.md: fits).

Tests / evidence:
- `frontend/src/hooks/usePortalPopover.test.tsx` -- reposition unit tests.
- `frontend/src/features/panels/provenance/ProvenanceTrigger.placement.test.tsx` -- placement, hidden-until-placed, focus, focus-out and re-fit unit tests.
- `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.placement.test.tsx` -- editor placement, hidden/focus, keep-open and re-fit unit tests.
- `e2e/hel1756-popover-viewport-fit.spec.ts`, `e2e/support/hel1756Seed.ts` -- new real-browser e2e (provenance and appearance editor) and its seed.
- `e2e/hel1750-actions-menu-viewport-fit.spec.ts` -- last-row, scrolled-to-end rail guard (shift measured before the settle poll, cycle 2).
- `openspec/changes/fit-remaining-popovers-viewport/{probes,red-evidence,files-modified}.md`, `tasks.md`.
