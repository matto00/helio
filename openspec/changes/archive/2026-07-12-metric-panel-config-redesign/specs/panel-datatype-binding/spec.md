## MODIFIED Requirements

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
