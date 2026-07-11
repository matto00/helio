## ADDED Requirements

### Requirement: Metric panel literal label/unit takes precedence over field-mapped values
The rendered label/unit text SHALL use a metric panel config's literal `label`/`unit` (see
`panel-datatype-binding`) instead of the value resolved from `fieldMapping`, when the literal value is
present. When the literal value is absent, rendering SHALL fall back to the existing
`fieldMapping`-resolved value unchanged. The literal label/unit SHALL NOT affect the "No data"
fallback, which remains keyed on the presence of the mapped `value` slot only.

#### Scenario: Literal label overrides the field-mapped label
- **WHEN** a metric panel has `config.label: "Revenue"` and a `fieldMapping.label` bound to a column
- **THEN** the panel body shows "Revenue" as the label, not the column's value

#### Scenario: Literal unit overrides the field-mapped unit
- **WHEN** a metric panel has `config.unit: "$"` and a `fieldMapping.unit` bound to a column
- **THEN** the panel body shows "$" adjacent to the value, not the column's value

#### Scenario: Absent literal label falls back to field-mapped label
- **WHEN** a metric panel has no `config.label` but has `fieldMapping.label` bound to a column
- **THEN** the panel body shows the column's resolved value as the label, unchanged from today

#### Scenario: Literal label with no value binding still shows "No data"
- **WHEN** a metric panel has `config.label: "Revenue"` but no mapped `value` slot
- **THEN** the panel body shows the "No data" fallback, not "Revenue"
