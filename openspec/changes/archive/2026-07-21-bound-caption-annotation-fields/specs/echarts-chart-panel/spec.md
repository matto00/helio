## ADDED Requirements

### Requirement: Chart annotation may be sourced from a bound DataType field

A chart panel's annotation SHALL be sourceable from a bound DataType field as an alternative to static
text. The bound source SHALL be expressed as the reserved `fieldMapping.annotation` slot referencing a
column key of the chart's bound DataType. When `fieldMapping.annotation` is set, the chart SHALL render the
value of that column from the current row snapshot (the first / single row) as the annotation, and the
rendered annotation SHALL update when the underlying data changes. When `fieldMapping.annotation` is absent,
the static `config.annotation` behavior is unchanged. When both are present, the static `config.annotation`
literal SHALL win (mirroring the Metric literal-wins resolution). No new persisted column or chart domain
field is introduced — the bound slot lives in the existing `fieldMapping` object, which is already stored,
round-tripped, and included in the panel query.

#### Scenario: Chart with a bound annotation renders the field value

- **WHEN** a chart panel has `fieldMapping.annotation: "note"`, no static `config.annotation`, and its bound
  DataType's first row has `note = "Preliminary — revised weekly"`
- **THEN** the panel renders the annotation element showing "Preliminary — revised weekly"

#### Scenario: Bound annotation updates when the data changes

- **WHEN** a chart panel's bound annotation column value changes after a new pipeline run and the panel's
  data refreshes
- **THEN** the rendered annotation reflects the new column value without an edit to the panel config

#### Scenario: Static annotation still renders and wins over a bound slot

- **WHEN** a chart panel has both `config.annotation: "Fixed note"` and `fieldMapping.annotation: "note"`
- **THEN** the panel renders "Fixed note"

#### Scenario: A bound annotation column is fetched by the panel query

- **WHEN** a chart panel sets `fieldMapping.annotation` to a column not otherwise mapped to an axis
- **THEN** that column is included in the panel's selected fields so its value is available to render

#### Scenario: Bound annotation round-trips through the panel API

- **WHEN** a PATCH sets `fieldMapping` including `annotation: "note"` on a chart panel, and the panel is
  re-read and duplicated
- **THEN** the stored and duplicated `config.fieldMapping.annotation` is `"note"`

## MODIFIED Requirements

### Requirement: Chart panel config editor exposes the annotation field

The Chart panel's config/display editor SHALL offer a control for the `annotation` that lets the user choose
the annotation **source**: fixed text or a bound DataType field, using the shared field-or-literal control
(`BoundOrLiteralField`). In "Fixed text" mode the control is a text input persisting `config.annotation`; in
"Bind to field" mode it is a DataType field dropdown persisting `fieldMapping.annotation`. Selecting one mode
SHALL clear the other side (Fixed text clears `fieldMapping.annotation`; Bind to field clears
`config.annotation` to null). The "Bind to field" mode SHALL be available only when a DataType is bound. The
mode SHALL default to "Fixed text" when `config.annotation` is set, otherwise to "Bind to field" when
`fieldMapping.annotation` is set. Saving SHALL persist the choice via `PATCH /api/panels/:id`; clearing the
control SHALL clear the corresponding stored value.

#### Scenario: Editing a fixed-text annotation persists it

- **WHEN** a user keeps the Annotation control in "Fixed text" mode, types "Source: internal", and saves
- **THEN** `PATCH /api/panels/:id` is called with `config.annotation` set to that text and the panel
  re-renders showing the annotation

#### Scenario: Binding the annotation to a field persists the slot

- **WHEN** a user switches the Annotation control to "Bind to field", selects the "note" column, and saves
- **THEN** `PATCH /api/panels/:id` is called with `fieldMapping.annotation: "note"` and `config.annotation`
  cleared, and the panel re-renders showing the bound value

#### Scenario: Bind-to-field is unavailable without a bound DataType

- **WHEN** a chart panel has no DataType bound and the Annotation control is opened
- **THEN** the "Bind to field" mode is not offered (only fixed text is available)

#### Scenario: Clearing the annotation control clears the stored annotation

- **WHEN** a user empties the annotation control on a chart panel that had a fixed-text annotation and saves
- **THEN** `PATCH /api/panels/:id` clears the annotation and the panel re-renders with no annotation
