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

The **proposal** analyze surface SHALL be driven from the caller-supplied RAW configuration text rather
than from a decoded typed configuration, so that it reports configuration keys which a step's tolerant
persistence decoder would silently reduce to an empty default. This property SHALL be demonstrable through
that surface's own observable output: for a configuration the typed decoder reduces to an empty value, the
proposal analyze surface SHALL still report a non-empty `validationError` for that step.

This property SHALL NOT be claimed of the stored-pipeline analyze surface. That surface re-encodes each
step from its already-decoded typed configuration, so a dropped key is destroyed by the read round-trip
before inference runs and cannot be reported there. A mistyped configuration on a persisted step is
therefore detectable only at write time.

Every validator in the validated set, and the combining of multiple failures into one message, SHALL be
observable through the analyze surface a caller actually uses, rather than only through an internal
stand-in.

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

#### Scenario: An unsupported aggregate function is reported at analyze time
- **GIVEN** a pipeline containing an `aggregate` step whose aggregation function is not supported
- **WHEN** the pipeline is analyzed
- **THEN** that step's `validationError` names the unsupported function and lists the supported ones
- **AND** that step's `outputSchema` equals its `inputSchema`

#### Scenario: An unsupported groupby function is reported at analyze time
- **GIVEN** a pipeline containing a `groupby` step whose aggregation function is not supported
- **WHEN** the pipeline is analyzed
- **THEN** that step's `validationError` names the unsupported function and lists the supported ones

#### Scenario: An unsupported pivot aggregation is reported at analyze time
- **GIVEN** a pipeline containing a `pivot` step whose `agg` is not supported
- **WHEN** the pipeline is analyzed
- **THEN** that step's `validationError` names the unsupported aggregation and lists the supported ones

#### Scenario: An unsupported union mode is reported at analyze time
- **GIVEN** a pipeline containing a `union` step whose `mode` is not supported
- **WHEN** the pipeline is analyzed
- **THEN** that step's `validationError` names the unsupported mode and lists the supported ones

#### Scenario: An unsupported join type is reported at analyze time
- **GIVEN** a pipeline containing a `join` step whose `type` is not supported
- **WHEN** the pipeline is analyzed
- **THEN** that step's `validationError` names the unsupported join type and lists the supported ones

#### Scenario: Multiple failures on one step are combined into a single message
- **GIVEN** a pipeline containing a step with two independent configuration failures
- **WHEN** the pipeline is analyzed
- **THEN** that step's single `validationError` contains both failure messages
- **AND** neither failure is silently dropped in favour of the other

#### Scenario: The proposal analyze surface reports a key the typed decoder would discard
- **GIVEN** a pipeline proposal containing a `cast` step whose `casts` value uses a shape the step's typed
  decoder reduces to an empty cast map
- **WHEN** that proposal is analyzed through the proposal analyze endpoint
- **THEN** that step's `validationError` is present and non-empty
- **AND** the typed decoder independently yields an empty cast map for the same raw configuration,
  demonstrating that the proposal analyze surface observed what the decoder discarded

#### Scenario: The stored-pipeline analyze surface cannot report such a key
- **GIVEN** a persisted `cast` step whose stored configuration uses that same shape
- **WHEN** the stored pipeline is analyzed
- **THEN** no `validationError` is reported for that step on account of the discarded key
- **AND** the defect is instead prevented at write time by rejecting the configuration
