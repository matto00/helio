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
The panel detail modal's unified edit mode form SHALL include a Data section (for data-capable panel types)
that allows the user to select a pipeline-output DataType (`sourceId == null`) from a searchable dropdown
showing type name and field count. Companion DataTypes created from source registration (`sourceId != null`)
SHALL NOT appear in the dropdown. Selecting a DataType SHALL populate the field mapping section within the
same form.

#### Scenario: DataType list is shown in the Data section when edit mode is opened
- **WHEN** the user enters edit mode on a data-capable panel (metric, chart, etc.)
- **THEN** the Data section is visible in the unified form with the registered pipeline-output DataTypes
  loaded and displayed in a searchable dropdown

#### Scenario: Companion DataTypes are not offered as binding targets
- **WHEN** the DataType dropdown is rendered and the store contains a DataType with `sourceId != null`
- **THEN** that DataType does not appear in the dropdown

#### Scenario: Selecting a DataType shows field mapping in the same form
- **WHEN** the user selects a DataType from the dropdown in the Data section
- **THEN** the field mapping rows appear directly below within the same section

#### Scenario: No DataTypes available shows empty state
- **WHEN** edit mode is opened and no pipeline-output DataTypes are registered
- **THEN** the dropdown is empty and a link to the Pipelines page is shown in the Data section

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

### Requirement: typeId is set at panel creation time for data-bound panels
When `POST /api/panels` receives a `dataTypeId` field in the request body, the backend SHALL set
`typeId` on the newly created `Panel` domain object and persist it to the `panels.type_id` column.
The `GET /api/dashboards/:id/panels` response for such a panel SHALL return the `typeId` populated,
matching the behavior of a panel that had its binding set via `PATCH /api/panels/:id`.

#### Scenario: POST /api/panels with dataTypeId persists typeId
- **WHEN** `POST /api/panels` is called with `{ "dashboardId": "<id>", "title": "Revenue", "type": "metric", "dataTypeId": "<type-id>" }`
- **THEN** the response is 201 with `typeId` set to `<type-id>`
- **AND** subsequent `GET /api/dashboards/:id/panels` returns the panel with `typeId` populated

#### Scenario: POST /api/panels without dataTypeId creates unbound panel
- **WHEN** `POST /api/panels` is called without a `dataTypeId` field (e.g. for a non-data-bound type)
- **THEN** the response is 201 with `typeId` set to `null`

#### Scenario: Newly created bound panel fetches data on mount
- **WHEN** a panel created with a `dataTypeId` is rendered in the panel grid
- **THEN** the panel fetches data via `GET /api/panels/:id/query` on mount
- **AND** displays data according to its `fieldMapping` (if set) or shows a no-data state

### Requirement: Panel response includes dataAsOf field for data freshness
The `GET /api/dashboards/:id/panels` endpoint SHALL include a `dataAsOf: string | null` field
on every `PanelResponse`, computed server-side. When a panel is bound to a DataType whose
associated pipeline has run successfully, `dataAsOf` SHALL be the ISO-8601 timestamp of that
run's `last_run_at`. Otherwise, `dataAsOf` SHALL be absent or `null` in the response.

#### Scenario: Panel response includes dataAsOf when pipeline has run successfully
- **WHEN** a panel has been bound to a DataType and that DataType's associated pipeline has `last_run_status = 'succeeded'`
- **THEN** `GET /api/dashboards/:id/panels` returns the panel with `dataAsOf` set to an ISO-8601 timestamp

#### Scenario: Panel response omits dataAsOf for unbound panel
- **WHEN** a panel has no bound DataType (typeId is absent or empty)
- **THEN** `GET /api/dashboards/:id/panels` returns the panel with `dataAsOf` absent or `null`

#### Scenario: Panel response omits dataAsOf when pipeline has only failed runs
- **WHEN** a panel is bound to a DataType whose pipeline has only failed or never-run status
- **THEN** `GET /api/dashboards/:id/panels` returns the panel with `dataAsOf` absent or `null`

### Requirement: Backend rejects binding a panel to a companion DataType
`POST /api/panels` and `PATCH /api/panels/:id` SHALL reject a request whose data type reference
(`dataTypeId`/`typeId`) resolves to a DataType with a non-null `sourceId`, returning 400 with a message
indicating panels can only bind to pipeline-output data types. Unbinding (`typeId: null`) and references to
pipeline-output DataTypes are unaffected.

