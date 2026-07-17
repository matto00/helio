# mobile-dashboard-sheet Specification

## Purpose
Provides a tappable command-bar title and bottom-sheet picker so phone-width viewers can switch
dashboards, sources, pipelines, and registry items — the item-level navigation the collapsed
sidebar used to carry — without forking state or introducing a second overlay mechanism.
## Requirements
### Requirement: Tappable command-bar title on phone
Below the 768px breakpoint the command bar SHALL render a tappable title control showing the
current dashboard name on `/` (and the current section/item name on `/sources`, `/pipelines`,
`/registry`) with a small chevron glyph so it visibly reads as a control. At 768px and wider the
desktop breadcrumb markup and behavior SHALL be unchanged.

#### Scenario: Title visible and tappable on phone
- **WHEN** a dashboard is selected and the viewport is narrower than 768px
- **THEN** the command bar shows the dashboard name with a chevron, and tapping it opens the
  bottom sheet

#### Scenario: Desktop unchanged
- **WHEN** the viewport is 768px or wider
- **THEN** the phone title control is not rendered and the existing breadcrumb appears as before

### Requirement: Bottom sheet dashboard picker
Tapping the title on `/` SHALL open a bottom sheet listing all dashboards, sourced from the
existing `state.dashboards` selectors used by `DashboardList` (no forked state). Tapping an entry
SHALL select that dashboard via the same selection action `DashboardList` dispatches and dismiss
the sheet. The current dashboard SHALL be visually indicated. The sheet SHALL contain no
create/rename/delete/duplicate affordances.

#### Scenario: Switch dashboard from the sheet
- **WHEN** the user opens the sheet and taps a dashboard other than the current one
- **THEN** that dashboard becomes selected, its panels load, and the sheet dismisses

#### Scenario: Picker only — no CRUD
- **WHEN** the sheet is open
- **THEN** no create, rename, delete, duplicate, import, or export affordances are present

### Requirement: Sheet dismissal and surface compliance
The sheet SHALL be an opaque `--app-surface-strong` surface rendered through the existing overlay
infrastructure (portal + `useOverlay` registration, following the `Modal`/`Popover` patterns — no
third overlay mechanism). It SHALL dismiss on backdrop tap, on swipe-down, and on Escape, with a
single entrance animation that respects `prefers-reduced-motion`.

#### Scenario: Backdrop dismisses
- **WHEN** the sheet is open and the user taps the backdrop
- **THEN** the sheet dismisses without changing the selection

#### Scenario: Swipe-down dismisses
- **WHEN** the user drags the sheet downward past the dismiss threshold
- **THEN** the sheet dismisses without changing the selection

### Requirement: Same sheet mechanism for section item navigation
The frontend SHALL reuse the same title control and sheet component on `/sources`, `/pipelines`,
and `/registry` at phone width to list that section's items (the data `SidebarItemList` renders),
navigating on tap and exposing no editing affordances. The frontend MUST NOT introduce a second
overlay/list mechanism for this.

#### Scenario: Pick a pipeline on phone
- **WHEN** the user is on `/pipelines` at phone width and opens the sheet
- **THEN** the pipelines list appears, tapping one navigates to/selects it, and the sheet dismisses

#### Scenario: Empty section is not a dead end
- **WHEN** a section has no items and the user opens the sheet
- **THEN** an empty-state message is shown and the sheet can be dismissed normally

### Requirement: Sheet rows meet the 44px touch-target minimum
Every tappable bottom-sheet row SHALL have a rendered height of at least 44 CSS px at phone width —
dashboard rows on `/` and section-item rows on `/sources`, `/pipelines`, and `/registry` alike —
following the codebase's established 44px tap-target convention (`BottomNav.css`,
`PanelDetailModal.css` mobile block). The minimum SHALL be enforced in CSS and locked by a static
CSS regression test in the style of the existing `*.css.test.ts` locks.

#### Scenario: Dashboard rows measure at least 44px

- **WHEN** the dashboard picker sheet is open at a 390px-wide viewport
- **THEN** every dashboard row's bounding-client-rect height is ≥ 44px

#### Scenario: Section item rows measure at least 44px

- **WHEN** the sheet is open on `/sources`, `/pipelines`, or `/registry` at a 390px-wide viewport
- **THEN** every item row's bounding-client-rect height is ≥ 44px

#### Scenario: CSS lock guards the minimum

- **WHEN** the sheet-row rule in `MobileNavSheet.css` loses its ≥44px minimum
- **THEN** a static CSS regression test fails

