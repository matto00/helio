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
The Data tab SHALL show display slots determined by the panel's type. Chart panels show one field-name dropdown per slot from `PANEL_SLOTS`. Metric panels do NOT use a generic per-slot dropdown list — they use the Value control (field selector + Reduce selector, see the `panel-viz-aggregation` capability) and Label/Unit bind-or-literal controls (see the `panel-config-field-or-literal-pattern` capability).

#### Scenario: Metric panel shows a Value control and Label/Unit controls instead of three field-mapping slots
- **WHEN** a Metric panel's Data tab is open with a DataType selected
- **THEN** one Value control (field selector + Reduce selector) and two Label/Unit controls (each a
  bind-to-field / fixed-text toggle) are shown, and no generic "Value"/"Label"/"Unit" field-mapping
  dropdown row is rendered

#### Scenario: Chart panel shows xAxis, yAxis, series slots
- **WHEN** a Chart panel's Data tab is open with a DataType selected
- **THEN** three slot dropdowns are shown: X Axis, Y Axis, Series

#### Scenario: Field dropdown lists DataType fields
- **WHEN** a slot dropdown (chart/table field mapping, or the Metric Value control's field selector)
  is opened
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
The panel detail modal's Data section SHALL, for chart panel types, show an Aggregation sub-section alongside field mapping: chart panels get a group-by field selector, an agg-function selector, and a value-field selector. For metric panel types, aggregation is exposed through the unified Value control (field selector + Reduce selector, see the `panel-viz-aggregation` capability) rather than a separate Aggregation sub-section — metric no longer has an Aggregation sub-section at all. Leaving the aggregation controls unset (chart) or the Reduce selector at "None (first row)" (metric) SHALL persist no `aggregation` on the panel's config (unaffected pre-existing rendering).

#### Scenario: Metric panel Data section exposes aggregation via the unified Value control, not a separate section
- **WHEN** a metric panel's Data section is open with a DataType selected
- **THEN** no separate "Aggregation" sub-section is rendered for metric — the Value control's Reduce
  selector (see `panel-viz-aggregation`) is the sole aggregation-function control

#### Scenario: Chart panel Data section shows aggregation controls
- **WHEN** a chart panel's Data section is open with a DataType selected
- **THEN** an Aggregation sub-section is shown with group-by, agg-function, and value-field selectors

#### Scenario: Leaving chart aggregation controls empty persists no aggregation spec
- **WHEN** the user configures only field mapping on a chart panel (not aggregation) and clicks Save
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

### Requirement: Text panel joins the bound-capable panel set

`TextPanelConfig` SHALL carry `dataTypeId` (string) and `fieldMapping` (object) fields, mirroring
`MetricPanelConfig`'s shape. A Text panel with `dataTypeId` set SHALL build a `PanelQuery` (via
`Panel.buildQuery`) selecting the field named in `fieldMapping.content`, identical in shape to how
Metric/Chart/Table build their queries from their own field mappings.

#### Scenario: Text panel config accepts dataTypeId and fieldMapping
- **WHEN** `POST /api/panels` is called with `type: "text"` and `config: { "dataTypeId": "<type-id>",
  "fieldMapping": { "content": "headline" } }`
- **THEN** the response's `config` includes `dataTypeId` and `fieldMapping` as sent

#### Scenario: Bound Text panel builds a query for its mapped field
- **WHEN** a Text panel has `dataTypeId` and `fieldMapping.content` set
- **THEN** `GET /api/panels/:id/query` returns rows selecting the mapped field, matching the existing
  Metric/Chart/Table query-building behavior

#### Scenario: Unbound Text panel has no query
- **WHEN** a Text panel has no `dataTypeId` set
- **THEN** `GET /api/panels/:id/query` returns 404 "Panel is not bound to a data type", matching existing
  unbound-panel behavior for every other panel kind

### Requirement: Text panel binding persists via existing generic columns

Text panel `dataTypeId`/`fieldMapping` SHALL persist through the `panels` table's existing generic
`type_id`/`field_mapping` columns (already used by Metric/Chart/Table) — no new database column or
migration is introduced.

#### Scenario: Text panel binding survives a round-trip
- **WHEN** a Text panel is bound to a DataType via `PATCH /api/panels/:id` and then retrieved via
  `GET /api/dashboards/:id/panels`
- **THEN** the response's `config.dataTypeId`/`config.fieldMapping` match what was persisted

### Requirement: Clearing a Text panel's binding preserves its literal content

Unbinding a Text panel SHALL clear only `dataTypeId`/`fieldMapping`, leaving `config.content` unchanged.
This applies to both an explicit `null` PATCH and a binding scrub via `withBindingCleared`, and diverges
from Metric's `withBindingCleared`, which resets its entire config (including literal label/unit
overrides).

