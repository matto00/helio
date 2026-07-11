## ADDED Requirements

### Requirement: Metric aggregate value is formatted for display
The metric panel's rendered `value` slot SHALL cap displayed decimal precision at 2 fraction
digits (no thousands grouping) for any numeric value, so that a non-integer aggregate result
(e.g. an `avg` producing a long or repeating decimal) does not overflow the value slot. Integer
values and non-numeric string values (including non-finite results such as `"Infinity"`) SHALL
render unchanged. The `unit` slot SHALL continue to render as a separate suffix, unaffected by
value formatting.

#### Scenario: Long decimal avg is rounded for display
- **WHEN** a metric panel's `aggregation = { value: "rating", agg: "avg" }` computes to
  `3.3333333333333335`
- **THEN** the rendered value slot displays `"3.33"`

#### Scenario: Integer aggregate renders unchanged
- **WHEN** a metric panel's `aggregation = { value: "title", agg: "count" }` computes to `1500`
- **THEN** the rendered value slot displays `"1500"` (no added decimal digits, no thousands
  separator)

#### Scenario: Non-numeric metric value renders unchanged
- **WHEN** a metric panel's resolved value is a non-numeric string (e.g. `"Active"`)
- **THEN** the rendered value slot displays the string unchanged

#### Scenario: Non-finite aggregate value renders unchanged
- **WHEN** a metric panel's resolved value is the literal string `"Infinity"`
- **THEN** the rendered value slot displays `"Infinity"` unchanged (no rounding applied)
