## MODIFIED Requirements

### Requirement: Frontend cast op renders a field-type table in the step-card config UI
When a pipeline step has `op: "cast"` and the step card is expanded, the frontend SHALL render a
table of available column names derived from the analyze endpoint's `inputSchema` for that step.
Each row SHALL show the source field name and a target-type dropdown. If the user selects
"— keep as is —" for a field, that field SHALL be removed from the `casts` map in the persisted
config. If the analyze response returns an empty `inputSchema`, the UI SHALL render an empty table
(no prompt to run the pipeline first). The dropdown SHALL offer exactly the cast targets the backend accepts on write:
`string`, `integer`, `long`, `float`, `double`, `number`, `boolean`, `date`, `timestamp`. When a stored config names a
target outside that set, the dropdown for that field SHALL show the stored target itself, marked as unsupported, rather
than showing "— keep as is —"; it SHALL NOT be offered for selection on any other field.

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

#### Scenario: Dropdown offers every supported target
- **WHEN** a cast step card is expanded with a column `when`
- **THEN** the `when` dropdown offers "— keep as is —" plus `string`, `integer`, `long`, `float`, `double`, `number`,
  `boolean`, `date` and `timestamp`, and selecting `timestamp` patches the config with `{"casts": {"when": "timestamp"}}`

#### Scenario: Stored unsupported target is shown as itself
- **WHEN** a pipeline step with `op: "cast"` and persisted config `{"casts": {"doc": "binary-ref"}}` is loaded
- **THEN** the `doc` dropdown shows `binary-ref` marked as unsupported, not "— keep as is —"
