# pipeline-step-config-rejection Specification

## Purpose
Reject a step configuration the caller supplied but the system cannot represent, with a 422 naming the offending key and the expected shape, so a misunderstood config can never be stored as a silent no-op that runs green while doing nothing.

## Requirements

### Requirement: A supplied step configuration that cannot be understood is rejected, never stored as a no-op
A supplied `join`, `union` or `lookup` configuration carrying a legacy flat secondary-source field (`rightDataSourceId`, `otherDataSourceId` or `referenceDataSourceId`) SHALL be rejected with a hard, named error identifying the invalid shape. It SHALL NOT be coerced into a `source`-kind `secondaryInput`, SHALL NOT be defaulted, and SHALL NOT be stored as a no-op. No read path SHALL remain that understands the legacy shape. An unrecognised `secondaryInput.kind`, or a `kind` paired with the wrong field, SHALL be rejected the same way.

This SHALL NOT be confused with an unset second input: `{"kind": "source", "dataSourceId": ""}` is a well-formed incomplete draft and SHALL be accepted. What is rejected is the legacy *field*, never an unset id inside the discriminated shape.

#### Scenario: Legacy union config is rejected
- **WHEN** a config `{"otherDataSourceId": "abc", "mode": "byPosition"}` is supplied
- **THEN** it is rejected with a named error identifying the invalid shape and is not stored

#### Scenario: Legacy join config is rejected
- **WHEN** a config carrying `rightDataSourceId` is supplied
- **THEN** it is rejected with a named error and is not stored

#### Scenario: Legacy lookup config is rejected
- **WHEN** a config carrying `referenceDataSourceId` is supplied
- **THEN** it is rejected with a named error and is not stored

#### Scenario: An empty dataSourceId in the new shape is NOT rejected
- **WHEN** a config `{"secondaryInput": {"kind": "source", "dataSourceId": ""}, "mode": "byPosition"}` is supplied
- **THEN** it is accepted and stored as a legal incomplete draft

#### Scenario: An unrecognised kind is rejected
- **WHEN** a config carrying `{"secondaryInput": {"kind": "other", "stepId": "x"}}` is supplied
- **THEN** it is rejected with a named error identifying the invalid `kind`

#### Scenario: A list-shaped cast config is rejected with 422
- **GIVEN** a pipeline owned by the caller
- **WHEN** the caller creates a `cast` step with config `{"casts":[{"field":"stats.adp_ppr","to":"float"}]}`
- **THEN** the response status is 422
- **AND** the message names `casts` and describes the expected object-of-string-to-string shape
- **AND** no step is created on that pipeline

#### Scenario: A cast config whose map values are not strings is rejected with 422
- **GIVEN** a pipeline owned by the caller
- **WHEN** the caller creates a `cast` step with config `{"casts":{"amount":123}}`
- **THEN** the response status is 422
- **AND** the message names `casts` and describes the expected object-of-string-to-string shape
- **AND** no step is created on that pipeline

#### Scenario: A list-shaped rename config is rejected with 422
- **GIVEN** a pipeline owned by the caller
- **WHEN** the caller creates a `rename` step with config `{"renames":[{"from":"a","to":"b"}]}`
- **THEN** the response status is 422
- **AND** the message names `renames` and describes the expected object-of-string-to-string shape
- **AND** no step is created on that pipeline

#### Scenario: A correctly-shaped cast config still succeeds
- **GIVEN** a pipeline owned by the caller
- **WHEN** the caller creates a `cast` step with config `{"casts":{"stats.adp_ppr":"double"}}`
- **THEN** the step is created successfully
- **AND** the stored configuration retains the supplied mapping rather than an empty map

#### Scenario: An omitted key is not rejected
- **GIVEN** a pipeline owned by the caller
- **WHEN** the caller creates a `cast` step with config `{}`
- **THEN** the step is created successfully with an empty cast map

#### Scenario: Updating a step with an unintelligible config is rejected
- **GIVEN** an existing `cast` step with a correctly-shaped configuration
- **WHEN** the caller updates that step with config `{"casts":["amount"]}`
- **THEN** the response status is 422
- **AND** the step's stored configuration is unchanged

#### Scenario: A wrong-shape config is rejected on a step kind other than cast or rename
- **GIVEN** a pipeline owned by the caller
- **WHEN** the caller creates a `pivot` step whose `index` holds the string `"region"` rather than an array
- **THEN** the response status is 422
- **AND** the message names `index` and describes the expected array-of-strings shape
- **AND** no step is created on that pipeline

#### Scenario: The change-preview surface rejects a wrong-shape config
- **GIVEN** an existing `pivot` step owned by the caller
- **WHEN** a change previewing an update to that step supplies an `index` holding a string rather than an array
- **THEN** the preview is rejected rather than reported as a valid change
- **AND** the rejection names the offending key

#### Scenario: The proposal-apply surface rejects a wrong-shape config
- **GIVEN** a pipeline proposal containing a `window` step whose `partitionBy` holds a string rather than an array
- **WHEN** that proposal is applied
- **THEN** the request is rejected
- **AND** the rejection names the offending step and key
- **AND** no pipeline is created

#### Scenario: A draft with an empty required value is still accepted on write
- **GIVEN** a pipeline owned by the caller
- **WHEN** the caller creates a `compute` step with config `{"column":"","expression":""}`
- **THEN** the step is created successfully
- **AND** the incompleteness is instead reported when the pipeline is analyzed or run

