## ADDED Requirements

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
