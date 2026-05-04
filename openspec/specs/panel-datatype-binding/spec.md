# panel-datatype-binding Specification

## Purpose
Defines requirements for binding a panel to a registered DataType, including the API contract for typeId/fieldMapping/refreshInterval fields, the frontend UI for configuring the binding, and how data is persisted and saved.
## Requirements
### Requirement: Panel can be bound to a DataType
A panel SHALL have optional `typeId`, `fieldMapping`, and `refreshInterval` properties. `typeId` references a registered DataType; `fieldMapping` is a JSON object mapping panel display slot names to DataType field names; `refreshInterval` is the polling interval in seconds (null means manual).

#### Scenario: Unbound panel has null typeId
- **WHEN** a panel is created without a typeId
- **THEN** `typeId` is `null` in the panel response

#### Scenario: Panel response includes typeId and fieldMapping
- **WHEN** a panel has been bound to a DataType
- **THEN** `GET /api/dashboards/:id/panels` returns the panel with `typeId` and `fieldMapping` populated

### Requirement: PATCH /api/panels/:id accepts typeId, fieldMapping, and refreshInterval
The existing `PATCH /api/panels/:id` endpoint SHALL accept optional `typeId` (string or null), `fieldMapping` (object or null), and `refreshInterval` (number or null) fields. Passing `null` explicitly SHALL unbind the panel.

#### Scenario: Bind panel to type
- **WHEN** `PATCH /api/panels/:id` is called with `{ "typeId": "<valid-type-id>", "fieldMapping": { "value": "price" } }`
- **THEN** the response is 200 with `typeId` and `fieldMapping` set on the panel

#### Scenario: Unbind panel from type
- **WHEN** `PATCH /api/panels/:id` is called with `{ "typeId": null }`
- **THEN** the response is 200 with `typeId` and `fieldMapping` set to `null`

### Requirement: User can bind a panel to a DataType
The panel detail modal's unified edit mode form SHALL include a Data section (for data-capable panel types) that allows the user to select a registered DataType from a searchable dropdown showing type name, source type badge, and field count. Selecting a DataType SHALL populate the field mapping section within the same form.

#### Scenario: DataType list is shown in the Data section when edit mode is opened
- **WHEN** the user enters edit mode on a data-capable panel (metric, chart, etc.)
- **THEN** the Data section is visible in the unified form with the registered DataTypes loaded and displayed in a searchable dropdown

#### Scenario: Selecting a DataType shows field mapping in the same form
- **WHEN** the user selects a DataType from the dropdown in the Data section
- **THEN** the field mapping rows appear directly below within the same section

#### Scenario: No DataTypes available shows empty state
- **WHEN** edit mode is opened and no DataTypes are registered
- **THEN** the dropdown is empty and an "Add a new source →" link is shown in the Data section

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
The Data tab SHALL include a refresh interval selector with options: Manual, 30s, 1m, 5m, 15m, 1h. The selected value SHALL be stored in seconds (null for Manual). When set, the frontend SHALL use the stored value to drive automatic polling of the panel's source data.

#### Scenario: Default refresh interval is Manual
- **WHEN** the Data tab is opened for a panel with no binding
- **THEN** the refresh interval selector shows "Manual"

#### Scenario: Selecting an interval updates the stored value
- **WHEN** the user selects "5m" from the interval selector
- **THEN** saving persists refreshInterval = 300 to the panel

#### Scenario: A saved refresh interval drives automatic polling
- **WHEN** a panel with refreshInterval = 30 is displayed in the grid
- **THEN** the panel's source data is automatically re-fetched every 30 seconds

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

