## ADDED Requirements

### Requirement: Assert op is a pass-through step that persists a vector of assertion rules
The execution engine SHALL support the `assert` op. The step config SHALL contain `rules`, an array of
assertion rule objects, each with `kind` (string; one of `notNull`, `unique`, `range`, `rowCountMin`,
`rowCountMax`, `regex`), `field` (optional string; the row field the rule targets), `params` (object;
kind-specific parameters), and `severity` (string; `warn` or `error`). At execute time the engine SHALL
return the input rows unchanged — rule evaluation and per-run result recording are not part of this
requirement (a separate, later capability).

#### Scenario: Assert step passes rows through unchanged
- **WHEN** an assert step with one or more configured rules is executed against any input rows
- **THEN** the output rows are identical to the input rows

### Requirement: Assert config decode tolerates partial or legacy data without throwing
`AssertConfig.decode` SHALL NOT throw for any input, including a config missing the `rules` key
entirely (defaulting to an empty rule vector) and a `rules` array containing entries with missing or
malformed fields (each malformed field defaulting rather than causing the entry, or the whole config,
to be rejected).

#### Scenario: Missing rules key decodes to an empty rule vector
- **WHEN** `AssertConfig.decode` is called with `{}`
- **THEN** the decoded config has an empty `rules` vector

#### Scenario: A malformed rule entry does not throw
- **WHEN** `AssertConfig.decode` is called with `{"rules": [{"kind": "notNull"}]}` (missing `field`,
  `params`, `severity`)
- **THEN** decode succeeds without throwing, producing a rule with `kind: "notNull"` and default values
  for the missing fields

### Requirement: Assert op analyze-inference returns an identity output schema
The `analyze_pipeline` endpoint SHALL infer, for an `assert` step, an output schema identical to the
input schema (assert never adds, removes, or retypes fields), regardless of whether a
`validationError` is also present.

#### Scenario: Analyze returns the input schema unchanged
- **WHEN** `analyze_pipeline` is called for a pipeline step `{"op": "assert", "config": {"rules": []}}`
  whose input schema contains fields `id` (string) and `amount` (number)
- **THEN** the inferred output schema is exactly `id` (string), `amount` (number)

### Requirement: Assert op analyze-inference flags invalid rule kind, severity, or field references
The `analyze_pipeline` endpoint SHALL emit a `validationError` for an `assert` step when any rule's
`kind` is not one of the six allow-listed kinds, any rule's `severity` is not `warn` or `error`, or a
`notNull`/`unique`/`range`/`regex` rule's `field` is absent or names a field not present in the input
schema. `rowCountMin`/`rowCountMax` rules are dataset-level and SHALL NOT be checked against `field`.
Problems across all rules SHALL be aggregated into a single `validationError` message rather than
stopping at the first invalid rule.

#### Scenario: Unknown field on a notNull rule produces a validationError
- **WHEN** `analyze_pipeline` is called for a pipeline step `{"op": "assert", "config": {"rules":
  [{"kind": "notNull", "field": "missing_field", "params": {}, "severity": "error"}]}}` whose input
  schema does not contain `missing_field`
- **THEN** the response includes a `validationError` naming `missing_field`, and the output schema
  equals the input schema unchanged

#### Scenario: Invalid kind produces a validationError
- **WHEN** `analyze_pipeline` is called for a pipeline step `{"op": "assert", "config": {"rules":
  [{"kind": "bogus", "field": null, "params": {}, "severity": "error"}]}}`
- **THEN** the response includes a `validationError` naming the invalid kind

#### Scenario: Invalid severity produces a validationError
- **WHEN** `analyze_pipeline` is called for a pipeline step `{"op": "assert", "config": {"rules":
  [{"kind": "unique", "field": "id", "params": {}, "severity": "critical"}]}}` whose input schema
  contains `id`
- **THEN** the response includes a `validationError` naming the invalid severity

#### Scenario: rowCountMin rule is not checked against field
- **WHEN** `analyze_pipeline` is called for a pipeline step `{"op": "assert", "config": {"rules":
  [{"kind": "rowCountMin", "field": null, "params": {"count": 1}, "severity": "warn"}]}}`
- **THEN** no `validationError` is present solely due to the absent `field`

### Requirement: Assert op is persisted via the standard pipeline_steps op CHECK constraint
The `pipeline_steps.op` column CHECK constraint SHALL accept `'assert'` as a valid value, additive to
the existing set of accepted op strings. Existing pipeline steps and their persisted `op` values SHALL
be unaffected by this migration.

#### Scenario: An assert step persists successfully
- **WHEN** a pipeline step with `op: "assert"` is created via the pipeline steps API
- **THEN** the row is inserted successfully and round-trips on read

### Requirement: Frontend StepCard renders an assert rule editor and assert is offered in the add-step picker
When a pipeline step has `op: "assert"` and the step card is expanded, the frontend SHALL render an
editor that lists the configured rules and lets the user add or remove rules, each with a `kind`
selector, a `field` selector (shown only for field-requiring kinds, sourced from the current step's
input schema), kind-specific `params` inputs, and a `severity` selector. Changing any control SHALL
PATCH the step's persisted config with the updated `rules`. `assert` SHALL appear in the add-step
picker (`OP_TYPES`).

#### Scenario: Adding a rule updates the step config
- **WHEN** the user clicks "Add rule" on an assert step's editor
- **THEN** the step config is patched with an additional rule appended to `rules`

#### Scenario: Removing a rule updates the step config
- **WHEN** the user removes a rule from an assert step's editor
- **THEN** the step config is patched with that rule removed from `rules`

#### Scenario: Assert is offered in the add-step picker
- **WHEN** the user opens the add-step picker to add a new pipeline step
- **THEN** `assert` appears among the offered op choices