### Requirement: A `compute` expression that cannot be parsed is rejected on the write path

A `compute` step configuration whose `expression` is non-empty but cannot be parsed under either the
strict `$`-prefixed grammar or the frozen legacy bare-identifier grammar SHALL be rejected with a 422
whose message carries the parser's own description of the problem, not a generic one. The rejection
SHALL apply at every write surface that validates step configuration — step create, step update,
pipeline-proposal apply, and patch-set apply — via the step kind's `validateRawConfig`, so no write
surface can accept what another rejects.

The predicate SHALL be parseability under the same grammar the run path uses to evaluate the
expression, so that exactly those expressions which could never produce a value for any row are
rejected. An expression that fails the strict grammar but parses under the legacy grammar SHALL be
accepted, because it still evaluates correctly at run time and existing pipelines depend on it.

An `expression` that is missing, empty, or whitespace-only SHALL NOT be rejected on the write path. An
unconfigured draft must remain saveable so a compute step can be added and configured later; that case
is governed by `pipeline-step-config-runtime-completeness` instead.

Expression validation SHALL NOT be performed on the read path. Loading a stored step whose expression
is unparseable SHALL return the step, because a read-path failure surfaces as an error backing every
read and would make the pipeline editor unopenable for exactly the steps a user needs to open to
repair them.

#### Scenario: Unparseable expression is rejected at step create
- **WHEN** a `compute` step is created with `{"column":"value_vs_adp","expression":"stats.adp_ppr - stats.pts_ppr"}`
- **THEN** the request is rejected with 422 and the message contains the parser's description of the problem

#### Scenario: Unparseable expression is rejected at step update
- **WHEN** an existing valid `compute` step is updated to an expression that parses under neither grammar
- **THEN** the request is rejected with 422 and the stored configuration is unchanged

#### Scenario: Empty expression remains saveable
- **WHEN** a `compute` step is created with `{"column":"","expression":""}`
- **THEN** the request succeeds and the step is stored

#### Scenario: A legacy bare-identifier expression remains acceptable
- **WHEN** a `compute` step is created with an expression that fails the strict grammar but parses under
  the legacy bare-identifier grammar
- **THEN** the request succeeds, because the expression still evaluates at run time

#### Scenario: A stored unparseable step still loads
- **WHEN** a `compute` step whose stored expression is unparseable is read back
- **THEN** the read succeeds and returns the step

### Requirement: Single-call pipeline create applies the same step-configuration rejection as every other write surface

Creating a pipeline together with its steps in one request SHALL reject any supplied step whose configuration the
step create/update surfaces would reject, for every step kind, with the same 422 status and a message that names the
offending step (by its client id) and carries the same rejection message those surfaces return. The whole request
SHALL fail atomically: no pipeline, root, step or Output from that request SHALL be persisted.

A pipeline proposal apply carrying such a step SHALL likewise fail with 422 and persist nothing. A patch-set
pipeline-create edit carrying such a step SHALL be rejected with a 422 response, naming the edit and the step, before
any edit in the patch set is applied, and previewing such a patch set SHALL be rejected the same way. A configuration that is not parseable at all keeps its existing 400 response. Server-generated
steps (first-run planning, shape templates) SHALL continue to be created successfully.

This requirement SHALL NOT introduce read-path or analyze-path validation: a stored step whose configuration would now
be rejected on write SHALL still load and still be analyzed exactly as before.

#### Scenario: Compute step calling an unknown function is rejected at single-call create
- **GIVEN** a data source owned by the caller
- **WHEN** the caller creates a pipeline in one request whose `compute` step has expression `$a + nosuchfn($b)`
- **THEN** the response status is 422
- **AND** the message names the step's client id, the unrecognised function `nosuchfn`, and the supported functions
- **AND** no pipeline is created

#### Scenario: A wrong-shape config of a non-compute kind is rejected at single-call create
- **GIVEN** a data source owned by the caller
- **WHEN** the caller creates a pipeline in one request with a `cast` step whose `casts` is an array
- **THEN** the response status is 422
- **AND** the message names `casts`
- **AND** no pipeline is created

#### Scenario: An invalid aggregation is rejected at single-call create
- **GIVEN** a data source owned by the caller
- **WHEN** the caller creates a pipeline in one request with an `aggregate` step using an unsupported `fn`
- **THEN** the response status is 422
- **AND** no pipeline is created

#### Scenario: A valid multi-step create still succeeds
- **WHEN** the caller creates a pipeline in one request with filter, aggregate (object-form `groupBy`), sort and select
  steps in their documented shapes
- **THEN** the pipeline and its steps are created

#### Scenario: An empty compute draft is still accepted at single-call create
- **WHEN** the caller creates a pipeline in one request with a `compute` step whose `column` and `expression` are empty
- **THEN** the pipeline is created
- **AND** the incompleteness is reported by analyze, not by the write

#### Scenario: A patch-set pipeline-create edit with an invalid step config is rejected
- **WHEN** a patch set containing a pipeline-create edit whose `compute` step calls an unknown function is applied
- **THEN** the apply response status is 422 and the message names the edit and the step
- **AND** no pipeline is created
- **AND** no other edit in that patch set is applied

#### Scenario: A legacy stored invalid step still reads and analyzes
- **GIVEN** a stored `compute` step whose expression calls an unknown function, written before this rejection existed
- **WHEN** the pipeline's steps are listed and the pipeline is analyzed
- **THEN** the step is returned
- **AND** analyze reports it as a step configuration problem rather than failing the request
