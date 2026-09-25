# chart-drilldown-inspect Specification

## Purpose
Defines the click→selection→inspect interaction on chart panels: clicking a
rendered chart element selects the underlying data point/category, stores a
reusable selection descriptor in panel view state, and opens an inspect view
listing the exact underlying rows — the interaction primitive HEL-588
(cross-filtering) consumes.

## Requirements

### Requirement: Clicking a chart element selects its category/series
When a user clicks a rendered element of a chart panel's series (a bar, line
point, pie slice, or scatter point), the system SHALL identify the clicked
element's category (x value) and series name, map them back to the panel's
bound source columns via its `fieldMapping`, and store a selection
descriptor (`panelId`, `dimension`, `value`, `series`) in panel view state,
where `dimension` is the SOURCE COLUMN NAME the selection is keyed on (e.g.
`"quarter"`), `value` is the clicked category/label itself (e.g. `"Q1"`),
and `series` identifies the clicked measure or group (the y-column's name
for a single series, or the clicked group's value when grouped). Mapping
SHALL account for the chart type actually rendered — bar/line single-series,
bar/line multi-series (grouped by `fieldMapping.series`), pie, and scatter
(including color-grouped scatter) each identify their clicked element
differently. Chart types with no such mapping available are excluded from
this requirement rather than mapped dishonestly.

#### Scenario: Click on a single-series bar selects its column and category
- **WHEN** the user clicks a bar in a single-series bar chart
- **THEN** a selection descriptor is stored with `dimension` set to the
  chart's mapped x-axis column name, `value` set to that bar's x-axis
  category, and `series` set to the chart's one series (y-column) name

#### Scenario: Click on one series of a multi-series line chart selects category and series
- **WHEN** the user clicks a point belonging to one series of a multi-series
  line chart
- **THEN** the stored selection's `value` is that point's x-axis category
  and `series` is the clicked series' name, not any other series sharing
  that category

#### Scenario: Click on a pie slice selects its category
- **WHEN** the user clicks a slice of a pie chart
- **THEN** the stored selection's `value` is that slice's `name`

#### Scenario: Click on a scatter point selects its x value and group
- **WHEN** the user clicks a point in a color-grouped scatter chart
- **THEN** the stored selection's `value` is that point's x-axis value and
  `series` is that point's group value

### Requirement: The selection descriptor is view state, cleared on panel/dashboard switch
The selection descriptor SHALL be stored as transient, non-persisted view
state and SHALL be cleared when the owning panel is removed, or when the
user navigates to a different dashboard. A panel's selection is NOT cleared
merely because a different panel's inspect view is opened or closed, or
because the same panel's inspect view is closed without an explicit
clear/return action — clearing is driven only by panel removal, dashboard
navigation, or the inspect view's own clear/return control (see the
"Selecting a chart element opens an inspect view" requirement below).

#### Scenario: Switching dashboards clears the selection
- **WHEN** a chart element is selected on dashboard A and the user
  navigates to dashboard B
- **THEN** no stale selection descriptor for dashboard A's panel remains in
  view state

#### Scenario: Reloading the page clears the selection
- **WHEN** a chart element is selected and the page is reloaded
- **THEN** no selection is restored — the descriptor was never persisted

### Requirement: Selecting a chart element opens an inspect view of its underlying rows
Selecting a chart element (by click or by the keyboard Inspect entry, see
below) SHALL open an inspect view that lists, via a data grid, exactly the
currently-loaded rows matching the selection's category/series — the same
rows the chart itself plotted, not a separate server query. The inspect
view SHALL show a labeled header identifying what is being shown (e.g.
"Showing rows for {category}/{series}") and a control to clear the
selection and return. When the panel's data is truncated (more rows exist
upstream than are currently loaded), the inspect view SHALL say so rather
than imply it lists every matching row.

#### Scenario: Inspect view lists exactly the plotted rows for the selection
- **WHEN** the user selects a chart element mapping to category "Q1" /
  series "Revenue"
- **THEN** the inspect view's grid shows exactly the loaded rows whose
  mapped x-column equals "Q1" and series-column equals "Revenue", and no
  others

#### Scenario: Inspect view discloses truncation
- **WHEN** the selected panel's data is truncated (more rows exist upstream
  than are loaded)
- **THEN** the inspect view's header or body text discloses that only the
  loaded rows are being shown, not the complete set

#### Scenario: Clear control returns from the inspect view
- **WHEN** the user activates the inspect view's clear/return control
- **THEN** the inspect view closes and the panel's selection descriptor is
  cleared

#### Scenario: Inspect works from both the in-grid panel and fullscreen
- **WHEN** a chart element is clicked while the panel is rendered in the
  dashboard grid, and separately while the same panel is open in the
  fullscreen overlay
- **THEN** the inspect view opens correctly in both contexts without
  stacking on top of another open modal incorrectly (no broken focus trap,
  no broken Escape handling)

### Requirement: Clickable chart elements are visually and programmatically discoverable
Chart elements that support the click→inspect interaction SHALL render with
a pointer cursor. The panel's `ActionsMenu` SHALL include an "Inspect"
entry that opens the inspect view for the panel's current selection (or an
informative empty state when nothing is currently selected), for users who
cannot or do not click a chart element directly.

#### Scenario: Pointer cursor over a clickable chart element
- **WHEN** the user hovers a clickable series element of a chart panel
- **THEN** the cursor renders as a pointer

#### Scenario: Keyboard user opens Inspect via the actions menu
- **WHEN** a keyboard user opens the panel's `ActionsMenu` and activates
  "Inspect"
- **THEN** the inspect view opens (showing the current selection, or an
  empty state if nothing is selected) without requiring a pointer click on
  the chart

### Requirement: Click wiring applies independent of stored chart appearance
The click→selection interaction and its cursor affordance SHALL be wired
unconditionally for every chart panel, independent of whether the panel has
a stored `appearance.chart` value.

#### Scenario: Click works on a chart panel with no stored appearance
- **WHEN** a chart panel has no stored `appearance.chart` (renders via the
  default/placeholder option)
- **THEN** clicking a rendered chart element still selects it and opens the
  inspect view exactly as for a panel with a stored appearance
