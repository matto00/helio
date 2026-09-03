# pipeline-step-config-validation Specification

## Purpose
Validate step configuration values at analyze time, not only during execution, so a step that cannot possibly run is reported through its `validationError` before any run is attempted.

## Requirements

### Requirement: Step configuration is validated at analyze time, not only at execution
Validation of a `join`, `union` or `lookup` step config at analyze time SHALL report, as named config problems, a `secondaryInput` that is absent, carries an unrecognised `kind`, or pairs a `kind` with the wrong field — via the same validation path the run-time completeness check uses, so the two cannot disagree. A `source`-kind input with an empty `dataSourceId` SHALL be reported as an incomplete configuration in the same manner as any other unset required field, not as an invalid one. A `lane`-kind input naming a step outside the pipeline, or forming a cycle, SHALL be reported as a named problem.

#### Scenario: Unrecognised kind is reported
- **WHEN** a config carries `{"secondaryInput": {"kind": "other", "stepId": "x"}}`
- **THEN** analyze reports a named problem identifying the invalid `kind`

#### Scenario: Mismatched field for the declared kind is reported
- **WHEN** a config carries `{"secondaryInput": {"kind": "lane", "dataSourceId": "x"}}`
- **THEN** analyze reports a named problem

#### Scenario: An unset source-kind input is reported as incomplete, not invalid
- **WHEN** a config carries `{"secondaryInput": {"kind": "source", "dataSourceId": ""}}`
- **THEN** analyze reports it as an incomplete configuration, consistent with other unset required fields

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
  configuration cannot represent
- **WHEN** that proposal is analyzed through the proposal analyze endpoint
- **THEN** that step's `validationError` is present and non-empty, naming the offending key
- **AND** the typed decoder independently fails for the same raw configuration, demonstrating that the
  proposal analyze surface reports the offending key rather than failing opaquely

#### Scenario: The stored-pipeline analyze surface cannot report such a key
- **GIVEN** a stored `cast` step configuration using that same shape
- **WHEN** the stored pipeline is analyzed
- **THEN** no `validationError` is reported for that step on account of that key, because the configuration
  cannot be decoded for analysis at all
- **AND** the defect is instead prevented at write time by rejecting the configuration, and on read by the
  configuration failing to decode rather than yielding a degraded value

#### Scenario: An unsupported filter combinator is reported rather than silently defaulted
- **GIVEN** a pipeline containing a `filter` step whose `combinator` is `"XOR"`
- **WHEN** the pipeline is analyzed
- **THEN** that step's `validationError` names `XOR` as unsupported and lists `AND` and `OR`
- **AND** the step is not treated as though `AND` had been supplied

#### Scenario: An enum value differing only by case is accepted
- **GIVEN** a pipeline containing a `dedupe` step whose `keep` is `"LAST"`
- **WHEN** the pipeline is analyzed
- **THEN** that step's `validationError` is absent
- **AND** the step is treated as keeping the last matching row, not the first

#### Scenario: A non-representable limit count is reported rather than narrowed
- **GIVEN** a pipeline containing a `limit` step whose `count` is not representable as its numeric type
- **WHEN** the pipeline is analyzed
- **THEN** that step's `validationError` names `count` as invalid
- **AND** the step is not treated as applying no limit

#### Scenario: A missing required value is reported at analyze time
- **GIVEN** a pipeline containing a `compute` step whose `column` and `expression` are both empty
- **WHEN** the pipeline is analyzed
- **THEN** that step's `validationError` names the missing required values
- **AND** that step's `outputSchema` equals its `inputSchema`
