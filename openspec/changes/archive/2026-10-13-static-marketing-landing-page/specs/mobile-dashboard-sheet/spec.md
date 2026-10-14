## MODIFIED Requirements

### Requirement: Tappable command-bar title on phone
Below the 768px breakpoint the command bar SHALL render a tappable title control showing the current
dashboard name on `/home` (and the current section/item name on `/sources`, `/pipelines`, `/registry`) with a
small chevron glyph so it visibly reads as a control. At 768px and wider the desktop breadcrumb markup and
behavior SHALL be unchanged. The control SHALL open the top-anchored navigation sheet, and SHALL close it
again when tapped while the sheet is open. Its chevron glyph SHALL indicate the sheet's open/closed state.

#### Scenario: Title visible and tappable on phone
- **WHEN** a dashboard is selected and the viewport is narrower than 768px
- **THEN** the command bar shows the dashboard name with a chevron, and tapping it opens the top-anchored
  navigation sheet

#### Scenario: The chevron reflects sheet state
- **WHEN** the sheet is open
- **THEN** the trigger's chevron indicates the open state rather than continuing to point toward an
  unopened sheet

#### Scenario: Desktop unchanged
- **WHEN** the viewport is 768px or wider
- **THEN** the phone title control is not rendered and the existing breadcrumb appears as before

### Requirement: Top-anchored item picker
Tapping the title on `/home` SHALL open the navigation sheet listing all dashboards, sourced from the existing
`state.dashboards` selectors used by `DashboardList` (no forked state). Tapping an entry SHALL select that
dashboard via the same selection action `DashboardList` dispatches, and dismiss the sheet. The current
dashboard SHALL be visually indicated. The sheet SHALL contain no rename, delete, duplicate, import, export,
or actions-menu affordance. It SHALL expose at most one create affordance, as specified by
"Section-appropriate create action in the sheet".

#### Scenario: Switch dashboard from the sheet
- **WHEN** the user opens the sheet and taps a dashboard other than the current one
- **THEN** that dashboard becomes selected, its panels load, and the sheet dismisses

#### Scenario: Create is the only mutation affordance
- **WHEN** the sheet is open
- **THEN** no rename, delete, duplicate, import, export, or actions-menu affordance is present
