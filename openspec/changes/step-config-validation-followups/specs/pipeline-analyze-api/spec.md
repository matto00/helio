## ADDED Requirements

### Requirement: A compute step's output type hint is optional in analyze

A `compute` step's `type` config key is an optional output-type hint. Analyze SHALL NOT report a configuration error
because it is absent. When the expression validates, the appended column's type SHALL be the type inferred from the
expression, exactly as when `type` is present. When the expression does not validate (or its type cannot be inferred),
the step's `validationError` SHALL be that specific expression problem — never the generic `compute config error` —
and the appended column SHALL carry the `type` hint when one is present, or `string` when none is.

#### Scenario: Compute step without type and a valid expression
- **WHEN** a compute step has `config: {"column": "total", "expression": "$price * $qty"}` applied to inputSchema
  `[{name: "price", type: "float"}, {name: "qty", type: "integer"}]`
- **THEN** the step has no `validationError` and its `outputSchema` ends with a `total` field of the inferred numeric type

#### Scenario: Compute step without type referencing an unknown field
- **WHEN** a compute step has `config: {"column": "total", "expression": "$nope * 2"}` and the input has no `nope` field
- **THEN** the step's `validationError` names `nope` and is not `compute config error`
- **AND** its `outputSchema` ends with a `total` field of type `string`
