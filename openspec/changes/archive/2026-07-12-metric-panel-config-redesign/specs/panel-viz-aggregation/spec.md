## MODIFIED Requirements

### Requirement: Metric panel supports a viz-level aggregation spec
A `MetricPanelConfig` SHALL have an optional `aggregation` property of shape `{ value: string, agg: "count" | "sum" | "avg" | "min" | "max" }`. When present, the metric panel's `value` slot SHALL render the result of applying `agg` to the `value` field across ALL rows returned for the panel's bound DataType, instead of reading `rows[0]`. `label`, `unit`, and `trend` slots are unaffected and continue to read `fieldMapping` off the first row. When `aggregation` is absent, the metric panel SHALL render exactly as before (`rows[0]` via `fieldMapping.value`). The Metric config UI SHALL present the choice between a plain field mapping and a reduced aggregation as a single Value control (one field selector + one Reduce selector) so `fieldMapping.value` and `aggregation` are never both set by user action: selecting "None (first row)" in the Reduce selector clears `aggregation` and writes `fieldMapping.value`; selecting any other reduce function clears `fieldMapping.value` and writes `aggregation`.

#### Scenario: Metric renders avg aggregate over all rows
- **WHEN** a metric panel is bound to a DataType with `aggregation = { value: "rating", agg: "avg" }` and
  the DataType has 1000 rows
- **THEN** the metric's `value` slot displays the average of the `rating` field across all 1000 rows

#### Scenario: Metric renders count aggregate
- **WHEN** a metric panel has `aggregation = { value: "title", agg: "count" }`
- **THEN** the metric's `value` slot displays the count of rows where `title` is non-null

#### Scenario: Metric aggregation is null-tolerant
- **WHEN** a metric panel has `aggregation = { value: "rating", agg: "avg" }` and some rows have a
  null or non-numeric `rating` value
- **THEN** those rows are excluded from the average computation rather than producing an error or NaN

#### Scenario: Metric with no aggregation spec renders rows[0] as before
- **WHEN** a metric panel's config has no `aggregation` property
- **THEN** the metric's `value` slot renders `fieldMapping.value` read from the first bound row,
  matching pre-existing behavior

#### Scenario: Selecting a reduce function moves the field from mapping to aggregation
- **WHEN** the user has `fieldMapping.value = "price"` and no aggregation, and selects "Average" in
  the Value control's Reduce selector, then saves
- **THEN** the PATCH persists `aggregation = { value: "price", agg: "avg" }` and clears
  `fieldMapping.value`

#### Scenario: Selecting "None (first row)" moves the field back to field mapping
- **WHEN** the user has `aggregation = { value: "price", agg: "avg" }` and selects "None (first row)"
  in the Reduce selector, then saves
- **THEN** the PATCH persists `fieldMapping.value = "price"` and clears `aggregation`
