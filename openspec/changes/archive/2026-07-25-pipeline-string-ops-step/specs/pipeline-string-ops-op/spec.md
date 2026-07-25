## ADDED Requirements

### Requirement: StringOps op performs a per-value string transform and writes a derived string column
The execution engine SHALL support the `stringops` op. The step config SHALL contain `operation`
(string: one of `trim`, `upper`, `lower`, `split`, `extractRegex`, `concat`), `field` (string:
source column name), `outputColumn` (string: destination column name — if equal to `field`, the
op overwrites the source column in place; otherwise it writes a distinct column), and operation-
specific parameters: `pattern` (string, required for `extractRegex`, MUST contain at least one
capturing group), `separator` (string, required for `split`), `index` (integer, required for
`split`), and `fields` (array of strings, used by `concat`). Row count SHALL be unchanged by this
op — it is a per-value column transform, distinct from the row-exploding `splittext` op. If
`operation` is not one of the six supported values, step execution SHALL fail with a descriptive
error identifying the invalid value and the supported set.

#### Scenario: trim removes leading/trailing whitespace
- **WHEN** a stringops step with `{"operation": "trim", "field": "name", "outputColumn": "name"}`
  is applied to a row containing `{"name": "  Ada  "}`
- **THEN** the output row contains `{"name": "Ada"}`

#### Scenario: upper converts to uppercase
- **WHEN** a stringops step with `{"operation": "upper", "field": "code", "outputColumn": "code"}`
  is applied to a row containing `{"code": "ab-12"}`
- **THEN** the output row contains `{"code": "AB-12"}`

#### Scenario: lower converts to lowercase
- **WHEN** a stringops step with `{"operation": "lower", "field": "code", "outputColumn": "code"}`
  is applied to a row containing `{"code": "AB-12"}`
- **THEN** the output row contains `{"code": "ab-12"}`

#### Scenario: split takes an indexed segment
- **WHEN** a stringops step with `{"operation": "split", "field": "path", "separator": "/",
  "index": 1, "outputColumn": "segment"}` is applied to a row containing `{"path": "a/b/c"}`
- **THEN** the output row contains `{"path": "a/b/c", "segment": "b"}`

#### Scenario: split with an out-of-bounds index yields null
- **WHEN** a stringops step with `{"operation": "split", "field": "path", "separator": "/",
  "index": 5, "outputColumn": "segment"}` is applied to a row containing `{"path": "a/b/c"}`
- **THEN** the output row's `segment` is `null`

#### Scenario: extractRegex extracts the first capturing group
- **WHEN** a stringops step with `{"operation": "extractRegex", "field": "email", "pattern":
  "^([^@]+)@", "outputColumn": "localPart"}` is applied to a row containing `{"email":
  "ada@example.com"}`
- **THEN** the output row contains `{"email": "ada@example.com", "localPart": "ada"}`

#### Scenario: extractRegex with no match yields null
- **WHEN** a stringops step with `{"operation": "extractRegex", "field": "email", "pattern":
  "^([^@]+)@", "outputColumn": "localPart"}` is applied to a row containing `{"email": "not-an-email"}`
- **THEN** the output row's `localPart` is `null`

#### Scenario: extractRegex pattern without a capturing group fails at execute time
- **WHEN** a stringops step is configured with `{"operation": "extractRegex", "field": "email",
  "pattern": "[^@]+", "outputColumn": "localPart"}` and the pipeline is executed
- **THEN** execution fails with a descriptive error naming the pattern and stating it requires a
  capturing group

#### Scenario: concat joins named fields with a separator
- **WHEN** a stringops step with `{"operation": "concat", "fields": ["first", "last"], "separator":
  " ", "outputColumn": "fullName"}` is applied to a row containing `{"first": "Ada", "last":
  "Lovelace"}`
- **THEN** the output row contains `{"first": "Ada", "last": "Lovelace", "fullName": "Ada Lovelace"}`

#### Scenario: concat treats a missing/null field as an empty string, not whole-output null
- **WHEN** a stringops step with `{"operation": "concat", "fields": ["first", "middle", "last"],
  "separator": " ", "outputColumn": "fullName"}` is applied to a row containing `{"first": "Ada",
  "last": "Lovelace"}` (no `middle` key)
- **THEN** the output row's `fullName` is `"Ada  Lovelace"` (the missing `middle` contributes an
  empty string, not a null propagation) — row count and the other fields are unaffected

