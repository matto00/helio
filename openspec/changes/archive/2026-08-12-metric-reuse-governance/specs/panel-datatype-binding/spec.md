## MODIFIED Requirements

### Requirement: A Metric panel's read response materializes the metric's effective binding

A `MetricPanel`'s read response SHALL materialize effective values from a resolved `metricId`'s
`MetricDefinition` (via `findById`-driven responses, `resolveBindingsForRead`, `resolveSingleBinding`)
for any of `dataTypeId`, `fieldMapping`, `aggregation`, and `unit` that the panel's own stored config
leaves unset: `dataTypeId` defaults to the
metric's `dataTypeId`; `fieldMapping` defaults to `{ "value": "<measureField>" }`; `aggregation` defaults
to `{ "value": "<measureField>", "agg": "<aggregation>" }`; `unit` defaults to the metric's
`format.unit`. A raw field present on the panel's own stored config always overrides its metric-derived
counterpart — `metricId` supplies defaults, never forces a value over an explicit override. `ChartPanel`
and `TablePanel` persist and validate `metricId` identically but do not materialize effective query
fields from it. Whenever `metricId` resolves to a `MetricDefinition` (on any of `MetricPanel`,
`ChartPanel`, `TablePanel`), the response SHALL additionally carry `config.metricDeprecated: Boolean`,
always reflecting that metric's current `deprecated` value — independent of, and computed regardless
of, whether any raw field overrides the metric-derived value fields above.

#### Scenario: Metric panel with only metricId set resolves its effective binding on read
- **WHEN** a `MetricPanel`'s config has `metricId` set and no `dataTypeId`/`fieldMapping`/`aggregation`/
  `unit` of its own, and the referenced metric has `dataTypeId = "dt-1"`, `measureField = "revenue"`,
  `aggregation = "sum"`, `format.unit = "$"`
- **THEN** `GET /api/dashboards/:id/panels` returns the panel with `config.dataTypeId = "dt-1"`,
  `config.fieldMapping = { "value": "revenue" }`, `config.aggregation = { "value": "revenue", "agg":
  "sum" }`, and `config.unit = "$"`

#### Scenario: An explicit raw field overrides its metric-derived counterpart
- **WHEN** a `MetricPanel`'s config has both `metricId` set (referencing a metric with `measureField =
  "revenue"`) and its own `fieldMapping = { "value": "profit" }`
- **THEN** `GET /api/dashboards/:id/panels` returns the panel with `config.fieldMapping = { "value":
  "profit" }` (the raw override), not the metric-derived value

#### Scenario: Chart panel with metricId set does not materialize a field mapping
- **WHEN** a `ChartPanel`'s config has `metricId` set and no `fieldMapping` of its own
- **THEN** `GET /api/dashboards/:id/panels` returns the panel with `config.fieldMapping` still empty —
  `metricId` round-trips but is not used to derive a chart field mapping in this change

#### Scenario: Bound metric's deprecated status is always surfaced

- **WHEN** a `MetricPanel`'s config has `metricId` set, referencing a metric with `deprecated: true`,
  and the panel's own `fieldMapping` overrides the metric-derived value
- **THEN** `GET /api/dashboards/:id/panels` returns the panel with `config.metricDeprecated: true`,
  regardless of the raw-field override

#### Scenario: Chart/table panel's bound metric deprecated status is surfaced too

- **WHEN** a `ChartPanel`'s config has `metricId` set, referencing a metric with `deprecated: true`
- **THEN** `GET /api/dashboards/:id/panels` returns the panel with `config.metricDeprecated: true`, even
  though the chart panel does not materialize `fieldMapping` from the metric

#### Scenario: A renamed metric requires no re-binding

- **GIVEN** a `MetricPanel`'s config has `metricId` set, referencing a metric named `"Old Name"`
- **WHEN** that metric is renamed to `"New Name"` via `PATCH /api/metrics/:id`, and the panel's config
  is not itself modified
- **THEN** every subsequent `GET /api/dashboards/:id/panels` reflects the metric's current effective
  binding correctly, with no `PATCH /api/panels/:id` call required

### Requirement: Panel binding editor supports a bind-to-metric mode for metric/chart/table panels

The panel binding editor (`BindingEditor`/`MetricBindingFields`) SHALL offer a bind-to-metric mode, in
addition to the existing bind-to-DataType-field mode, for `metric`/`chart`/`table` panels — matching
the backend's existing `metricId` support scope (HEL-500; `collection`/`timeline` panels are not
offered this mode). Selecting a metric SHALL set the panel's `metricId`; the editor SHALL persist it
via the existing `PATCH /api/panels/:id` `config.metricId` path, requiring no backend change. The
picker's offered options SHALL exclude a metric with `deprecated: true`, EXCEPT the panel's currently
bound metric SHALL remain visible/selectable even if deprecated, so a user can see what is bound and
choose to change it.

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

#### Scenario: Deprecated metrics are not offered as new selections

- **WHEN** a user opens the metric picker for a panel with no metric currently bound, and the caller
  owns both active and deprecated metrics
- **THEN** the picker's options include only the active metrics

#### Scenario: A panel's already-bound deprecated metric remains visible

- **WHEN** a user opens the metric picker for a panel already bound to a metric that has since been
  deprecated
- **THEN** the picker shows that metric as the current selection, and the user may still choose it
  again or switch to any active metric

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

## ADDED Requirements

### Requirement: Binding editor surfaces a deprecated indicator for a bound deprecated metric

The binding editor SHALL display a "deprecated" indicator alongside the metric selection whenever a
panel's `metricId` resolves to a metric with `deprecated: true` (`config.metricDeprecated`, per the
materialization requirement above), reusing the visual pattern already established by the metrics list
page's own deprecated badge (`MetricListTable.tsx`).

#### Scenario: Deprecated indicator shown for a bound deprecated metric

- **WHEN** a user opens the binding editor for a panel whose `metricId` resolves to a metric with
  `deprecated: true`
- **THEN** the editor displays a "deprecated" indicator next to the selected metric

#### Scenario: No indicator shown for a bound active metric

- **WHEN** a user opens the binding editor for a panel whose `metricId` resolves to a metric with
  `deprecated: false`
- **THEN** no "deprecated" indicator is shown
