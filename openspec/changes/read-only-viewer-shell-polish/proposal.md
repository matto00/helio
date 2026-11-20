## Why

HEL-1773 lets a viewer grantee open a shared dashboard read-only, but the shell around it still behaves as if the caller could edit. Nothing says the dashboard is view-only. The layout undo/redo shortcuts stay live. The phone chip's "Shared" marker looks different from the sidebar and Home badges. A user whose only dashboards are shared with them lands on the generic "No dashboard open" state, and nothing offers to build their own. This change finishes that experience (HEL-1782, child 4 of HEL-1773).

## What Changes

- A "View only" indicator in the desktop dashboard meta row and the phone meta line, for viewers only. An editor or the owner does not see it.
- An audit of the empty states and calls to action a viewer can reach on a dashboard: none invites editing. Tests lock the existing viewer gates (the zero-panel empty state, the palette's "New panel" entry, the meta row's edit controls).
- The layout undo/redo keyboard shortcuts do nothing on a dashboard the caller cannot edit. The layout-edit Escape handler is already inert, because a viewer cannot enter edit mode.
- Command palette: entries that edit the open dashboard are absent for a viewer. Global "New dashboard/source/pipeline" entries stay, because they create the caller's own resources. The quick launcher (the assistant) is already read-only for viewers (HEL-1785) and does not change.
- Phone: the dashboard sheet, chip row and pull-to-refresh behave correctly for viewers and editors. Pull-to-refresh refreshes a shared dashboard through the grantee-safe routes. The sheet offers no owner-only action to a non-owner.
- First run for a shared-only user (owner rulings, 2026-11-19):
  - On /dashboards, a user who owns no dashboard gets the most recently updated shared dashboard opened automatically.
  - Home shows the existing first-run drop zone under the shared shelf.
  - The sidebar dashboards list and the phone dashboard sheet show a "Build your own dashboard" row while the user owns no dashboard. Choosing it closes the open dashboard and shows the drop zone in its place.
- The phone chip's "Shared" marker uses the same badge style as the sidebar and Home badges, and stays legible on the active (inverted) chip.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `dashboard-grantee-access`: the landing rule gains a shared-dashboard fallback for a user who owns none. New requirements cover the "View only" indicator, inert edit shortcuts, palette entries, phone behaviour, the shared-only first run and a single "Shared" badge style.

## Impact

- Frontend only. No backend change, no migration and no API change.
- Files touched: `app/dashboardMeta/*` (meta facts and the phone refresh line), `features/layout/hooks/useLayoutUndoRedo.ts`, `features/dashboards/state/dashboardsSlice.ts` (the landing fallback and the build-your-own state), `features/dashboards/ui/DashboardList.tsx`, `features/dashboards/ui/DashboardChipRow.{tsx,css}`, `shared/chrome/usePickerSelection.ts` and `MobileNavSheet.tsx`, `features/home/ui/DashboardShelf.tsx`, `features/panels/ui/PanelList.tsx`, plus component tests and one e2e spec.
- Sibling lanes: HEL-1783 (in Execution) may touch `dashboardsSlice.ts` and `usePanelData`. This change edits `dashboardsSlice.ts`'s `getMostRecentDashboardId` and adds one small piece of state. Whichever merges second rebases on the other's slice edit (see design.md D7).
