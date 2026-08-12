## ADDED Requirements

### Requirement: Panel binding editor supports a bind-to-metric mode for metric/chart/table panels

The panel binding editor (`BindingEditor`/`MetricBindingFields`) SHALL offer a bind-to-metric mode, in
addition to the existing bind-to-DataType-field mode, for `metric`/`chart`/`table` panels — matching
the backend's existing `metricId` support scope (HEL-500; `collection`/`timeline` panels are not
offered this mode). Selecting a metric SHALL set the panel's `metricId`; the editor SHALL persist it
via the existing `PATCH /api/panels/:id` `config.metricId` path, requiring no backend change.

#### Scenario: Selecting a metric sets metricId
- **WHEN** a user opens a metric panel's binding editor, switches to bind-to-metric mode, and selects
  an existing metric
- **THEN** saving persists the panel's `config.metricId` to that metric's id via `PATCH /api/panels/:id`

#### Scenario: Chart and table panels also offer bind-to-metric
- **WHEN** a user opens a chart or table panel's binding editor
- **THEN** the bind-to-metric mode is available, identically to a metric panel

#### Scenario: Collection and timeline panels do not offer bind-to-metric
- **WHEN** a user opens a collection or timeline panel's binding editor
- **THEN** no bind-to-metric mode is shown, matching the backend's unsupported scope for those types

### Requirement: A metric panel's bind-to-metric mode shows the resolved binding read-only

For a **metric** panel with `metricId` set, the binding editor SHALL display the selected metric's
resolved `measureField`, `aggregation`, and `format` read-only (not editable field/reducer controls),
mirroring the backend's own metric-derived materialization (`MetricPanel.scala`: raw fields, if also
present, remain authoritative). Clearing the metric selection SHALL reveal the panel's own raw
`fieldMapping`/`aggregation` fields, editable as before.

#### Scenario: Selected metric's resolved binding is shown read-only
- **WHEN** a user selects a metric for a metric panel in bind-to-metric mode
- **THEN** the editor displays that metric's measure field, aggregation, and format as read-only text,
  not editable Field/Reduce selectors

#### Scenario: Clearing the metric selection reveals raw fields
- **WHEN** a user clears a metric panel's selected metric after previously binding to one
- **THEN** the panel's own `fieldMapping`/`aggregation` fields become editable again

### Requirement: A chart or table panel's bind-to-metric mode does not materialize into fieldMapping

For **chart** and **table** panels, selecting a metric SHALL set `metricId` without altering or
disabling the panel's existing field-mapping controls — mirroring the backend, which never derives
`fieldMapping` from a chart/table panel's bound metric (no single unambiguous slot).

#### Scenario: Chart panel's field mapping stays independently editable after binding a metric
- **WHEN** a user selects a metric for a chart panel in bind-to-metric mode
- **THEN** the chart's existing field-mapping controls (xAxis/yAxis/series) remain visible and editable,
  unaffected by the metric selection
