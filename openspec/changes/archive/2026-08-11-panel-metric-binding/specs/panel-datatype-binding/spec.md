## ADDED Requirements

### Requirement: Bound panels may bind to a stored MetricDefinition via metricId

`MetricPanelConfig`, `ChartPanelConfig`, and `TablePanelConfig` SHALL have an optional `metricId`
(string, referencing a `MetricDefinition`) property, settable via `POST /api/panels` (create) and
`PATCH /api/panels/:id` (update) with absent-vs-null semantics matching `dataTypeId`/`fieldMapping`. A
panel MAY set `metricId` together with the raw `dataTypeId`/`fieldMapping`/`aggregation` trio — the two
are not mutually exclusive.

#### Scenario: Metric panel created with a metricId
- **WHEN** `POST /api/panels` is called with `type: "metric"` and `config: { "metricId": "<metric-id>" }`
  where `<metric-id>` resolves to a metric the caller owns
- **THEN** the response is 201 with `config.metricId` set to `<metric-id>`

#### Scenario: metricId is updatable via PATCH
- **WHEN** `PATCH /api/panels/:id` is called on a metric panel with `config: { "metricId": "<metric-id>" }`
- **THEN** the response's `config.metricId` is `<metric-id>`

#### Scenario: Clearing metricId via explicit null
- **WHEN** `PATCH /api/panels/:id` is called with `config: { "metricId": null }`
- **THEN** the response's `config.metricId` is absent/null and the panel falls back to its raw
  `dataTypeId`/`fieldMapping`/`aggregation` fields (if any)

#### Scenario: Omitting metricId on PATCH leaves it unchanged
- **WHEN** `PATCH /api/panels/:id` is called on a panel with a stored `metricId` and the `config` patch
  does not mention `metricId`
- **THEN** the stored `metricId` is unchanged

### Requirement: create/update reject an unresolvable or non-pipeline-output metricId

`POST /api/panels` and `PATCH /api/panels/:id` SHALL reject (400) a `metricId` that does not resolve to
a metric owned by the caller, or that resolves to a metric whose bound `DataType` does not satisfy the
pipeline-output rule (`sourceId` absent) — mirroring the existing companion-DataType rejection for raw
`dataTypeId`. Omitting `metricId` is unaffected.

#### Scenario: Creating a panel with a foreign metricId is rejected
- **WHEN** `POST /api/panels` is called with a `metricId` belonging to a different user
- **THEN** the response is 400 and no panel is created

#### Scenario: Creating a panel with a nonexistent metricId is rejected
- **WHEN** `POST /api/panels` is called with a `metricId` that does not resolve to any metric
- **THEN** the response is 400 and no panel is created

#### Scenario: Re-binding a panel to a foreign metricId is rejected
- **WHEN** `PATCH /api/panels/:id` is called with a `metricId` belonging to a different user
- **THEN** the response is 400 and the panel's binding is unchanged

### Requirement: A cross-user or deleted metricId clears on read instead of erroring

`PanelService`'s read paths SHALL resolve a stored `metricId` against the caller's own metrics
(`findById`-driven responses, `resolveBindingsForRead`, `resolveSingleBinding`); when it does not
resolve to a caller-owned metric, the returned panel SHALL have `metricId` cleared (`None`) rather
than the request failing. This clearing is independent of the panel's raw `dataTypeId`/`fieldMapping` —
only `metricId` is cleared.

#### Scenario: A metric owned by another user resolves to a cleared binding on read
- **WHEN** a panel's stored `metricId` references a metric owned by a different user (e.g. the metric's
  ownership predates a since-added validation, or the row was altered out of band)
- **THEN** `GET /api/dashboards/:id/panels` returns the panel with `config.metricId` absent/null, and
  the request succeeds (no 500)

#### Scenario: A deleted metric resolves to a cleared binding on read
- **WHEN** the `MetricDefinition` a panel's `metricId` referenced has been deleted
- **THEN** `GET /api/dashboards/:id/panels` returns the panel with `config.metricId` absent/null, and
  the request succeeds (no 500)

### Requirement: Deleting a metric unbinds referencing panels instead of deleting them

The `panels.metric_id` column SHALL be a foreign key to `metrics(id) ON DELETE SET NULL`. Deleting a
`MetricDefinition` that one or more panels reference SHALL set those panels' `metric_id` to `NULL`
rather than deleting or erroring on the referencing panels.

#### Scenario: Deleting a referenced metric leaves the panel intact but unbound
- **WHEN** a metric referenced by a panel's `metricId` is deleted via `DELETE /api/metrics/:id`
- **THEN** the panel still exists and a subsequent `GET /api/dashboards/:id/panels` returns it with
  `config.metricId` absent/null

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
fields from it.

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
