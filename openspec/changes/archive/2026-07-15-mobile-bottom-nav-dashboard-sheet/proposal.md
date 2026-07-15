# Proposal: mobile-bottom-nav-dashboard-sheet (HEL-302, spec W3)

## Why

Below 768px Helio's shell is a broken stub: `App.css:335` pins `.app-sidebar` fixed and collapses it
to `width: 0` with no way to reopen it — deleting both section navigation and the app's only
dashboard switcher (`DashboardList`, which lives inside the sidebar). The mobile PWA project
(`notes/mobile-pwa-handoff.md` §W3, binding) requires native-feeling navigation: a bottom tab bar
for section nav and a tappable-title bottom sheet for item switching.

## What Changes

- New `shared/chrome/BottomNav.tsx` + `.css`: opaque, breakpoint-gated bottom tab bar with four
  destinations (`/`, `/sources`, `/pipelines`, `/registry`), shared destination definitions with the
  desktop sidebar nav so the two cannot drift. Accent active state, safe-area inset, ≥44pt targets.
- New bottom-sheet item picker: the command bar's dashboard title becomes tappable on phone
  (name + chevron) and opens a sheet listing dashboards, sourced from the existing
  `state.dashboards` selectors. Tap to switch; backdrop-tap and swipe-down dismiss. Picker only —
  no CRUD affordances.
- The same title-control + sheet mechanism serves `/sources`, `/pipelines`, `/registry`
  (`SidebarItemList` data) — one mechanism, not two.
- Below the gate the broken fixed-sidebar stub is replaced by the new shell; the desktop sidebar is
  hidden there and untouched at ≥768px.
- Mid-implementation human design checkpoint (screenshots of tab bar + sheet) before full build-out;
  terminal state is "ready for device testing" with a build and an ordered on-device test plan.

## Capabilities

### New Capabilities
- `mobile-bottom-nav`: breakpoint-gated bottom tab bar for section navigation on phone.
- `mobile-dashboard-sheet`: tappable command-bar title opening a bottom-sheet picker for
  dashboards (and section items on other routes) on phone.

### Modified Capabilities

(none — desktop/iPad ≥768px behavior is unchanged; no backend or schema changes)

## Non-goals

- Panel sizing / grid stacking (HEL-301, parallel worktree — do not touch `PanelGrid` or renderers).
- PWA shell (HEL-300, shipped).
- Dashboard/item CRUD on phone; mobile editors.
- Backend, `schemas/`, or API contract changes.

## Impact

- `frontend/src/app/App.tsx`, `App.css` — shell wiring, mobile media block replacement.
- New files under `frontend/src/shared/chrome/` (BottomNav, sheet, shared nav destinations).
- Reuses `OverlayProvider`, `Popover.css`/`Modal.css` overlay patterns, `dashboardsSlice` selectors.
- Jest component tests for new components; no dependency changes.
