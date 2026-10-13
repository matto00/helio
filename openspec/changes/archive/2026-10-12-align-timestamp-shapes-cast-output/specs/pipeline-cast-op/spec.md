## MODIFIED Requirements

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
