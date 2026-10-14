## MODIFIED Requirements

### Requirement: Compute op schema inference validates the expression and infers its output type
`ColumnSchemaInference.inferCompute` SHALL validate `expression` against the step's `inputSchema`
field names using `ExpressionEvaluator.validate` (the strict, `$`-required grammar — no legacy
fallback). If validation fails, `AnalyzedStep.validationError` SHALL be set to the returned
message, and the output field's type SHALL fall back to the wire `type` (best-effort schema
propagation for a currently-invalid or legacy-style expression). If validation succeeds,
`validationError` SHALL be `None` and the output field's type SHALL be computed by
`ExpressionEvaluator.inferType` from the expression and the input field types, ignoring the wire
`type`. This strict validation is independent of `ExpressionEvaluator.evaluate`'s legacy-tolerant
row-execution fallback — a persisted bare-identifier expression is flagged here even though it
still executes correctly at run time.

#### Scenario: Output type is inferred from the expression, not trusted from the wire `type`
- **WHEN** a compute step with `{"column":"label","expression":"concat($a, $b)","type":"number"}`
  (a stale/incorrect `type` value) is analyzed
- **THEN** the inferred output schema field type is `"string"`, derived from the expression, and
  `validationError` is `None`

#### Scenario: A legacy bare-identifier expression is flagged at analyze time
- **WHEN** a compute step with the pre-existing config
  `{"column":"revenue","expression":"price * qty","type":"number"}` (no `$` prefixes) is analyzed
- **THEN** `AnalyzedStep.validationError` is set to a message indicating column references
  require a `$` prefix, and the output field's type falls back to the wire `type` (`"number"`)

#### Scenario: Unknown field reference is flagged at analyze time
- **WHEN** a compute step with `{"column":"x","expression":"$missing * 2","type":"number"}` is
  analyzed against an `inputSchema` that does not contain `missing`
- **THEN** `AnalyzedStep.validationError` is set to a message indicating the unknown field
