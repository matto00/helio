# pipeline-cast-op Specification

## Purpose
TBD - created by archiving change pipeline-op-cast-type. Update Purpose after archive.
## Requirements
### Requirement: Cast op retypes specified fields per a casts map
The execution engine SHALL support the `cast` op. The step config SHALL contain a `casts` object
mapping source field name strings to target type strings. For each row, every field whose name
appears as a key in `casts` SHALL have its value coerced to the target type. Fields not present in
`casts` SHALL pass through unchanged. If a value cannot be coerced to the target type, the field
value in the output row SHALL be `null`. Supported target types are: `string`, `integer`, `long`,
`double`, `boolean`.

#### Scenario: Single field cast string to integer
- **WHEN** a cast step with `casts: {"price": "integer"}` is applied to rows containing `{"price": "42", "name": "foo"}`
- **THEN** each output row contains `{"price": 42, "name": "foo"}`

#### Scenario: Multiple field casts in one step
- **WHEN** a cast step with `casts: {"qty": "integer", "price": "double"}` is applied to rows
  containing `{"qty": "3", "price": "9.99", "name": "foo"}`
- **THEN** each output row contains `{"qty": 3, "price": 9.99, "name": "foo"}`

#### Scenario: Fields not in casts pass through unchanged
- **WHEN** a cast step with `casts: {"qty": "integer"}` is applied to rows containing `{"qty": "5", "label": "bar"}`
- **THEN** each output row contains `{"qty": 5, "label": "bar"}` with `label` unchanged

#### Scenario: Invalid value yields null
- **WHEN** a cast step with `casts: {"price": "integer"}` is applied to rows containing `{"price": "not-a-number"}`
- **THEN** the output row contains `{"price": null}`

#### Scenario: Field missing from row is silently ignored
- **WHEN** a cast step with `casts: {"missing_col": "integer"}` is applied to rows containing only `{"id": "1"}`
- **THEN** the output row contains `{"id": "1"}`; no error is raised

#### Scenario: Empty casts map is a no-op
- **WHEN** a cast step with `casts: {}` is applied to any rows
- **THEN** each output row is identical to the corresponding input row

### Requirement: Frontend cast op renders a field-type table in the step-card config UI
When a pipeline step has `op: "cast"` and the step card is expanded, the frontend SHALL render a
table of available column names derived from the analyze endpoint's `inputSchema` for that step.
Each row SHALL show the source field name and a target-type dropdown. If the user selects
"— keep as is —" for a field, that field SHALL be removed from the `casts` map in the persisted
config. If the analyze response returns an empty `inputSchema`, the UI SHALL render an empty table
(no prompt to run the pipeline first). The dropdown SHALL offer the types: `string`, `integer`,
`long`, `double`, `boolean`.

#### Scenario: Table shows columns from analyze inputSchema
- **WHEN** a cast step card is expanded and the analyze response contains an `inputSchema` with
  fields `["id", "price", "qty"]` for that step
- **THEN** the step-card body shows three rows labelled `id`, `price`, and `qty` each with a type dropdown

#### Scenario: Empty inputSchema renders empty table, no run prompt
- **WHEN** a cast step card is expanded and the analyze response returns an empty `inputSchema`
- **THEN** the step-card body renders an empty table; no message prompting the user to run the
  pipeline is shown

#### Scenario: Selecting a type updates the step config
- **WHEN** the user selects `integer` in the dropdown for field `price`
- **THEN** the step config is patched with `{"casts": {"price": "integer"}}`

#### Scenario: Selecting keep-as-is removes field from config
- **WHEN** the user selects "— keep as is —" in the dropdown for field `price` (previously cast to `integer`)
- **THEN** the step config is patched with `casts` that does not contain the `price` key

#### Scenario: Config is hydrated from persisted step on reload
- **WHEN** a pipeline step with `op: "cast"` and persisted config `{"casts": {"qty": "integer"}}` is loaded
- **THEN** the `qty` dropdown shows `integer` as the selected type

