# mobile-dashboard-chips Specification

## Purpose
Lets a phone user switch between dashboards in one tap from a horizontally scrollable chip row on the dashboard
view, replacing the open-sheet-then-pick round trip for the dashboards they use most.

## Requirements

### Requirement: Phone dashboard view shows a dashboard chip row
On the phone shell (viewport at or below 768px), the dashboard view SHALL render a single horizontally scrollable row
of dashboard chips above the dashboard's panels (and below any bar rendered above the dashboard view), whenever the user has at least one dashboard. The row SHALL list
the user's recently visited dashboards (most recent first), then the remaining dashboards in the existing
dashboard-list order, up to a bounded count, always including the current dashboard. The order SHALL stay stable
within a session: tapping a chip or switching dashboards SHALL NOT reorder the row. The first chip SHALL start 12px
from the screen edge. Each chip SHALL show the dashboard name (truncated with an
ellipsis when long) and SHALL be a control with an accessible name equal to the dashboard name. The row SHALL NOT
render at desktop widths, nor on non-dashboard routes.

#### Scenario: Chip row visible on a phone dashboard
- **WHEN** a signed-in user with two or more dashboards opens the dashboard view at 375px
- **THEN** a row of dashboard chips renders below the command bar, each labelled with a dashboard name

#### Scenario: Not rendered on desktop or other routes
- **WHEN** the viewport is wider than 768px, or the route is not the dashboard view
- **THEN** no dashboard chip row renders

### Requirement: One tap on a chip switches the dashboard
Tapping a chip SHALL open that dashboard in one tap, with no intermediate sheet or confirmation, regardless of how
the current dashboard was chosen (including via the switcher sheet), and the dashboard's
panels SHALL load as they do for any other dashboard selection. The opened dashboard's address SHALL be
`/dashboards/<id>`.

#### Scenario: Tap switches dashboards
- **WHEN** the user taps a chip for a dashboard other than the current one
- **THEN** that dashboard's panels render and its chip becomes the active chip

#### Scenario: Tap works after a sheet selection
- **WHEN** the user taps chip A, then picks dashboard B from the switcher sheet, then taps chip A again
- **THEN** dashboard A is shown again after that single tap

#### Scenario: Order is stable across taps
- **WHEN** the user taps several chips in turn
- **THEN** the chips keep the same left-to-right order throughout

### Requirement: The active chip is filled, exposed and in view
Exactly one chip SHALL be the active chip: the current dashboard's. It SHALL be visually filled with inverted ink (text-coloured
fill, surface-coloured label), distinct from the outlined inactive chips, without using the accent and SHALL expose its state to
assistive technology (`aria-current`). On load, and whenever the current dashboard changes, the row SHALL scroll so
the active chip is fully inside the visible part of the row. Every chip SHALL meet the 44px touch-target floor with hit
areas that do not overlap.

#### Scenario: Active chip scrolled into view on load
- **WHEN** the current dashboard's chip would otherwise sit beyond the row's visible width
- **THEN** after load the active chip is fully within the row's visible bounds

#### Scenario: Active chip exposed
- **WHEN** the chip row renders
- **THEN** exactly one chip carries `aria-current` and it names the current dashboard

#### Scenario: Touch targets tile
- **WHEN** the chip row renders on a coarse pointer
- **THEN** each chip's hit area is at least 44px tall and no two chips' hit areas overlap
