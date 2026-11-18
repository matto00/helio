## ADDED Requirements

### Requirement: Output editor footer labels fit their buttons on a narrow viewport
At a 375px-wide viewport, in both light and dark themes, every visible button in the Output editor sheet's footer
(Delete or its "Confirm delete (removes from N dashboard(s))" confirm, Cancel, "Add as tail with aggregate", Save) SHALL
contain its label: the label's rendered text SHALL NOT extend outside the button's border box horizontally or
vertically, no button SHALL be wider than the footer, and no button's label SHALL be broken onto more than two lines.
The confirm label SHALL keep its full text including the dashboard count. At a 1280px viewport the footer SHALL remain
a single row of single-line buttons, each `--control-md` tall, in the same horizontal arrangement it had before this
change. A footer button whose label fits on one line SHALL stay `--control-md` tall at every viewport.

#### Scenario: Confirm delete at 375px
- **WHEN** an Output placed on one dashboard is open in the editor at a 375px viewport and the user clicks Delete once
- **THEN** the button's text is exactly "Confirm delete (removes from 1 dashboard)"
- **AND** its label lies within the button's border box and spans at most two lines

#### Scenario: Add as tail with aggregate at 375px
- **WHEN** a chart Output that needs an aggregate is being created at a 375px viewport so "Add as tail with aggregate"
  is shown
- **THEN** that label lies within its button's border box and spans at most two lines

#### Scenario: Desktop footer unchanged
- **WHEN** the same confirm state is shown at a 1280px viewport
- **THEN** all footer buttons share one row, each label is a single line, and each button is `--control-md` tall
- **AND** the buttons' horizontal positions relative to the footer match the arrangement measured before the change
