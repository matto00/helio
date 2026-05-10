# pipeline-compute-op Specification

## Purpose
TBD - created by archiving change pipeline-op-compute-field. Update Purpose after archive.
## Requirements
### Requirement: Compute op appends a derived field to each row using a unified config shape
`InProcessPipelineEngine.applyCompute` SHALL accept config shape
`{"column":"<name>","expression":"<expr>","type":"<type>"}` and append a new field named `column`
to every row, whose value is the result of evaluating `expression` against that row's fields using
`ExpressionEvaluator`. If evaluation fails for a row (parse error, unknown field, division by zero,
type error), the field value for that row SHALL be `null`. Fields not referenced in the expression
SHALL pass through unchanged. The `type` key SHALL be tolerated but ignored by the execution engine
(it is consumed by schema inference only).

#### Scenario: Simple arithmetic expression produces new column
- **WHEN** a compute step with `{"column":"revenue","expression":"price * qty","type":"number"}` is applied to rows containing `{"price": 9.99, "qty": 3}`
- **THEN** each output row contains `{"price": 9.99, "qty": 3, "revenue": 29.97}`

#### Scenario: Division by zero produces null for that row
- **WHEN** a compute step with `{"column":"rate","expression":"a / b","type":"number"}` is applied to a row where `b` is `0`
- **THEN** the output row contains `{"rate": null}` for that row (no exception thrown)

#### Scenario: Unknown field reference produces null for that row
- **WHEN** a compute step with `{"column":"x","expression":"missing_field * 2","type":"number"}` is applied to rows not containing `missing_field`
- **THEN** the output row contains `{"x": null}` (no exception thrown)

#### Scenario: Expression with parentheses respects precedence
- **WHEN** a compute step with `{"column":"result","expression":"(a + b) * c","type":"number"}` is applied to a row `{"a":1,"b":2,"c":3}`
- **THEN** the output row contains `{"result": 9.0}`

#### Scenario: Input fields pass through unchanged
- **WHEN** a compute step appends a new field `total`
- **THEN** all original fields of the row remain present in the output row

### Requirement: Frontend compute op renders an output-field and expression editor in the step-card
When a pipeline step has `op: "compute"` and the step card is expanded, the frontend SHALL render
a `ComputeFieldConfig` component with a text input for the output column name (`column`) and a text
input for the expression (`expression`). The component SHALL display the available input field names
(from the analyze endpoint's `inputSchema` for that step) as a read-only hint. The component SHALL
save the config (patch the step) when either input changes (on blur or on change). An empty
`column` or `expression` SHALL be permitted during editing but SHALL be persisted as-is. The config
is initialized as `{"column":"","expression":"","type":"number"}` when the step is first added.

#### Scenario: Compute step card shows column name and expression inputs
- **WHEN** a compute step card is expanded
- **THEN** a text input labelled for output column name and a text input labelled for expression are visible

#### Scenario: Available fields shown as hint
- **WHEN** the analyze response contains `inputSchema` fields `["price","qty"]` for that step
- **THEN** the component displays `price` and `qty` as available field references below the expression input

#### Scenario: Changing column name updates step config
- **WHEN** the user types `revenue` into the column name input and the input loses focus
- **THEN** the step config is patched with `{"column":"revenue","expression":"...","type":"number"}`

#### Scenario: Changing expression updates step config
- **WHEN** the user types `price * qty` into the expression input and the input loses focus
- **THEN** the step config is patched with `{"column":"...","expression":"price * qty","type":"number"}`

#### Scenario: Config is hydrated from persisted step on reload
- **WHEN** a pipeline step with `op: "compute"` and persisted config `{"column":"total","expression":"price * qty","type":"number"}` is loaded
- **THEN** the column input shows `total` and the expression input shows `price * qty`

