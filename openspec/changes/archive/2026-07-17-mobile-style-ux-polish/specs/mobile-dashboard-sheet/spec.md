## ADDED Requirements

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
