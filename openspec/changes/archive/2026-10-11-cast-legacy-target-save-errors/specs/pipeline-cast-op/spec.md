## MODIFIED Requirements

### Requirement: Frontend cast op renders a field-type table in the step-card config UI
When a pipeline step has `op: "cast"` and the step card is expanded, the frontend SHALL render a
table with one row per column name in the analyze endpoint's `inputSchema` for that step, followed by one row per
field named in the stored `casts` map that is not in that `inputSchema` (sorted by name).
Each row SHALL show the source field name and a target-type dropdown. If the user selects
"— keep as is —" for a field, that field SHALL be removed from the `casts` map in the persisted
config. If the analyze response returns an empty `inputSchema` and the stored `casts` map is empty, the UI
SHALL render an empty table (no prompt to run the pipeline first). The dropdown SHALL offer exactly the cast targets the backend accepts on write:
`string`, `integer`, `long`, `float`, `double`, `number`, `boolean`, `date`, `timestamp`. When a stored config names a
target outside that set, the dropdown for that field SHALL show the stored target itself, marked as unsupported, rather
than showing "— keep as is —"; it SHALL NOT be offered for selection on any other field.

#### Scenario: Table shows columns from analyze inputSchema
- **WHEN** a cast step card is expanded and the analyze response contains an `inputSchema` with
  fields `["id", "price", "qty"]` for that step
- **THEN** the step-card body shows three rows labelled `id`, `price`, and `qty` each with a type dropdown

#### Scenario: Empty inputSchema renders empty table, no run prompt
- **WHEN** a cast step card is expanded, the analyze response returns an empty `inputSchema`, and the stored `casts` is empty
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

#### Scenario: A stored cast key absent from the input schema has a row
- **WHEN** a cast step stored with `casts: {"gone": "integer"}` is expanded and the input schema is `["id"]`
- **THEN** the table shows an `id` row and then a `gone` row whose dropdown shows `integer`

## ADDED Requirements

### Requirement: The cast editor surfaces rejected saves and flags stored unsupported targets
When the server rejects a save of a cast step's configuration, the step card SHALL show the server's message, and the
card SHALL NOT present the rejected edit as saved. A row whose stored target is outside the supported set SHALL be
marked invalid for assistive technology and SHALL carry a visible hint telling the user to choose a supported type, or
"— keep as is —" to keep the current run behaviour. Because every stored `casts` field has a row (see the
field-type table requirement), a stored unsupported target can always be cleared. No control SHALL rewrite stored
targets on the user's behalf.

#### Scenario: Editing another row of a cast with a stored legacy target shows the rejection
- **WHEN** a cast step stored with `casts: {"doc": "binary-ref"}` is edited by selecting `integer` for field `qty`
- **THEN** the save is rejected with 422 and the step card shows the server's message naming `binary-ref`

#### Scenario: The legacy row is marked invalid with a hint
- **WHEN** a cast step stored with `casts: {"doc": "binary-ref"}` is expanded
- **THEN** the `doc` target control is marked invalid and a hint tells the user to choose a supported type or keep as is

#### Scenario: Clearing the legacy target makes the step saveable
- **WHEN** the user selects "— keep as is —" for `doc` on that step
- **THEN** the save succeeds with `casts` not containing `doc`, and the error and hint are gone

#### Scenario: A stored legacy key absent from the input schema still has a row
- **WHEN** a cast step stored with `casts: {"gone": "binary-ref"}` is expanded and the input schema has no `gone` field
- **THEN** a `gone` row is shown, marked invalid with the hint, and can be set to "— keep as is —"
