## MODIFIED Requirements

### Requirement: Cast op retypes specified fields per a casts map
The execution engine SHALL support the `cast` op. The step config SHALL contain a `casts` object
mapping source field name strings to target type strings. For each row, every field whose name
appears as a key in `casts` SHALL have its value coerced to the target type. Fields not present in
`casts` SHALL pass through unchanged. If a value cannot be coerced to the target type, the field
value in the output row SHALL be `null`. Supported target types are: `string`, `integer`, `long`,
`float`, `double`, `number`, `boolean`, `date`, `timestamp`. A `float`, `double` or `number` cast
SHALL produce the same 64-bit floating-point number. A `timestamp` or `date` cast SHALL keep a value
that the platform reads as a timestamp — a value source schema inference would type `timestamp`, or a
value the `datebucket` op can bucket (including epoch seconds/milliseconds and space-separated
date-times) — as its original string, unchanged, and SHALL yield `null` for any other value. Every
non-null value a cast produces SHALL have the run-time type the pipeline analyze surface projects
for that column.

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
- **WHEN** a cast step with `casts: {"when": "timestamp"}` is applied to rows containing `{"when": "2026-03-14T09:30:00Z"}`, `{"when": "03/14/2026"}` and `{"when": "2026-07-01 12:00:00"}`
- **THEN** the output rows contain those three values unchanged as strings, the same representation a JSON source column inferred as `timestamp` carries

#### Scenario: Date cast feeding datebucket keeps bucketable values
- **WHEN** a cast step with `casts: {"when": "date"}` is followed by a `datebucket` step on `when` over rows containing `{"when": "2026-07-01 12:00:00"}` and `{"when": "1751371200"}`
- **THEN** both rows are bucketed to a non-null date, exactly as without the cast step

#### Scenario: Unparseable timestamp or date yields null
- **WHEN** a cast step with `casts: {"when": "date"}` is applied to rows containing `{"when": "tomorrow"}`
- **THEN** the output row contains `{"when": null}`

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

## ADDED Requirements

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
