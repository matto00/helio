- `frontend/src/shared/ui/panelFit.ts` — `bottomInset` option on `fitPanelVertically`; `readBottomInset` (measured bottom nav, dialog-aware, safe-area probe)
- `frontend/src/shared/ui/selectPanelFit.ts` — `bottomInset` parameter
- `frontend/src/shared/ui/Select.tsx` — passes the shared inset
- `frontend/src/shared/chrome/ActionsMenu.tsx` — passes the shared inset
- `frontend/src/features/panels/provenance/useProvenancePopoverHost.tsx` — passes the shared inset
- `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.tsx` — passes the shared inset
- `frontend/src/features/pipelines/ui/outputSchemaPanelPlacement.ts` — uses the shared reader instead of its own nav measurement
- `frontend/src/shared/ui/panelFit.test.ts`, `selectPanelFit.test.ts` — unit tests for the inset and reader
- `e2e/hel1762-popover-clears-bottom-nav.spec.ts` — red-before/green-after phone e2e
- `openspec/changes/popover-fit-clears-bottom-nav/tasks.md`, `files-modified.md` — bookkeeping

Task 3.2 findings: UserMenu (`placement="nav"`) opens above its bottom-nav trigger, so it cannot sit under the nav; no change. The HEL-1746 ask drawer is a `BottomSheet` over `Modal` (`showModal`), so `readBottomInset`'s open-dialog rule applies and it reserves no nav band.