#### Scenario: A null/missing source field yields null for single-field operations
- **WHEN** a stringops step with `{"operation": "trim", "field": "name", "outputColumn": "name"}`
  is applied to a row containing `{"name": null}`
- **THEN** the output row's `name` is `null`

#### Scenario: outputColumn distinct from field appends a new column, preserving the source field
- **WHEN** a stringops step with `{"operation": "upper", "field": "code", "outputColumn":
  "codeUpper"}` is applied to a row containing `{"code": "ab-12", "name": "foo"}`
- **THEN** the output row contains `{"code": "ab-12", "codeUpper": "AB-12", "name": "foo"}` — the
  original `code` value is unchanged

#### Scenario: Unsupported operation fails at execute time
- **WHEN** a stringops step is configured with `{"operation": "reverse", "field": "code",
  "outputColumn": "code"}` and the pipeline is executed
- **THEN** execution fails with a descriptive error naming `reverse` as unsupported and listing the
  six supported operations

### Requirement: StringOps op analyze-inference matches execution output type
The `analyze_pipeline` endpoint SHALL infer, for a `stringops` step, an output schema equal to the
input schema with `outputColumn` typed `string`. If `outputColumn` already exists in the input
schema (including the `outputColumn == field` overwrite case), its type SHALL be replaced with
`string` (no duplicate field is appended). If `outputColumn` is new, it SHALL be appended to the
schema as an additional field typed `string`.

#### Scenario: Overwrite case does not duplicate the field
- **WHEN** `analyze_pipeline` is called for a pipeline step `{"op": "stringops", "config":
  {"operation": "trim", "field": "name", "outputColumn": "name"}}` whose input schema contains a
  field `name` typed `string`
- **THEN** the inferred output schema contains exactly one field named `name`, typed `string`

#### Scenario: New outputColumn is appended
- **WHEN** `analyze_pipeline` is called for a pipeline step `{"op": "stringops", "config":
  {"operation": "concat", "fields": ["first", "last"], "separator": " ", "outputColumn":
  "fullName"}}` whose input schema contains fields `first` (string) and `last` (string)
- **THEN** the inferred output schema contains `first` (string, unchanged), `last` (string,
  unchanged), and a new field `fullName` typed `string`

### Requirement: StringOps op is persisted via the standard pipeline_steps op CHECK constraint
The `pipeline_steps.op` column CHECK constraint SHALL accept `'stringops'` as a valid value,
additive to the existing set of accepted op strings. Existing pipeline steps and their persisted
`op` values, including the row-exploding `splittext` op, SHALL be unaffected by this migration.

#### Scenario: A stringops step persists successfully
- **WHEN** a pipeline step with `op: "stringops"` is created via the pipeline steps API
- **THEN** the row is inserted successfully and round-trips on read

### Requirement: Frontend StepCard renders a stringops config editor
When a pipeline step has `op: "stringops"` and the step card is expanded, the frontend SHALL
render an editor with an operation selector (`trim`/`upper`/`lower`/`split`/`extractRegex`/
`concat`) whose remaining fields adapt to the chosen operation: `field` and `outputColumn` for
`trim`/`upper`/`lower`; `field`, `separator`, `index`, and `outputColumn` for `split`; `field`,
`pattern`, and `outputColumn` for `extractRegex`; `fields` (multi-select) and `separator` and
`outputColumn` for `concat`. Changing any control SHALL PATCH the step's persisted config with the
updated values.

#### Scenario: Switching operation reveals only the relevant params
- **WHEN** the user selects `split` in the operation dropdown for a stringops step
- **THEN** the editor shows `separator` and `index` inputs and hides `pattern` and the `fields`
  multi-select

#### Scenario: Editing a param updates the step config
- **WHEN** the user changes the `separator` input to `","` for a `split`-operation stringops step
- **THEN** the step config is patched with `{"separator": ","}` merged into the existing
  `operation`/`field`/`index`/`outputColumn` values

### Requirement: MCP add_pipeline_step tool supports the stringops op
The `add_pipeline_step` MCP tool SHALL list `stringops` as a valid `op` value and document its
config shape (`operation`, `field`, `outputColumn`, and the operation-specific `pattern`/
`separator`/`index`/`fields` parameters), so agent-driven pipeline construction can add
string-cleaning steps without direct API knowledge.

#### Scenario: MCP tool schema includes stringops
- **WHEN** an MCP client inspects the `add_pipeline_step` tool's input schema
- **THEN** `stringops` appears among the allowed `op` values in the tool description, with its
  config shape documented
