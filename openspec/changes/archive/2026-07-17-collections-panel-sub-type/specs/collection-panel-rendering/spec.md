## ADDED Requirements

### Requirement: One bound row renders one collection item
A bound collection panel SHALL render one item per row of the bound DataType's fetched snapshot,
each item produced by applying the shared `fieldMapping` to that row. With the `metric` base type,
each item SHALL use the Metric visual language (large value with optional adjacent unit, sub-label)
consistent with a standalone metric panel. The v1 item count is bounded by the first fetched page
of rows.

#### Scenario: Multi-row DataType expands to N items
- **WHEN** a collection panel is bound to a DataType whose snapshot has 5 rows and `value`/`label`
  slots are mapped
- **THEN** the panel body renders exactly 5 metric items, each showing that row's mapped value and label

#### Scenario: Item slots resolve per row
- **WHEN** two rows carry different values in the column mapped to `value`
- **THEN** the two rendered items show their own row's value, not a shared one

### Requirement: Literal item options override bound slots
For the `metric` base type, literal `itemOptions.metric.label` / `itemOptions.metric.unit` SHALL
override the corresponding bound `fieldMapping` slot on every item (HEL-243 literal-wins semantics).

#### Scenario: Shared literal unit applies to all items
- **WHEN** `itemOptions.metric.unit` is `"$"` and rows also carry a mapped `unit` column
- **THEN** every rendered item shows the unit `"$"`

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

### Requirement: Collection empty and unbound states
An unbound collection panel (no `dataTypeId`) SHALL render a placeholder state consistent with the
other data-bound kinds. A bound collection whose snapshot has zero rows SHALL render a "No data"
state rather than an empty body.

#### Scenario: Unbound collection shows placeholder
- **WHEN** a collection panel with no bound DataType renders in the grid
- **THEN** the body shows an unbound placeholder inviting configuration, not an error

#### Scenario: Bound collection with zero rows shows no-data state
- **WHEN** a bound collection's DataType snapshot contains zero rows
- **THEN** the body shows a "No data" state

### Requirement: Desktop overflow scrolls inside the panel
On the desktop grid, when rendered items exceed the panel's height, the collection body SHALL
scroll vertically within the panel (table-panel precedent); items SHALL never spill outside the
panel card.

#### Scenario: Tall collection scrolls internally on desktop
- **WHEN** a desktop collection panel's items exceed its grid height
- **THEN** the collection body scrolls vertically inside the panel card
