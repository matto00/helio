# pipeline-step-config-validation Specification

## Purpose
Validate step configuration values at analyze time, not only during execution, so a step that cannot possibly run is reported through its `validationError` before any run is attempted.

## Requirements

### Requirement: Step configuration is validated at analyze time, not only at execution
The pipeline analyze surface SHALL validate each step's configuration values that are decidable from the
configuration alone, and SHALL report any failure through that step's existing `validationError` field.
Validation SHALL run before schema inference for that step; when validation fails, the step's
`outputSchema` SHALL equal its `inputSchema` (the identity fallback already used for steps with a
validation error), and no new response field or shape SHALL be introduced.

The set of validated configuration values SHALL be exactly those enum-valued options for which the
executing step already performs the same check at run time: `stringops.operation`, `fillnull.strategy`
(including `constant` requiring `value`), `window.function` (including its per-function `field` and
`offset` requirements), `aggregate` / `groupby` / `pivot` aggregation functions, `union.mode`, and
`join.type`.

Each validator SHALL derive its accepted values from the executing step's own supported-value set rather
than from a copy, so the analyze surface can never reject a value the engine accepts.

Conditions that are not decidable from configuration alone SHALL NOT be reported at analyze time: data
conditions such as `datebucket` finding no parseable timestamp, referenced-DataSource existence for
`union` / `join` / `lookup`, and field existence against the inferred input schema.

When more than one validation failure applies to a single step, the messages SHALL be combined into that
step's single `validationError` value rather than any one failure silently taking precedence.

#### Scenario: Unsupported stringops operation is reported before any run
- **GIVEN** a pipeline containing a `stringops` step with `operation` set to `"regexExtract"`
- **WHEN** the pipeline is analyzed
- **THEN** that step's `validationError` is present and non-null
- **AND** the message names `regexExtract` as unsupported and lists `extractRegex` among the supported
  operations
- **AND** that step's `outputSchema` equals its `inputSchema`

#### Scenario: A valid step reports no validation error
- **GIVEN** a pipeline containing a `stringops` step with `operation` set to `"extractRegex"` and a
  `pattern`
- **WHEN** the pipeline is analyzed
- **THEN** that step's `validationError` is absent
- **AND** its `outputSchema` is inferred as before

#### Scenario: A data condition is not reported as a configuration error
- **GIVEN** a pipeline containing a `datebucket` step over a field whose values may not parse as dates
- **WHEN** the pipeline is analyzed
- **THEN** no `validationError` is reported for that step on account of unparseable values
