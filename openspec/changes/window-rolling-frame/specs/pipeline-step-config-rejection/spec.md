## MODIFIED Requirements

### Requirement: Clearly invalid fillnull, window and pivot enum values are rejected on every write surface

Every surface that already applies the step-configuration rejection of this capability (step create, step update,
pipeline proposal validate/apply, patch-set step-create, step-update and pipeline-create edits on apply and preview, single-call
pipeline create) SHALL reject, with that surface's existing step-configuration rejection status (422 on the REST step
and pipeline routes):

- a `fillnull` configuration whose `strategy` is a non-empty value outside the supported strategies;
- a `window` configuration whose `function` is a non-empty value outside the supported functions;
- a `window` configuration whose `function` is `lag` or `lead` and whose `offset` is present and not positive;
- a `window` configuration whose `function` is a `rolling_*` function and whose `frameSize` is present and not an
  integer in 1..1000 (including a fractional value or one not representable as a 32-bit integer), whose `frameUnit` is
  present and not `rows`/`days`, or whose `frameUnit` is `days` with an `orderBy` that is non-empty and not exactly one
  ascending key;
- a `pivot` configuration whose `agg` is a non-empty value outside the supported aggregations.

The rejection message SHALL be the same message analyze and the run path report for that problem, naming the invalid
value and listing the supported values. Each such problem SHALL be reported by analyze exactly once.

An incomplete draft SHALL remain accepted: an absent or empty `strategy`, `function` or `agg`; a `constant` fillnull
with no `value`; a `running_sum`, `lag`, `lead` or `rolling_*` window with no `field`; a `lag`/`lead` window with no `offset`; a
`rolling_*` window with no `frameSize` or an empty `orderBy`; an `offset` on a function other than `lag`/`lead`; and a
`frameSize`/`frameUnit` on a function other than `rolling_*`. Such drafts keep being reported by analyze and refused at run as
before.

This requirement SHALL NOT introduce read-path validation: a stored step whose configuration would now be rejected
SHALL still load, still be analyzed (reporting the problem), and still fail at run with the existing error.

#### Scenario: Unknown fillnull strategy is rejected at step create
- **GIVEN** a pipeline owned by the caller
- **WHEN** the caller creates a `fillnull` step with config `{"columns":["a"],"strategy":"average"}`
- **THEN** the response status is 422
- **AND** the message names `average` and lists the supported strategies
- **AND** no step is created

#### Scenario: Unknown window function is rejected at step update
- **GIVEN** an existing `window` step owned by the caller
- **WHEN** the caller updates it with `function` `"ntile"`
- **THEN** the response status is 422
- **AND** the message names `ntile` and lists the supported functions
- **AND** the stored configuration is unchanged

#### Scenario: Non-positive lag offset is rejected
- **GIVEN** a pipeline owned by the caller
- **WHEN** the caller creates a `window` step with `function` `"lag"`, a `field`, and `offset` `0`
- **THEN** the response status is 422
- **AND** the message states that `lag` requires a positive `offset`

#### Scenario: Unknown pivot agg is rejected at single-call create
- **GIVEN** a data source owned by the caller
- **WHEN** the caller creates a pipeline in one request with a `pivot` step whose `agg` is `"median"`
- **THEN** the response status is 422
- **AND** no pipeline is created

#### Scenario: Invalid enum values are rejected on proposal and patch-set surfaces
- **WHEN** a pipeline proposal, or a patch set's step-update or pipeline-create edit, carries a `fillnull`, `window` or
  `pivot` step configuration with one of the invalid values above
- **THEN** it is rejected with that surface's existing step-configuration rejection
- **AND** nothing from it is persisted

#### Scenario: Incomplete drafts are still accepted
- **WHEN** the caller creates a `fillnull` step `{"columns":[],"strategy":"constant"}` with no `value`, a `window` step
  `{"function":"lag","outputColumn":"prev"}` with no `field`, or a `pivot` step with no `agg`
- **THEN** each step is created
- **AND** analyze reports the incompleteness

#### Scenario: Offset on a non-lag/lead function is not rejected
- **WHEN** the caller creates a `window` step with `function` `"row_number"` and `offset` `0`
- **THEN** the step is created

#### Scenario: A legacy stored invalid config still reads and analyzes
- **GIVEN** a stored `fillnull` step whose `strategy` is `"average"`, written before this rejection existed
- **WHEN** the pipeline's steps are listed and the pipeline is analyzed
- **THEN** the step is returned
- **AND** analyze reports the unsupported strategy once rather than failing the request

#### Scenario: The step editors surface a rejected save
- **WHEN** a save of a `fillnull`, `window` or `pivot` step's configuration is rejected by the server
- **THEN** the step editor shows the server's rejection message

#### Scenario: Unrepresentable or out-of-range rolling frameSize is rejected, never stored as a draft
- **GIVEN** a pipeline owned by the caller
- **WHEN** the caller creates a `window` step with `function` `"rolling_avg"`, a `field`, an `orderBy`, and `frameSize`
  `0`, `1001`, `7.5` or `5000000000`
- **THEN** the response status is 422
- **AND** no step is created (the value is never silently dropped and stored as a draft without `frameSize`)
