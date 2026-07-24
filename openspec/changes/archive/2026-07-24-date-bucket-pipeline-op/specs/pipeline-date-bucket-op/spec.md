## ADDED Requirements

### Requirement: DateBucket op floors a timestamp field to the start of a granularity bucket
The execution engine SHALL support the `datebucket` op. The step config SHALL contain `field`
(string: source column name), `granularity` (string: one of `day`, `week`, `month`, `quarter`,
`year`), and an optional `outputColumn` (string; when absent, the op overwrites `field` in place).
For each row, the value at `field` SHALL be parsed as an ISO-8601 date/timestamp string or an epoch
numeric value, then floored to the start of the `granularity` bucket in UTC, and written to
`outputColumn` (or `field` if `outputColumn` is absent) as a canonical `yyyy-MM-dd` ISO date string.
Week buckets SHALL floor to the Monday (ISO-8601 week start) of the containing week. If the value at
`field` cannot be parsed, the output field's value for that row SHALL be `null` (parity with the
`cast` op's null-on-failure contract) rather than raising an error or dropping the row. If
`granularity` is not one of the five supported values, step execution SHALL fail with a descriptive
error identifying the invalid value and the supported set.

#### Scenario: Floor to day
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "day"}` is applied to rows
  containing `{"ts": "2026-03-17T14:32:00Z"}`
- **THEN** the output row contains `{"ts": "2026-03-17"}`

#### Scenario: Floor to week floors to the Monday of that ISO week
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "week"}` is applied to a row
  containing `{"ts": "2026-03-19"}` (a Thursday)
- **THEN** the output row's `ts` is `"2026-03-16"` (the Monday of that week)

#### Scenario: Floor to month
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "month"}` is applied to a row
  containing `{"ts": "2026-03-17"}`
- **THEN** the output row's `ts` is `"2026-03-01"`

#### Scenario: Floor to quarter
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "quarter"}` is applied to a row
  containing `{"ts": "2026-08-05"}`
- **THEN** the output row's `ts` is `"2026-07-01"` (start of Q3)

#### Scenario: Floor to year
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "year"}` is applied to a row
  containing `{"ts": "2026-08-05"}`
- **THEN** the output row's `ts` is `"2026-01-01"`

#### Scenario: Epoch seconds input is parsed
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "day"}` is applied to a row
  containing `{"ts": "1771286400"}` (an epoch-seconds value)
- **THEN** the output row's `ts` is a valid ISO date string derived from that instant

#### Scenario: outputColumn writes to a new field, preserving the source field
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "month", "outputColumn":
  "ts_month"}` is applied to a row containing `{"ts": "2026-03-17T00:00:00Z", "name": "foo"}`
- **THEN** the output row contains `{"ts": "2026-03-17T00:00:00Z", "ts_month": "2026-03-01", "name":
  "foo"}` — the original `ts` value is unchanged

#### Scenario: Unparseable value yields null
- **WHEN** a datebucket step with `{"field": "ts", "granularity": "day"}` is applied to a row
  containing `{"ts": "not-a-date"}`
- **THEN** the output row contains `{"ts": null}`

#### Scenario: Unsupported granularity fails at execute time
- **WHEN** a datebucket step is configured with `{"field": "ts", "granularity": "fortnight"}` and
  the pipeline is executed
- **THEN** execution fails with a descriptive error naming `fortnight` as unsupported and listing
  the valid granularities

### Requirement: DateBucket op analyze-inference matches execution output type
The `analyze_pipeline` endpoint SHALL infer, for a `datebucket` step, an output schema equal to the
input schema with the resolved output field (`outputColumn` if present, else `field`) typed `date`.
If the resolved output field name already exists in the input schema, its type SHALL be replaced
with `date` (no duplicate field is appended). If the resolved output field name is new, it SHALL be
appended to the schema as an additional field typed `date`.

#### Scenario: Overwrite case does not duplicate the field
- **WHEN** `analyze_pipeline` is called for a pipeline step `{"op": "datebucket", "config":
  {"field": "ts", "granularity": "day"}}` whose input schema contains a field `ts` typed `string`
- **THEN** the inferred output schema contains exactly one field named `ts`, typed `date`

#### Scenario: New outputColumn is appended
- **WHEN** `analyze_pipeline` is called for a pipeline step `{"op": "datebucket", "config":
  {"field": "ts", "granularity": "month", "outputColumn": "ts_month"}}` whose input schema contains
  fields `ts` (string) and `name` (string)
- **THEN** the inferred output schema contains `ts` (string, unchanged), `name` (string, unchanged),
  and a new field `ts_month` typed `date`

### Requirement: DateBucket op is persisted via the standard pipeline_steps op CHECK constraint
The `pipeline_steps.op` column CHECK constraint SHALL accept `'datebucket'` as a valid value,
additive to the existing set of accepted op strings. Existing pipeline steps and their persisted
`op` values SHALL be unaffected by this migration.

#### Scenario: A datebucket step persists successfully
- **WHEN** a pipeline step with `op: "datebucket"` is created via the pipeline steps API
- **THEN** the row is inserted successfully and round-trips on read

### Requirement: Frontend StepCard renders a datebucket config editor
When a pipeline step has `op: "datebucket"` and the step card is expanded, the frontend SHALL
render an editor with: a source-field selector (options sourced from the analyze endpoint's
`inputSchema` for that step), a granularity selector offering exactly `day`, `week`, `month`,
`quarter`, `year`, and an optional output-column text input. Changing any control SHALL PATCH the
step's persisted config with the updated `field` / `granularity` / `outputColumn` values.

#### Scenario: Editing granularity updates the step config
- **WHEN** the user selects `month` in the granularity dropdown for a datebucket step
- **THEN** the step config is patched with `{"granularity": "month"}` merged into the existing
  `field` / `outputColumn` values

#### Scenario: Leaving outputColumn blank omits it from the config
- **WHEN** the user leaves the output-column input blank and saves
- **THEN** the persisted config has no `outputColumn` key (or `outputColumn: null`), meaning the op
  overwrites `field` in place

### Requirement: MCP add_pipeline_step tool supports the datebucket op
The `add_pipeline_step` MCP tool SHALL list `datebucket` as a valid `op` value and document its
config shape (`field`, `granularity`, optional `outputColumn`), so agent-driven pipeline
construction can add date-bucket steps without direct API knowledge.

#### Scenario: MCP tool schema includes datebucket
- **WHEN** an MCP client inspects the `add_pipeline_step` tool's input schema
- **THEN** `datebucket` appears among the allowed `op` enum values with its config shape documented
