## ADDED Requirements

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
