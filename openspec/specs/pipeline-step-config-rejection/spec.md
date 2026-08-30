# pipeline-step-config-rejection Specification

## Purpose
Reject a step configuration the caller supplied but the system cannot represent, with a 422 naming the offending key and the expected shape, so a misunderstood config can never be stored as a silent no-op that runs green while doing nothing.

## Requirements

### Requirement: A supplied step configuration that cannot be understood is rejected, never stored as a no-op
When a caller supplies a step configuration whose shape the step's typed configuration cannot represent,
the step-create and step-update surfaces SHALL reject the request with **422 Unprocessable Entity** and
SHALL NOT create or modify any step. The rejection message SHALL name the offending configuration key and
SHALL describe the expected shape for that key.

A configuration key that the caller supplied and the system could not understand SHALL be treated as an
error, never as an empty default. Rejection SHALL be decided from the raw supplied configuration, so a key
whose value the step's tolerant persistence decoder would silently reduce to an empty default is still
rejected.

This requirement SHALL apply to **every** step kind and every configuration key that kind declares, not only
to the `cast` step's `casts` key and the `rename` step's `renames` key. Each step kind SHALL declare the
expected shape of each of its keys, and a supplied value whose JSON type cannot represent the declared shape
SHALL be rejected, naming that key and its expected shape.

Rejection SHALL be applied by every surface that accepts a caller-supplied step configuration, not only the
step-create and step-update surfaces. This SHALL include the change-preview and change-apply surfaces and the
proposal-apply surface, so a wrong-shape configuration cannot enter through a surface that merely checked
whether the configuration decoded.

Absence of a key SHALL NOT be rejected: an omitted key retains its existing default, so partial drafts and
previously-stored rows remain valid. A key present but holding an empty value of the correct type SHALL NOT be
rejected either. Rejection SHALL apply only to a key that is present but whose JSON type cannot represent the
declared shape. Completeness of a draft is instead enforced when the pipeline is run or analyzed.

The read path SHALL remain tolerant for absent and empty keys: decoding an already-stored configuration that
omits a key, or holds an empty value, SHALL continue to succeed, so rows persisted before this requirement
continue to decode with no migration.

The read path SHALL NOT remain tolerant for a stored key that is present but whose JSON type cannot represent
the declared shape. Such a stored configuration SHALL fail to decode rather than yield a degraded value. This
narrows an earlier guarantee that the read path was unchanged for all stored configurations, and it is
deliberate: a degraded value read from storage is indistinguishable from a correct one downstream, which is the
defect being closed. It is safe to narrow because no stored configuration of that shape exists in any measured
environment, whereas absent and empty keys occur routinely and remain tolerated.

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