#### Scenario: Creating a panel bound to a companion DataType is rejected
- **WHEN** `POST /api/panels` is called with a `dataTypeId` resolving to a DataType with `sourceId != null`
- **THEN** the response is 400 and no panel is created

#### Scenario: Re-binding a panel to a companion DataType is rejected
- **WHEN** `PATCH /api/panels/:id` is called with a `typeId` resolving to a DataType with `sourceId != null`
- **THEN** the response is 400 and the panel's binding is unchanged

#### Scenario: Binding to a pipeline-output DataType still succeeds
- **WHEN** `PATCH /api/panels/:id` is called with a `typeId` resolving to a DataType with `sourceId == null`
- **THEN** the response is 200 with the binding applied

### Requirement: Binding editor exposes aggregation controls for metric and chart panels
The panel detail modal's Data section SHALL, for metric and chart panel types, show an Aggregation sub-section alongside field mapping: metric panels get a field selector plus an agg-function selector (count/sum/avg/min/max); chart panels get a group-by field selector, an agg-function selector, and a value-field selector. Leaving the aggregation controls unset SHALL persist no `aggregation` on the panel's config (unaffected pre-existing rendering).

#### Scenario: Metric panel Data section shows aggregation controls
- **WHEN** a metric panel's Data section is open with a DataType selected
- **THEN** an Aggregation sub-section is shown with a field selector and an agg-function selector

#### Scenario: Chart panel Data section shows aggregation controls
- **WHEN** a chart panel's Data section is open with a DataType selected
- **THEN** an Aggregation sub-section is shown with group-by, agg-function, and value-field selectors

#### Scenario: Leaving aggregation controls empty persists no aggregation spec
- **WHEN** the user configures only field mapping (not aggregation) and clicks Save
- **THEN** the panel's `config.aggregation` remains absent and the panel renders as it did before
  this change

### Requirement: Saving the binding persists the aggregation spec
Clicking Save on the Data tab SHALL include the configured `aggregation` object (when set) in the `PATCH /api/panels/:id` request body's `config` payload, alongside `dataTypeId` and `fieldMapping`.

#### Scenario: Save sends aggregation spec to backend
- **WHEN** the user configures a metric aggregation (`value` field + `agg` function) and clicks Save
- **THEN** `PATCH /api/panels/:id` is called with `config.aggregation` set to the configured spec

#### Scenario: Clearing aggregation controls removes the spec on save
- **WHEN** the user clears a previously-configured aggregation and clicks Save
- **THEN** `PATCH /api/panels/:id` is called with `config.aggregation` explicitly cleared (null)

### Requirement: Metric panel supports a literal label/unit override
`MetricPanelConfig` SHALL support an optional literal `label` (string) and `unit` (string) at the
config's top level, sibling to `fieldMapping` — distinct from `fieldMapping.label`/`fieldMapping.unit`
(which bind those slots to a DataType column). Both fields SHALL be settable via `POST /api/panels`
(create) and `PATCH /api/panels/:id` (update, absent-vs-null semantics matching `dataTypeId`/
`fieldMapping`). Omitting either field SHALL leave rendering unchanged from today's fieldMapping-only
behavior.

#### Scenario: Metric panel created with a literal label and unit
- **WHEN** `POST /api/panels` is called with `type: "metric"` and `config: { "label": "Revenue", "unit": "$" }`
- **THEN** the response's `config` includes `label: "Revenue"` and `unit: "$"`

#### Scenario: Literal label/unit is updatable via PATCH
- **WHEN** `PATCH /api/panels/:id` is called on a metric panel with `config: { "unit": "%" }`
- **THEN** the response's `config.unit` is `"%"` and `config.label` is unchanged

#### Scenario: Clearing the literal override via explicit null
- **WHEN** `PATCH /api/panels/:id` is called with `config: { "label": null }`
- **THEN** the response's `config.label` is absent/null and fieldMapping-bound rendering resumes

#### Scenario: Omitting the literal override preserves existing fieldMapping-only rendering
- **WHEN** a metric panel is created or patched without `label`/`unit` in `config`
- **THEN** the panel's rendered label/unit continue to resolve from `fieldMapping` exactly as before
  this change

