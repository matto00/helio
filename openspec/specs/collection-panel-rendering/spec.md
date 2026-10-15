# collection-panel-rendering Specification

## Purpose
Defines how an `output` panel bound to a collection-kind Output renders one metric item per loaded row, in grid or list layout, including the empty state and overflow behavior.

## Requirements

### Requirement: Grid and list layouts
The collection body SHALL render items in the configured layout. `grid` SHALL use responsive
auto-fill columns that wrap to the available width — producing no horizontal overflow at any
supported width, including 390px phone width. `list` SHALL render a single column with a subtle
divider between items. Both layouts SHALL use design tokens for spacing.

#### Scenario: Grid wraps instead of overflowing
- **WHEN** a grid-layout collection with many items renders at 390px viewport width
- **THEN** items wrap into the columns that fit and the document body does not scroll horizontally

#### Scenario: List renders one item per row
- **WHEN** a collection panel with `layout: "list"` renders 3 items
- **THEN** the items appear in a single column separated by dividers

### Requirement: Desktop overflow scrolls inside the panel
On the desktop grid, when rendered items exceed the panel's height, the collection body SHALL
scroll vertically within the panel (table-panel precedent); items SHALL never spill outside the
panel card.

#### Scenario: Tall collection scrolls internally on desktop
- **WHEN** a desktop collection panel's items exceed its grid height
- **THEN** the collection body scrolls vertically inside the panel card

### Requirement: A collection Output renders one metric item per loaded row
An `output` panel bound to a collection-kind Output SHALL render one item per loaded row of the Output's rows, each item
produced by applying the Output's `fieldMapping` (`value`, `label`, `unit` slots) to that row. Each item SHALL reuse the
Metric renderer (large value with optional adjacent unit, label) and apply the Output's `format` and `conditionalFormats`
to its own raw value.

#### Scenario: Multi-row Output expands to N items
- **WHEN** a collection Output with `value` and `label` mapped has 5 loaded rows
- **THEN** the panel body renders exactly 5 metric items, each showing that row's mapped value and label

#### Scenario: Item slots resolve per row
- **WHEN** two rows carry different values in the column mapped to `value`
- **THEN** the two rendered items show their own row's value, not a shared one

#### Scenario: Format applies to every item
- **WHEN** the collection Output's `config.format` is `"percent"`
- **THEN** every rendered item shows its value in the percent display style

### Requirement: A collection with no rows shows a no-data state
When the collection Output has no fetched rows, the panel SHALL show the panel-level "No data available" state, or "Not
run yet" when the Output's node was never materialized by a pipeline run, rather than an empty body. A collection
renderer that is given no rows (for example when a viewer filter removes every loaded row) SHALL show a "No data" state.

#### Scenario: Zero fetched rows shows the panel-level state
- **WHEN** a collection Output's node has run and returned zero rows
- **THEN** the panel shows "No data available"

#### Scenario: Renderer given no rows shows No data
- **WHEN** the collection renderer receives an empty row list
- **THEN** the body shows a "No data" state
