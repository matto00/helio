# pipeline-analyze-schema-warnings Specification

## Purpose
Lets an agent or user see, before running a pipeline, schema-visible mistakes that would otherwise produce a clean run with wrong or empty results: a step reading a field its input does not carry, a join whose key columns have different types, a join that renames a same-named right column, and a compute step that uses a text-typed field where a number is required.

## Requirements

### Requirement: Analyze responses carry schema-only warnings
`GET /api/pipelines/{id}/analyze` and `POST /api/pipelines/analyze-proposal` SHALL include a top-level `warnings` array on every 200 response. Each entry SHALL be an object `{stepId, code, message}` where `stepId` is the id of the step the warning is about (the proposal's client step id for a proposal), `code` is one of `field-not-in-input-schema`, `join-key-type-mismatch`, `join-column-renamed`, `numeric-op-on-text-field`, and `message` is a human-readable sentence naming the step's op, the field(s) involved and the evidence. The array SHALL be present and empty when there are no warnings. Warnings SHALL be computed from projected schemas only, with no row reads, and SHALL be ordered deterministically (by step position, then step id, then code, then field name).

#### Scenario: Clean pipeline
- **WHEN** a pipeline has no step matching any warning condition
- **THEN** the analyze response contains `"warnings": []`

#### Scenario: Proposal analyze carries warnings
- **WHEN** a pipeline proposal whose aggregate step references a field absent from that step's input schema is analyzed
- **THEN** the proposal analyze response's `warnings` contains a `field-not-in-input-schema` entry for that step

### Requirement: Missing referenced field warns
For an enabled step with no `validationError`, the system SHALL emit one `field-not-in-input-schema` warning per distinct input field name the step's config references that is not present in that step's projected input schema, for every step kind whose analyze validation does not already report that reference as an unknown-field `validationError`. A reference the step kind treats as "no field" (an empty value, or a documented wildcard) SHALL NOT warn. No such warning SHALL be emitted when the step's projected input is not known to be name-complete: an input is not name-complete when it derives (through any parent or lane input) from a root with an empty source schema, from a `join` or `union` whose secondary input schema could not be resolved, from a step with a `validationError`, or from a step whose output column names depend on the data and are not projected (such as `pivot`); a step whose output column names are wholly determined by its own config (aggregate, groupby) without a `validationError` restores name-completeness for its descendants. The message SHALL state that the field was not found in the step's inferred input schema (not that it does not exist), and SHALL list the available field names (bounded in length).

#### Scenario: Aggregate over a missing column
- **WHEN** an aggregate step `count(amount)` follows a step whose projected output is `(category, total)`
- **THEN** analyze returns a `field-not-in-input-schema` warning for the aggregate step naming `amount` and the available fields `category, total`
- **AND** the aggregate step's `validationError` is absent

#### Scenario: Reference already reported as an error does not also warn
- **WHEN** a step kind already reports an unknown field as its `validationError`
- **THEN** no `field-not-in-input-schema` warning is emitted for that step

#### Scenario: Reference to a column from an unresolved union secondary does not warn
- **WHEN** a `union` whose secondary input is a source whose schema analyze does not resolve is followed by a step referencing a column only that source carries
- **THEN** no `field-not-in-input-schema` warning is emitted for that step

#### Scenario: Reference under an unresolvable join secondary does not warn
- **WHEN** a `join` whose source secondary input has no resolvable schema is followed by a step referencing a right-side column
- **THEN** no `field-not-in-input-schema` warning is emitted for that step

#### Scenario: Reference under an empty root schema does not warn
- **WHEN** a root with an empty source schema feeds a column-adding step followed by a step referencing a source column
- **THEN** no `field-not-in-input-schema` warning is emitted for that step

#### Scenario: Reference to a pivoted column does not warn
- **WHEN** a `pivot` step is followed by a step referencing a column the pivot produces from the data (e.g. `sales_2024`)
- **THEN** no `field-not-in-input-schema` warning is emitted for that step

#### Scenario: Disabled step does not warn
- **WHEN** a step referencing a missing field is disabled
- **THEN** no warning is emitted for it

### Requirement: Join key type mismatch warns
For an enabled `join` step with no `validationError` whose secondary input schema is resolved, when the join key is present in both the left input schema and the secondary schema and the two declared types belong to different type families, the system SHALL emit a `join-key-type-mismatch` warning naming the key and both types. For an enabled `lookup` step with no `validationError` whose secondary input schema is resolved (a `lane` or a `source` secondary), when its `sourceKey` is present in the input schema and its `lookupKey` is present in the secondary schema and the two declared types belong to different type families, the system SHALL emit a `join-key-type-mismatch` warning whose message starts with `lookup:` and names both keys and both types. Types in the same family whose values compare equal at run time SHALL NOT warn. When either side's key column or the secondary schema is unresolved, or either side's key type is not trusted to match the run-time values (it passed through any step whose projected types are not guaranteed to equal its run-time value types — such as aggregate, whose group-by type is informational, or a `lookup` whose secondary is a `source` — or derives from an unresolved or incomplete projection), no type-mismatch warning SHALL be emitted (a missing left key on a name-complete input is a `field-not-in-input-schema` warning instead).

#### Scenario: String key joined to integer key
- **WHEN** a join's left input declares key `id` as `string` (a CSV source) and its lane secondary input declares `id` as `integer`
- **THEN** analyze returns a `join-key-type-mismatch` warning for the join naming `id`, `string` and `integer`

#### Scenario: Informational aggregate group-by type does not warn
- **WHEN** a CSV string `id` is aggregated with a group-by declared `{type: integer}` and the result is joined on `id` to a string-keyed lane
- **THEN** no `join-key-type-mismatch` warning is emitted

#### Scenario: Matching key types
- **WHEN** both sides declare the join key with the same type
- **THEN** no `join-key-type-mismatch` warning is emitted

#### Scenario: Lookup string source key against integer lookup key
- **WHEN** a lookup's input declares `sourceKey` `customer_id` as `string` and its secondary (lane or source) declares `lookupKey` `id` as `integer`
- **THEN** analyze returns a `join-key-type-mismatch` warning for the lookup whose message starts with `lookup:` and names `customer_id`, `id`, `string` and `integer`

#### Scenario: Lookup with matching key families
- **WHEN** a lookup's `sourceKey` is `integer` and its `lookupKey` is `float`
- **THEN** no `join-key-type-mismatch` warning is emitted

#### Scenario: Output of a source-secondary lookup stays type-untrusted
- **WHEN** a lookup over a `source` secondary is followed by a join keyed on a column the lookup brought in
- **THEN** no `join-key-type-mismatch` warning is emitted for that join (the lookup's projected types are placeholders)

### Requirement: Join column rename warns
For an enabled `join` or `lookup` step with no `validationError` whose secondary schema is resolved (a `lane` secondary, or a `source` secondary whose stored inferred schema is non-empty) and whose two inputs are name-complete, the system SHALL emit one `join-column-renamed` warning per right-side column that the shared join column-naming rule renames because of a collision, naming the original column and the output name it will appear under. The warning SHALL NOT change the projected output schema or the run-time naming.

#### Scenario: Both lanes alias the same column
- **WHEN** a join's left input and its lane secondary input both carry a non-key column `total`
- **THEN** analyze returns a `join-column-renamed` warning stating the right-side `total` will appear as `right_total`
- **AND** the step's projected output schema is unchanged by the warning

#### Scenario: Lookup over a source secondary renames a colliding column
- **WHEN** a lookup whose secondary is a `source` requests column `name` and its input already carries `name`
- **THEN** analyze returns a `join-column-renamed` warning for the lookup stating `name` will appear as `right_name`
- **AND** the lookup's projected output schema is the same as before this change

### Requirement: Warnings never block
Warnings SHALL NOT set or alter any step's `validationError`, SHALL NOT affect `costVerdict` (`canRun`, `autoRunnable`, `reasons`), SHALL NOT affect whether a dataset write triggers a downstream auto-run, and SHALL NOT cause any pipeline or step write to be rejected.

#### Scenario: Warned pipeline remains runnable
- **WHEN** the pipeline owner analyzes a pipeline whose only findings are warnings
- **THEN** `costVerdict.canRun` is `true` and `costVerdict.reasons` contains no entry caused by the warnings

#### Scenario: Warned pipeline still auto-runs on dataset write
- **WHEN** a dataset write targets a source feeding a pipeline whose only findings are warnings, and the pipeline is otherwise eligible
- **THEN** the downstream auto-run is not suppressed by the warnings

### Requirement: Concise analyze carries per-node warnings
`GET /api/pipelines/{id}/analyze?concise=true` SHALL include, on each node with at least one warning, a `warnings` array of that node's warning messages; the key SHALL be omitted on nodes without warnings.

#### Scenario: Concise node with a warning
- **WHEN** a pipeline with a missing-field aggregate is analyzed with `concise=true`
- **THEN** that aggregate node carries a `warnings` array with the missing-field message and other nodes carry no `warnings` key

### Requirement: MCP analyze tools expose warnings
The helio-mcp `analyze_pipeline` and `analyze_pipeline_proposal` tools SHALL document the `warnings` field as non-blocking pre-run findings that do not affect `canRun`, and the helio-mcp response types SHALL declare it. The `analyze_pipeline` description of concise mode SHALL NOT claim the concise response contains no column names while a concise warning message may list available columns.

#### Scenario: Tool description
- **WHEN** an agent lists the helio-mcp tools
- **THEN** the `analyze_pipeline` and `analyze_pipeline_proposal` descriptions mention `warnings` and that they do not affect `canRun`

#### Scenario: Concise wording matches the payload
- **WHEN** an agent reads the `analyze_pipeline` description
- **THEN** it states that concise mode omits per-step schema column lists and that a warning message may name available columns
- **AND** its `join-key-type-mismatch` text states that the code also covers lookup keys

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

### Requirement: Workspace context carries per-step warnings
helio-mcp `get_workspace_context` SHALL attach each pipeline's analyze warnings to the matching step entry by step id as `warnings: [{code, message}]`, in both full and concise mode (concise mode SHALL NOT omit them). The key SHALL be omitted for a step with no warnings. The tool description SHALL state that these are non-blocking hints that do not affect whether the pipeline can run.

#### Scenario: Full context step with a warning
- **WHEN** a pipeline's analyze returns a `field-not-in-input-schema` warning for step S
- **THEN** S's entry in `get_workspace_context` carries `warnings` with that code and message, and other steps carry no `warnings` key

#### Scenario: Concise context step with warnings
- **WHEN** the same workspace is fetched with `concise: true` and step S has two warnings
- **THEN** S's entry carries `warnings` with both entries, and concise `omittedDetailKinds` is unchanged

### Requirement: Lookup key missing from the secondary input warns
For an enabled `lookup` step with no `validationError` whose secondary input schema is resolved and name-complete (a `lane` or a `source` secondary), when its `lookupKey` is not present in the secondary schema, the system SHALL emit a `field-not-in-input-schema` warning whose message starts with `lookup:` and names the key and the secondary schema as its evidence base. This warning is subject to the "Warnings never block" requirement.

#### Scenario: Lookup key absent from the secondary
- **WHEN** a lookup's `lookupKey` is `cust_id` and its resolved secondary schema carries `id` and `name` only
- **THEN** analyze returns a `field-not-in-input-schema` warning for the lookup naming `cust_id`

#### Scenario: Unresolved secondary does not warn
- **WHEN** a lookup's secondary is a `source` with no stored inferred schema
- **THEN** no warning about `lookupKey` is emitted

### Requirement: Lookup warnings use the lookup editor's field labels
Every analyze warning message emitted for a `lookup` step that names the step's `sourceKey` or `lookupKey` SHALL refer to them with the lookup editor's own labels: the `sourceKey` as the "match field" and the `lookupKey` as the "reference match field". Such messages SHALL NOT use the phrases "source key" or "lookup key". The warning `code` values and every non-lookup warning message are unchanged.

#### Scenario: Key type mismatch names the editor's labels
- **WHEN** a lookup's `sourceKey` `customer_id` is `string` on the input and its `lookupKey` `id` is `integer` on the secondary input
- **THEN** the `join-key-type-mismatch` warning message starts with `lookup:`, contains `match field 'customer_id'` and `reference match field 'id'`, and contains neither `source key` nor `lookup key`

#### Scenario: Missing reference key names the editor's label
- **WHEN** a lookup's `lookupKey` `cust_id` is absent from its resolved secondary schema
- **THEN** the `field-not-in-input-schema` warning message starts with `lookup:` and contains `reference match field 'cust_id'`

#### Scenario: Missing match field names the editor's label
- **WHEN** a lookup's `sourceKey` `cust` is absent from its name-complete input schema
- **THEN** the `field-not-in-input-schema` warning message starts with `lookup: match field 'cust' not found` and does not contain `source key`

#### Scenario: Join wording is unchanged
- **WHEN** a join's key is absent from its secondary schema
- **THEN** the warning message is byte-identical to the message emitted before this change
