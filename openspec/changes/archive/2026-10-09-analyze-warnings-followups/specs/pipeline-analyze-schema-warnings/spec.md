## MODIFIED Requirements

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

### Requirement: MCP analyze tools expose warnings
The helio-mcp `analyze_pipeline` and `analyze_pipeline_proposal` tools SHALL document the `warnings` field as non-blocking pre-run findings that do not affect `canRun`, and the helio-mcp response types SHALL declare it. The `analyze_pipeline` description of concise mode SHALL NOT claim the concise response contains no column names while a concise warning message may list available columns.

#### Scenario: Tool description
- **WHEN** an agent lists the helio-mcp tools
- **THEN** the `analyze_pipeline` and `analyze_pipeline_proposal` descriptions mention `warnings` and that they do not affect `canRun`

#### Scenario: Concise wording matches the payload
- **WHEN** an agent reads the `analyze_pipeline` description
- **THEN** it states that concise mode omits per-step schema column lists and that a warning message may name available columns
- **AND** its `join-key-type-mismatch` text states that the code also covers lookup keys

## ADDED Requirements

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
