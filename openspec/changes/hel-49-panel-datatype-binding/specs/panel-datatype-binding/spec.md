## ADDED Requirements

### Requirement: User can bind a panel to a DataType
The panel detail modal Data tab SHALL allow the user to select a registered DataType from a searchable dropdown showing type name, source type badge, and field count. Selecting a DataType SHALL populate the field mapping section.

#### Scenario: DataType list is loaded when Data tab is opened
- **WHEN** the user clicks the "Data" tab in the panel detail modal
- **THEN** the registered DataTypes are fetched and displayed in a searchable dropdown

#### Scenario: Selecting a DataType shows field mapping
- **WHEN** the user selects a DataType from the dropdown
- **THEN** the field mapping section appears with one dropdown per display slot for the panel's type

#### Scenario: No DataTypes available shows empty state
- **WHEN** the Data tab is opened and no DataTypes are registered
- **THEN** the dropdown is empty and an "Add a new source →" link is shown

### Requirement: Field mapping slots are appropriate to the panel type
The Data tab SHALL show display slots determined by the panel's type. Each slot has a dropdown of field names from the selected DataType.

#### Scenario: Metric panel shows value, label, unit slots
- **WHEN** a Metric panel's Data tab is open with a DataType selected
- **THEN** three slot dropdowns are shown: Value, Label, Unit

#### Scenario: Chart panel shows xAxis, yAxis, series slots
- **WHEN** a Chart panel's Data tab is open with a DataType selected
- **THEN** three slot dropdowns are shown: X Axis, Y Axis, Series

#### Scenario: Field dropdown lists DataType fields
- **WHEN** a slot dropdown is opened
- **THEN** it lists all field names from the selected DataType

### Requirement: Refresh interval is configurable
The Data tab SHALL include a refresh interval selector with options: Manual, 30s, 1m, 5m, 15m, 1h. The selected value SHALL be stored in seconds (null for Manual).

#### Scenario: Default refresh interval is Manual
- **WHEN** the Data tab is opened for a panel with no binding
- **THEN** the refresh interval selector shows "Manual"

#### Scenario: Selecting an interval updates the stored value
- **WHEN** the user selects "5m" from the interval selector
- **THEN** saving persists refreshInterval = 300 to the panel

### Requirement: Saving persists the binding
Clicking Save on the Data tab SHALL PATCH the panel with `typeId`, `fieldMapping`, and `refreshInterval` and close the modal on success.

#### Scenario: Save sends binding to backend
- **WHEN** the user selects a DataType, maps fields, and clicks Save
- **THEN** PATCH /api/panels/:id is called with typeId, fieldMapping, and refreshInterval

#### Scenario: Save failure shows error
- **WHEN** the PATCH request fails
- **THEN** an inline error is shown and the modal remains open

### Requirement: Unsaved changes trigger a discard warning
If either the Appearance tab or Data tab has unsaved changes, closing or cancelling the modal SHALL show a confirmation warning.

#### Scenario: Closing with unsaved data changes shows warning
- **WHEN** the user has changed the DataType binding and clicks Cancel or the close button
- **THEN** a discard warning is shown before the modal closes
