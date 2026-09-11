# dataset-schema-validation Specification

## Purpose
Defines the declared-field model for `dataset`-kind sources and the write-time validation contract
that every writer of `dataset_rows` must satisfy so the declared schema stays authoritative.

## Requirements

### Requirement: A dataset's declared schema carries name, type, required, and default per field
The backend SHALL model a dataset source's declaration as an ordered list of fields, each with a
`name` (string), a `type` drawn from the canonical `DataFieldType` set (`string`, `integer`,
`float`, `boolean`, `timestamp`, `string-body`, `binary-ref`), a `required` boolean, and an
optional `default` value whose JSON shape matches `type`. A caller-supplied non-canonical type
synonym (e.g. `"double"`, `"number"`, `"long"`, `"date"`) SHALL be normalized to its canonical form
before being persisted, exactly as `DataFieldType`'s existing normalization already does for other
source kinds.

#### Scenario: A caller-declared "double" field is stored as canonical "float"
- **WHEN** a dataset source is created or its schema is set with a field declared `type: "double"`
- **THEN** the persisted declaration stores that field's type as `"float"`, and it is retrievable
  and validated against as `float`, not `double`

#### Scenario: A field with no explicit required flag defaults to not required
- **WHEN** a dataset field declaration omits `required`
- **THEN** the persisted declaration treats that field as `required: false`

### Requirement: A row write is validated against the dataset's declared schema before persisting
The backend SHALL validate every row written to `dataset_rows` (on dataset create with initial
rows, and on dataset refresh/replace) against the owning source's declared schema before the write
commits. Per declared type, a value is valid when: `string`/`string-body` is any JSON string;
`integer` is a JSON number with an integral value; `float` is any JSON number (integral or not);
`boolean` is a JSON boolean; `timestamp` is a JSON string parseable as ISO date-time, ISO local
date-time, ISO local date, or `MM/dd/yyyy`; `binary-ref` is any JSON object. A value whose JSON
shape does not satisfy its field's declared type SHALL be rejected with a field-level error
identifying the field name and the mismatch — never silently coerced (e.g. a numeric string is
never coerced into a number, a non-integral number is never truncated into an integer). A field
value is "missing" when the row has no value at that field's position, or the value is JSON
`null`. A row missing a value for a field declared `required: true` with no `default` SHALL be
rejected with a field-level error identifying the missing field. A row with more values than the
declaration has fields SHALL be rejected with a row-level error, checked first for that row (before
any per-field check on that row, since a length mismatch means positional alignment cannot be
trusted). The entire write SHALL be rejected (no partial persistence) when any row fails
validation.

#### Scenario: A wrong-typed value is rejected, not coerced
- **WHEN** a row write supplies the string `"12"` for a field declared `type: "integer"`
- **THEN** the write is rejected with a field-level error naming that field, and no row is
  persisted from that write; the reason portion of that field-level error is exactly
  `"expected integer, got string"` (the pinned template is `"expected <declaredType>, got
  <actualKind>"`, where `<actualKind>` is one of `string`, `number`, `boolean`, `object`, `array`,
  or `null`, using the declared type's canonical wire name and the JSON value's kind, not its
  Scala runtime type). This is the ONE reason template used for every rejection this requirement
  describes — a non-integral number given to an `integer` field and an unparseable string given to
  a `timestamp` field use this exact same template (`"expected integer, got number"` /
  `"expected timestamp, got string"`), never a differently-worded explanation, so a caller
  (including HEL-1077) can rely on one literal shape for every type-mismatch reason.

#### Scenario: A non-integral number is rejected for an integer field
- **WHEN** a row write supplies the number `1.5` for a field declared `type: "integer"`
- **THEN** the write is rejected with a field-level error naming that field, and the reason portion
  is exactly `"expected integer, got number"` (the same pinned template as any other type
  mismatch — a non-integral number is not a distinct wording)

#### Scenario: A whole number is accepted for a float field
- **WHEN** a row write supplies the number `3` for a field declared `type: "float"`
- **THEN** the write succeeds and the field's persisted value is `3`

#### Scenario: A bare date string is accepted for a timestamp field
- **WHEN** a row write supplies the string `"2026-01-01"` for a field declared `type: "timestamp"`
- **THEN** the write succeeds

#### Scenario: An unparseable string is rejected for a timestamp field
- **WHEN** a row write supplies the string `"not-a-date"` for a field declared `type: "timestamp"`
- **THEN** the write is rejected with a field-level error naming that field, and the reason portion
  is exactly `"expected timestamp, got string"` (the same pinned template as any other type
  mismatch — an unparseable string is not a distinct wording)

#### Scenario: A missing required field with no default is rejected
- **WHEN** a row write omits a value (absent or `null`) for a field declared `required: true` with
  no `default`
- **THEN** the write is rejected with a field-level error naming that field, and no row is
  persisted from that write

#### Scenario: A missing required field with a default is filled, not rejected
- **WHEN** a row write omits a value (absent or `null`) for a field declared `required: true` with
  a `default`
- **THEN** the write succeeds and the persisted row carries the field's `default` value

#### Scenario: A missing optional field with no default is accepted as absent
- **WHEN** a row write omits a value (absent or `null`) for a field declared `required: false` with
  no `default`
- **THEN** the write succeeds and the persisted row has no value (JSON `null`) for that field

#### Scenario: A row with extra trailing values is rejected
- **WHEN** a row write supplies more values than the declaration has fields
- **THEN** the write is rejected with a row-level error, and no row is persisted from that write

### Requirement: Validation failures produce a single pinned error message, not a new response envelope
The backend SHALL surface every rejected write as an HTTP `400` whose body message is built from
one or more of the following, joined with `"; "` in row-then-field order, with no new error
response shape introduced beyond the existing single-`message` error body: a field-level failure
as `"row <rowIndex>: field '<name>' — <reason>"`; a missing-required failure as `"row <rowIndex>:
field '<name>' is required"`; a row-length failure as `"row <rowIndex>: expected <N> fields, got
<M>"`.

#### Scenario: A single field failure produces the pinned message format
- **WHEN** row 0's `age` field fails validation because it is required and missing
- **THEN** the `400` response body's message is exactly `"row 0: field 'age' is required"`

### Requirement: A declared field's default value must itself satisfy its declared type
The backend SHALL validate a field's `default` value against that field's own declared type at the
time the schema is declared (create or refresh), using the same per-type acceptance rules as row
validation.

#### Scenario: A default value of the wrong type is rejected at declaration time
- **WHEN** a dataset schema declares a field `type: "integer"` with `default: "not-a-number"`
- **THEN** the declaration is rejected with a field-level error naming that field, before any row
  is validated or persisted; the `400` response body's message is exactly `"field 'age' — default
  expected integer, got string"` for a field named `age` (the pinned template is `"field '<name>'
  — default <reason>"`, where `<reason>` is the same per-type reason template row validation uses,
  e.g. `"expected integer, got string"`) — this format has no `row <rowIndex>` prefix because a
  default is checked at declaration time, before any row exists