#### Scenario: Explicit unbind via PATCH preserves literal content
- **WHEN** `PATCH /api/panels/:id` is called on a bound Text panel with `config: { "dataTypeId": null,
  "fieldMapping": null }`
- **THEN** the response's `config.content` is unchanged from before the request

#### Scenario: Cross-user binding scrub preserves literal content
- **WHEN** `PanelService.resolveBindingsForRead` scrubs a Text panel's binding (the bound DataType is no
  longer accessible to the caller)
- **THEN** the returned panel has `dataTypeId`/`fieldMapping` cleared but `config.content` unchanged

### Requirement: Markdown panel joins the bound-capable panel set

`MarkdownPanelConfig` SHALL carry `dataTypeId` (string) and `fieldMapping` (object) fields, mirroring
`TextPanelConfig`'s shape (HEL-244). A Markdown panel with `dataTypeId` set SHALL build a `PanelQuery`
(via `Panel.buildQuery`) selecting the field named in `fieldMapping.content`, identical in shape to the
Text panel's query building.

#### Scenario: Markdown panel config accepts dataTypeId and fieldMapping
- **WHEN** `POST /api/panels` is called with `type: "markdown"` and `config: { "dataTypeId":
  "<type-id>", "fieldMapping": { "content": "summary_md" } }`
- **THEN** the response's `config` includes `dataTypeId` and `fieldMapping` as sent

#### Scenario: Bound Markdown panel builds a query for its mapped field
- **WHEN** a Markdown panel has `dataTypeId` and `fieldMapping.content` set
- **THEN** `GET /api/panels/:id/query` returns rows selecting the mapped field, matching the existing
  Text-panel query-building behavior

#### Scenario: Unbound Markdown panel has no query
- **WHEN** a Markdown panel has no `dataTypeId` set
- **THEN** `GET /api/panels/:id/query` returns 404 "Panel is not bound to a data type", matching existing
  unbound-panel behavior for every other panel kind

### Requirement: Markdown panel binding persists via existing generic columns

Markdown panel `dataTypeId`/`fieldMapping` SHALL persist through the `panels` table's existing generic
`type_id`/`field_mapping` columns (already used by Metric/Chart/Table/Text) — no new database column or
migration is introduced.

#### Scenario: Markdown panel binding survives a round-trip
- **WHEN** a Markdown panel is bound to a DataType via `PATCH /api/panels/:id` and then retrieved via
  `GET /api/dashboards/:id/panels`
- **THEN** the retrieved panel's `config` includes the bound `dataTypeId` and `fieldMapping`

#### Scenario: Legacy content-only markdown config decodes as unbound
- **WHEN** a pre-existing Markdown panel whose stored config JSON contains only `content` is read
- **THEN** it decodes with empty `dataTypeId`/`fieldMapping` (unbound) and its content renders unchanged

### Requirement: Clearing a Markdown panel's binding preserves its literal content

Unbinding a Markdown panel SHALL clear only `dataTypeId`/`fieldMapping`, leaving `config.content`
unchanged — matching the Text panel's divergence from Metric's blanket config reset. Patch semantics
SHALL follow the absent-vs-null convention: a field absent from the PATCH `config` leaves the stored
value unchanged; an explicit `null` clears it.

#### Scenario: Explicit null clears the binding but not content
- **WHEN** `PATCH /api/panels/:id` is called on a bound Markdown panel with `config: { "dataTypeId":
  null, "fieldMapping": null }`
- **THEN** the response's `config` has empty `dataTypeId`/`fieldMapping` and the previously stored
  `content` intact

#### Scenario: Absent fields leave the binding unchanged
- **WHEN** `PATCH /api/panels/:id` is called on a bound Markdown panel with `config: { "content":
  "# updated" }` (no `dataTypeId`/`fieldMapping` keys present)
- **THEN** the stored binding is preserved and only `content` changes

#### Scenario: Binding scrub preserves markdown content
- **WHEN** `PanelService.resolveBindingsForRead` scrubs a Markdown panel's binding (the bound DataType
  no longer exists)
- **THEN** the returned panel is unbound but `config.content` is unchanged

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

### Requirement: A chart or table panel's bind-to-metric mode does not materialize into fieldMapping

For **chart** and **table** panels, selecting a metric SHALL set `metricId` without altering or
disabling the panel's existing field-mapping controls — mirroring the backend, which never derives
`fieldMapping` from a chart/table panel's bound metric (no single unambiguous slot).

#### Scenario: Chart panel's field mapping stays independently editable after binding a metric
- **WHEN** a user selects a metric for a chart panel in bind-to-metric mode
- **THEN** the chart's existing field-mapping controls (xAxis/yAxis/series) remain visible and editable,
  unaffected by the metric selection

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

