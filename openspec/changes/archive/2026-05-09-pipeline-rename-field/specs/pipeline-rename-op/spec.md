## ADDED Requirements

### Requirement: Rename op renames source fields to canonical output names
The execution engine SHALL support the `rename` op. The step config SHALL contain a `renames`
object mapping source field name strings to target field name strings. For each row, every field
whose name appears as a key in `renames` SHALL be renamed to the corresponding value. Fields not
present in `renames` SHALL pass through unchanged. If a key in `renames` does not exist in a given
row, that mapping SHALL be silently ignored (no error).

#### Scenario: Single field rename
- **WHEN** a rename step with `renames: {"price": "cost"}` is applied to rows containing `id`, `price`, `qty`
- **THEN** each output row contains `id`, `cost`, `qty`; the `price` key is absent

#### Scenario: Multiple field renames in one step
- **WHEN** a rename step with `renames: {"a": "x", "b": "y"}` is applied to rows containing `a`, `b`, `c`
- **THEN** each output row contains `x`, `y`, `c`; neither `a` nor `b` is present

#### Scenario: Source field not present is silently ignored
- **WHEN** a rename step with `renames: {"missing_col": "new_name"}` is applied to rows containing only `id`
- **THEN** each output row contains only `id`; no error is raised

#### Scenario: Empty renames map is a no-op
- **WHEN** a rename step with `renames: {}` is applied to any rows
- **THEN** each output row is identical to the corresponding input row

### Requirement: Frontend rename op renders a field-picker table in the step-card config UI
When a pipeline step has `op: "rename"` and the step card is expanded, the frontend SHALL render a
table of available column names derived from the analyze endpoint's `inputSchema` for that step.
Each row SHALL show the source field name and a text input for the new (target) name. If the user
clears the text input (empty string), the rename for that field SHALL be removed from the persisted
config. If the analyze response returns an empty `inputSchema`, the UI SHALL render an empty table
(no prompt to run the pipeline first).

#### Scenario: Table shows columns from analyze inputSchema
- **WHEN** a rename step card is expanded and the analyze response contains an `inputSchema` with
  fields `["a", "b", "c"]` for that step
- **THEN** the step-card body shows three rows labelled `a`, `b`, and `c` with text inputs for the target names

#### Scenario: Empty inputSchema renders empty table, no run prompt
- **WHEN** a rename step card is expanded and the analyze response returns an empty `inputSchema`
- **THEN** the step-card body renders an empty table; no message prompting the user to run the pipeline is shown

#### Scenario: Entering a new name updates the step config
- **WHEN** the user types `cost` in the text input for field `price`
- **THEN** the step config is patched with `{"renames": {"price": "cost"}}`

#### Scenario: Clearing a name removes it from the config
- **WHEN** the user clears the text input for field `price` (previously renamed to `cost`)
- **THEN** the step config is patched with `renames` that does not contain the `price` key
