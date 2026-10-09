## ADDED Requirements

### Requirement: Opening a different Output reseeds the whole editor

When the Output editor sheet is already open for one Output and a different Output is opened (for example via the
`?outputId=` deep link), the sheet SHALL show the newly opened Output's own stored state for every field — name, kind,
and every per-kind setting (chart type, aggregation fields, chart options, annotation, table columns and formats, metric
field/reduce/label/unit/format/compare, markdown content, collection and timeline mappings and format, history-payloads
toggle) — and no state carried over from the previously open Output. A Save after the switch SHALL be computed against
the newly opened Output's stored config only.

#### Scenario: Deep-linking to a second Output while the first is open

- **WHEN** the editor is open for a chart Output stored with chart type "bar" and the page is navigated to
  `?outputId=` of another chart Output stored with chart type "pie"
- **THEN** the editor shows chart type "pie" (not "bar") and the second Output's other stored settings

#### Scenario: Untouched Save after the switch sends no config

- **WHEN** the editor switches from one Output to another as above and the user saves without editing
- **THEN** the update request for the second Output carries no `config` key
