## MODIFIED Requirements

### Requirement: Analyze responses carry schema-only warnings
`GET /api/pipelines/{id}/analyze` and `POST /api/pipelines/analyze-proposal` SHALL include a top-level `warnings` array on every 200 response. Each entry SHALL be an object `{stepId, code, message}` where `stepId` is the id of the step the warning is about (the proposal's client step id for a proposal), `code` is one of `field-not-in-input-schema`, `join-key-type-mismatch`, `join-column-renamed`, `numeric-op-on-text-field`, `text-function-on-numeric-field`, `literal-type-mismatch`, and `message` is a human-readable sentence naming the step's op, the field(s) involved and the evidence. The array SHALL be present and empty when there are no warnings. Warnings SHALL be computed from projected schemas only, with no row reads, and SHALL be ordered deterministically (by step position, then step id, then code, then field name).

#### Scenario: Clean pipeline
- **WHEN** a pipeline has no step matching any warning condition
- **THEN** the analyze response contains `"warnings": []`

#### Scenario: Proposal analyze carries warnings
- **WHEN** a pipeline proposal whose aggregate step references a field absent from that step's input schema is analyzed
- **THEN** the proposal analyze response's `warnings` contains a `field-not-in-input-schema` entry for that step

### Requirement: Numeric use of a text field warns
For an enabled `compute` step with no `validationError` whose projected input types are trusted to equal the run-time value types (the same trust rule the join-key type check uses), the system SHALL emit one `numeric-op-on-text-field` warning per distinct input field whose projected type is `string`, `string-body`, `boolean` or `timestamp` and that the expression uses where a number is required: as an argument of `floor`, `ceil`, `round`, `mod` or `abs`, as the day-count (second) argument of `add_days`, as the start or end (second or third) argument of `substring`, or as an operand of `-`, `*`, `/` or unary `-`, either directly or within a sub-expression whose inferred type is not numeric. A field used only with `+` (string concatenation), as the text (first) argument of a string function, or as a timestamp argument of `seconds_between`, `date_trunc` or `add_days` SHALL NOT warn. The message SHALL name the step's op, the field, its projected type, the operator or function involved, and state that every non-null row will compute `null` at run time. For a `string`, `string-body` or `boolean` field it SHALL suggest adding a cast step before the compute step; for a `timestamp` field it SHALL instead suggest `seconds_between(end, start)` for a time difference or `add_days` for an offset, and SHALL NOT suggest a cast step. Type trust is tracked per column: a `compute` step leaves every column it passes through unchanged with the trust it had on its input, and makes only the column it writes untrusted. When a field's input type is not trusted (for example a column written by an earlier `compute` step, any column after a `fillnull` or `aggregate` step, or any column after a `cast` to a target whose run-time value is not the projected type), no such warning SHALL be emitted for that field. The same per-column trust SHALL apply to the join and lookup key type checks: a key column made untrusted by an earlier `compute` step SHALL NOT produce a `join-key-type-mismatch` warning. This warning is subject to the "Warnings never block" requirement.

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

#### Scenario: string-body plus a number inside a numeric function warns
- **WHEN** a compute step `floor($body + 1)` has `body` projected as `string-body` from a trusted input
- **THEN** analyze returns a `numeric-op-on-text-field` warning naming `body` and `floor`

#### Scenario: boolean plus a number inside a numeric function warns
- **WHEN** a compute step `floor($flag + 1)` has `flag` projected as `boolean` from a trusted input
- **THEN** analyze returns a `numeric-op-on-text-field` warning naming `flag` and `floor`

#### Scenario: an earlier compute on another column keeps the field trusted
- **WHEN** a pipeline over a CSV source has a compute step writing `total` followed by a compute step `floor($price)`
- **THEN** analyze returns a `numeric-op-on-text-field` warning for the second compute step naming `price`

#### Scenario: a text start for substring warns
- **WHEN** a compute step `substring($name, $start, 3)` has `start` projected as `string` over a CSV source
- **THEN** analyze returns a `numeric-op-on-text-field` warning naming `start` and `substring`

#### Scenario: a cast that now produces numbers keeps the warning silent
- **WHEN** a `cast` step converts `price` to `float` before a compute step `floor($price)`
- **THEN** no `numeric-op-on-text-field` warning is emitted for `price`

### Requirement: Join key type mismatch warns
For an enabled `join` step with no `validationError` whose secondary input schema is resolved, when the join key is present in both the left input schema and the secondary schema and the two declared types belong to different type families, the system SHALL emit a `join-key-type-mismatch` warning naming the key and both types. For an enabled `lookup` step with no `validationError` whose secondary input schema is resolved (a `lane` or a `source` secondary), when its `sourceKey` is present in the input schema and its `lookupKey` is present in the secondary schema and the two declared types belong to different type families, the system SHALL emit a `join-key-type-mismatch` warning whose message starts with `lookup:` and names both keys and both types. Types in the same family whose values compare equal at run time SHALL NOT warn. Type trust is per column on each side (see "Numeric use of a text field warns"): the left key is judged against the input's per-column trust and the right key against the secondary's per-column trust, so a `compute` step on a different column no longer suppresses the check, while a key column written by a `compute` step on either side does. When either side's key column or the secondary schema is unresolved, or either side's key type is not trusted to match the run-time values (it passed through any step whose projected types are not guaranteed to equal its run-time value types — such as aggregate, whose group-by type is informational, or a `lookup` whose secondary is a `source` — or derives from an unresolved or incomplete projection), no type-mismatch warning SHALL be emitted (a missing left key on a name-complete input is a `field-not-in-input-schema` warning instead).

#### Scenario: String key joined to integer key
- **WHEN** a join's left input declares key `id` as `string` (a CSV source) and its lane secondary input declares `id` as `integer`
- **THEN** analyze returns a `join-key-type-mismatch` warning for the join naming `id`, `string` and `integer`

#### Scenario: Informational aggregate group-by type does not warn
- **WHEN** a CSV string `id` is aggregated with a group-by declared `{type: integer}` and the result is joined on `id` to a string-keyed lane
- **THEN** no `join-key-type-mismatch` warning is emitted

#### Scenario: Matching key types
- **WHEN** both sides declare the join key with the same type
- **THEN** no `join-key-type-mismatch` warning is emitted

#### Scenario: Lookup string match field against integer reference match field
- **WHEN** a lookup's input declares `sourceKey` `customer_id` as `string` and its secondary (lane or source) declares `lookupKey` `id` as `integer`
- **THEN** analyze returns a `join-key-type-mismatch` warning for the lookup whose message starts with `lookup:` and names `customer_id`, `id`, `string` and `integer`

#### Scenario: Lookup with matching key families
- **WHEN** a lookup's `sourceKey` is `integer` and its `lookupKey` is `float`
- **THEN** no `join-key-type-mismatch` warning is emitted

#### Scenario: Output of a source-secondary lookup stays type-untrusted
- **WHEN** a lookup over a `source` secondary is followed by a join keyed on a column the lookup brought in
- **THEN** no `join-key-type-mismatch` warning is emitted for that join (the lookup's projected types are placeholders)

#### Scenario: a compute on another column keeps a join key trusted
- **WHEN** a CSV left input (key `id` as `string`) passes a compute step writing `total` before a join on `id` to a lane secondary declaring `id` as `integer`
- **THEN** analyze returns a `join-key-type-mismatch` warning naming `id`

#### Scenario: a compute-written left key does not warn
- **WHEN** the left input's compute step writes `id` before the join on `id` to an `integer`-keyed lane secondary
- **THEN** no `join-key-type-mismatch` warning is emitted

#### Scenario: a compute-written right key does not warn
- **WHEN** the lane secondary's last step is a compute writing `id`, and the CSV left input declares `id` as `string`
- **THEN** no `join-key-type-mismatch` warning is emitted

#### Scenario: a lane secondary computed on another column still warns
- **WHEN** the lane secondary (key `id` as `integer`) ends with a compute writing `total`, and the CSV left input declares `id` as `string`
- **THEN** analyze returns a `join-key-type-mismatch` warning naming `id`

#### Scenario: lookup keys follow the same per-column trust
- **WHEN** the same four shapes are built with a lane-secondary `lookup` (`sourceKey` on the left, `lookupKey` on the lane)
- **THEN** the lookup warns exactly where the join does, with a message starting `lookup:`

## ADDED Requirements

### Requirement: Text function over a numeric field warns
For an enabled `compute` step with no `validationError`, the system SHALL emit one `text-function-on-numeric-field` warning per distinct input field whose projected type is `integer` or `float`, whose type is trusted under the per-column trust rule of "Numeric use of a text field warns", and that the expression passes as the text argument of `length`, `lower`, `upper` or `substring` (its first argument), either directly or within a sub-expression whose inferred type is numeric. A numeric field inside a `+` that infers `"string"`, or inside `concat`, SHALL NOT warn, and an argument that also references any field whose type is not trusted SHALL NOT warn. The message SHALL name the step's op, the field, its projected type and the function, state that every non-null row will compute `null` at run time, and suggest `concat(...)` or a cast step to text. This warning is subject to the "Warnings never block" requirement.

#### Scenario: length of a numeric column
- **WHEN** a compute step `length($n)` has `n` projected as `integer` from a trusted input
- **THEN** analyze returns a `text-function-on-numeric-field` warning naming `n` and `length`
- **AND** the step's `validationError` is absent

#### Scenario: a numeric field made text first does not warn
- **WHEN** the compute expression is `length(concat($n))` or `length($n + "")`
- **THEN** no `text-function-on-numeric-field` warning is emitted

#### Scenario: untrusted numeric field does not warn
- **WHEN** `length($n)` follows a compute step that wrote `n`
- **THEN** no `text-function-on-numeric-field` warning is emitted

#### Scenario: mixed-trust argument does not warn
- **WHEN** `length($n * $u)` has `n` a trusted `integer` and `u` written by an earlier compute step
- **THEN** no `text-function-on-numeric-field` warning is emitted

### Requirement: Wrong-type literal warns
For an enabled `compute` step with no `validationError`, the system SHALL emit one `literal-type-mismatch` warning per distinct literal and context where a string literal is used where a number is required (a numeric context of "Numeric use of a text field warns"), or a number literal is used as the text argument of `length`, `lower`, `upper` or `substring`. A literal SHALL be counted only when it is evaluated on every row and makes that context fail on every row whatever the data: a string literal reached from the context through unary `-`, `-`/`*`/`/` operands or `+` operands (a `+` with a string literal always yields text), and a number literal reached through unary `-` or `-`/`*`/`/` operands only. A literal inside a `coalesce` argument, an `if` branch or condition, a comparison, or (for a number literal) a `+` operand SHALL NOT warn. The warning SHALL NOT depend on input type trust, because a literal's type is known. It SHALL be a warning, never a `validationError`, and it is subject to the "Warnings never block" requirement. The message SHALL name the step's op, the literal, the operator or function, and state that every row will compute `null` at run time.

#### Scenario: string literal multiplied
- **WHEN** a compute step's expression is `"3" * 2`
- **THEN** analyze returns a `literal-type-mismatch` warning naming `"3"` and `*`
- **AND** the step's `validationError` is absent and the pipeline can run

#### Scenario: number literal in a text function
- **WHEN** a compute step's expression is `length(5)`
- **THEN** analyze returns a `literal-type-mismatch` warning naming `5` and `length`

#### Scenario: concatenated string literal does not warn
- **WHEN** a compute step's expression is `"Total: " + $amount`
- **THEN** no `literal-type-mismatch` warning is emitted

#### Scenario: a literal behind coalesce or if does not warn
- **WHEN** a compute step's expression is `length(coalesce($x, 0))`, `floor(if($c, "a", $n))` or `length(5 + $x)`
- **THEN** no `literal-type-mismatch` warning is emitted
