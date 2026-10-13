# pipeline-cast-op Specification

## Purpose
Defines the `cast` pipeline step: it retypes named fields to one of a fixed set of supported target types
(string, integer, long, float, double, number, boolean, date, timestamp), nulling values that cannot be coerced. Write
surfaces reject an unsupported target, and the pipeline editor offers exactly the supported set.

## Requirements

### Requirement: Cast op retypes specified fields per a casts map
The execution engine SHALL support the `cast` op. The step config SHALL contain a `casts` object
mapping source field name strings to target type strings. For each row, every field whose name
appears as a key in `casts` SHALL have its value coerced to the target type. Fields not present in
`casts` SHALL pass through unchanged. If a value cannot be coerced to the target type, the field
value in the output row SHALL be `null`. Supported target types are: `string`, `integer`, `long`,
`float`, `double`, `number`, `boolean`, `date`, `timestamp`. A `float`, `double` or `number` cast
SHALL produce the same 64-bit floating-point number. A `timestamp` or `date` cast SHALL keep exactly
the values the shared timestamp parser accepts (see `timestamp-value-parsing`) and SHALL yield `null`
for any other value. A kept string value SHALL be emitted as its original string, unchanged. A kept
non-string numeric value (a JSON-number epoch) SHALL be emitted as the UTC ISO-8601 instant it denotes
(e.g. `"2026-02-17T00:00:00Z"`, with fractional seconds only when non-zero), for both the `timestamp`
and `date` targets. Every non-null value a cast produces SHALL have the run-time type the pipeline
analyze surface projects for that column.

#### Scenario: Single field cast string to integer
- **WHEN** a cast step with `casts: {"price": "integer"}` is applied to rows containing `{"price": "42", "name": "foo"}`
- **THEN** each output row contains `{"price": 42, "name": "foo"}`

#### Scenario: Multiple field casts in one step
- **WHEN** a cast step with `casts: {"qty": "integer", "price": "double"}` is applied to rows
  containing `{"qty": "3", "price": "9.99", "name": "foo"}`
- **THEN** each output row contains `{"qty": 3, "price": 9.99, "name": "foo"}`

#### Scenario: Float cast yields a number
- **WHEN** a cast step with `casts: {"price": "float"}` is applied to rows containing `{"price": "1.5"}`
- **THEN** the output row contains `{"price": 1.5}` as a number, not a string, and analyze projects `price` as `float`

#### Scenario: Timestamp cast keeps the original string
- **WHEN** a cast step with `casts: {"when": "timestamp"}` is applied to rows containing `{"when": "2026-03-14T09:30:00Z"}`, `{"when": "03/14/2026"}`, `{"when": "2026-07-01 12:00:00"}` and `{"when": "2026-07-01 12:00:00+00"}`
- **THEN** the output rows contain those four values unchanged as strings

#### Scenario: A JSON-number epoch casts to an ISO instant
- **WHEN** a cast step with `casts: {"when": "timestamp", "day": "date"}` is applied to a row containing the JSON numbers `{"when": 1771286400, "day": 1771286400123}` and to a row containing the string `{"when": "1771286400"}`
- **THEN** the first output row contains `{"when": "2026-02-17T00:00:00Z", "day": "2026-02-17T00:00:00.123Z"}` (never scientific notation)
- **AND** the second output row contains `{"when": "1771286400"}` unchanged

#### Scenario: Every value a timestamp cast keeps is readable downstream
- **WHEN** a cast step with `casts: {"when": "timestamp"}` is followed by a `datebucket` step on `when` over rows of every accepted shape
- **THEN** no row that the cast kept non-null is bucketed to `null`

#### Scenario: Date cast feeding datebucket keeps bucketable values
- **WHEN** a cast step with `casts: {"when": "date"}` is followed by a `datebucket` step on `when` over rows containing `{"when": "2026-07-01 12:00:00"}` and `{"when": "1751371200"}`
- **THEN** both rows are bucketed to a non-null date, exactly as without the cast step

#### Scenario: Unparseable timestamp or date yields null
- **WHEN** a cast step with `casts: {"when": "date"}` is applied to rows containing `{"when": "tomorrow"}` and `{"when": "02/30/2026"}`
- **THEN** both output rows contain `{"when": null}`

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

### Requirement: Cast targets outside the supported set are rejected at write and passed through when already stored
Creating or updating a `cast` step (including through a single-call pipeline create or an applied
proposal) whose `casts` map names a target outside the supported set — for example `string-body`,
`binary-ref` or any unrecognised string — SHALL be rejected with the same 422 every write surface returns for a step-configuration rejection, whose message names the
offending target and lists the supported targets. A cast step already stored with such a target
SHALL, when run (manually, scheduled or auto-run), pass that field's value through unchanged, and SHALL
NOT cause a scheduled or auto-run to be skipped; the pipeline analyze surface SHALL project that field's
input type unchanged, matching the run.

#### Scenario: Unknown target rejected on create
- **WHEN** a client creates a cast step with `casts: {"doc": "binary-ref"}`
- **THEN** the request fails with 422 naming `binary-ref` and the supported targets, and no step is stored

#### Scenario: Stored legacy target passes through at run time
- **WHEN** a pipeline whose stored cast step has `casts: {"doc": "string-body"}` is run over rows containing `{"doc": "hello"}`
- **THEN** the output row contains `{"doc": "hello"}` unchanged, the run does not fail on that step, and analyze projects `doc` with its input type

#### Scenario: Stored legacy target does not gate a scheduled run
- **WHEN** a scheduled pipeline whose stored cast step has `casts: {"doc": "binary-ref"}` comes due
- **THEN** the run is attempted (not recorded as skipped for invalid step configuration)

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
