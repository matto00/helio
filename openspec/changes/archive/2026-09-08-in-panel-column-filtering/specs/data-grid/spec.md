## ADDED Requirements

### Requirement: The full variant renders an optional filter row
In the `"full"` variant, when filter handlers are supplied, `DataGrid` SHALL render a filter input
for each visible column alongside a quick-filter input, each with an accessible name identifying
what it filters, and each keyboard reachable and editable. The `"preview"` variant SHALL NOT render
filter controls. `DataGrid` SHALL NOT itself decide which rows match — it renders the controls and
reports term changes, and the caller supplies the rows to display.

#### Scenario: The preview variant has no filter controls
- **WHEN** `DataGrid` renders with `variant="preview"`
- **THEN** no filter input is rendered

#### Scenario: Filter inputs are individually labelled
- **WHEN** the filter row renders for a set of columns
- **THEN** each input exposes an accessible name identifying its column, and the quick-filter input
  exposes its own

### Requirement: The empty state can carry an action
`DataGrid`'s empty state SHALL accept an optional action rendered beneath its message, so a caller
can offer a remedy for the condition that produced it. When no action is supplied the empty state
SHALL render exactly as before, message only.

#### Scenario: An empty state without an action is unchanged
- **WHEN** `DataGrid` renders with no rows and no action supplied
- **THEN** only the empty-state message renders

#### Scenario: An empty state renders a supplied action
- **WHEN** `DataGrid` renders with no rows and an action supplied
- **THEN** the action renders beneath the message and is keyboard reachable

### Requirement: Filter controls remain available when filtering empties the table
When a filter is active and no rows remain, the filter controls SHALL remain visible and editable so
the term that produced the empty result can be seen and changed.

#### Scenario: The filter row survives an empty result
- **WHEN** an active filter matches no rows
- **THEN** the filter inputs remain rendered, showing their current terms
