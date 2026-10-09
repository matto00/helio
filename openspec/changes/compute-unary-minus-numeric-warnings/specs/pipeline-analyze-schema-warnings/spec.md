## MODIFIED Requirements

### Requirement: Analyze responses carry schema-only warnings
`GET /api/pipelines/{id}/analyze` and `POST /api/pipelines/analyze-proposal` SHALL include a top-level `warnings` array on every 200 response. Each entry SHALL be an object `{stepId, code, message}` where `stepId` is the id of the step the warning is about (the proposal's client step id for a proposal), `code` is one of `field-not-in-input-schema`, `join-key-type-mismatch`, `join-column-renamed`, `numeric-op-on-text-field`, and `message` is a human-readable sentence naming the step's op, the field(s) involved and the evidence. The array SHALL be present and empty when there are no warnings. Warnings SHALL be computed from projected schemas only, with no row reads, and SHALL be ordered deterministically (by step position, then step id, then code, then field name).

#### Scenario: Clean pipeline
- **WHEN** a pipeline has no step matching any warning condition
- **THEN** the analyze response contains `"warnings": []`

#### Scenario: Proposal analyze carries warnings
- **WHEN** a pipeline proposal whose aggregate step references a field absent from that step's input schema is analyzed
- **THEN** the proposal analyze response's `warnings` contains a `field-not-in-input-schema` entry for that step

## ADDED Requirements

### Requirement: Numeric use of a text field warns
For an enabled `compute` step with no `validationError` whose projected input types are trusted to equal the run-time value types (the same trust rule the join-key type check uses), the system SHALL emit one `numeric-op-on-text-field` warning per distinct input field whose projected type is `string`, `string-body` or `boolean` and that the expression uses where a number is required: as an argument of `floor`, `ceil`, `round`, `mod` or `abs`, or as an operand of `-`, `*`, `/` or unary `-`, either directly or within a sub-expression whose inferred type is not numeric. A field used only with `+` (string concatenation) or a string function SHALL NOT warn. The message SHALL name the step's op, the field, its projected type, the operator or function involved, state that every non-null row will compute `null` at run time, and suggest adding a cast step before the compute step. When the input types are not trusted (for example after a `compute`, `fillnull` or `aggregate` step, or after a `cast` to a target whose run-time value is not the projected type), no such warning SHALL be emitted. This warning is subject to the "Warnings never block" requirement.

#### Scenario: floor over an uncast CSV column
- **WHEN** a pipeline over a CSV source (every column `string`) has a compute step `floor($price)`
- **THEN** analyze returns a `numeric-op-on-text-field` warning for that compute step naming `price`, `string`, `floor` and a cast step
- **AND** the compute step's `validationError` is absent and `costVerdict.canRun` is `true`

#### Scenario: arithmetic over an uncast CSV column
- **WHEN** the compute expression is `$s - 1` with `s` projected as `string`
- **THEN** analyze returns one `numeric-op-on-text-field` warning naming `s`

#### Scenario: Cast field does not warn
- **WHEN** a `cast` step converts `price` to `double` before the compute step `floor($price)`
- **THEN** no `numeric-op-on-text-field` warning is emitted

#### Scenario: Concatenation does not warn
- **WHEN** the compute expression is `$first + " " + $last` over string columns
- **THEN** no `numeric-op-on-text-field` warning is emitted

#### Scenario: Untrusted input types do not warn
- **WHEN** the compute step `floor($x)` follows another `compute` step that produced `x`
- **THEN** no `numeric-op-on-text-field` warning is emitted for `x`

#### Scenario: Warned compute still runs
- **WHEN** a pipeline whose only finding is a `numeric-op-on-text-field` warning is run
- **THEN** the run is not rejected and the computed column is `null` for every non-null row
