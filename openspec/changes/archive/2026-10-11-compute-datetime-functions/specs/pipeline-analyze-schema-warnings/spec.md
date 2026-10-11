## MODIFIED Requirements

### Requirement: Numeric use of a text field warns
For an enabled `compute` step with no `validationError` whose projected input types are trusted to equal the run-time value types (the same trust rule the join-key type check uses), the system SHALL emit one `numeric-op-on-text-field` warning per distinct input field whose projected type is `string`, `string-body`, `boolean` or `timestamp` and that the expression uses where a number is required: as an argument of `floor`, `ceil`, `round`, `mod` or `abs`, as the day-count (second) argument of `add_days`, or as an operand of `-`, `*`, `/` or unary `-`, either directly or within a sub-expression whose inferred type is not numeric. A field used only with `+` (string concatenation), a string function, or as a timestamp argument of `seconds_between`, `date_trunc` or `add_days` SHALL NOT warn. The message SHALL name the step's op, the field, its projected type, the operator or function involved, and state that every non-null row will compute `null` at run time. For a `string`, `string-body` or `boolean` field it SHALL suggest adding a cast step before the compute step; for a `timestamp` field it SHALL instead suggest `seconds_between(end, start)` for a time difference or `add_days` for an offset, and SHALL NOT suggest a cast step. When the input types are not trusted (for example after a `compute`, `fillnull` or `aggregate` step, or after a `cast` to a target whose run-time value is not the projected type), no such warning SHALL be emitted. This warning is subject to the "Warnings never block" requirement.

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

#### Scenario: subtracting timestamps warns and points at seconds_between
- **WHEN** a `cast` step converts `started_at` and `created_at` to `timestamp` before a compute step `$started_at - $created_at`
- **THEN** analyze returns `numeric-op-on-text-field` warnings naming `started_at` and `created_at`, each suggesting `seconds_between` and not a cast step

#### Scenario: timestamp arguments of date functions do not warn
- **WHEN** the same pipeline's compute step is `seconds_between($started_at, $created_at)` or `add_days($created_at, 1)`
- **THEN** no `numeric-op-on-text-field` warning is emitted

#### Scenario: a text day count for add_days warns
- **WHEN** a compute step `add_days($created_at, $n)` has `n` projected as `string` over a CSV source
- **THEN** analyze returns a `numeric-op-on-text-field` warning naming `n` and `add_days`
