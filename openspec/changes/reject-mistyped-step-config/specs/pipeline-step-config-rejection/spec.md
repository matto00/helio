# pipeline-step-config-rejection Specification

## ADDED Requirements

### Requirement: A supplied step configuration that cannot be understood is rejected, never stored as a no-op
When a caller supplies a step configuration whose shape the step's typed configuration cannot represent,
the step-create and step-update surfaces SHALL reject the request with **422 Unprocessable Entity** and
SHALL NOT create or modify any step. The rejection message SHALL name the offending configuration key and
SHALL describe the expected shape for that key.

A configuration key that the caller supplied and the system could not understand SHALL be treated as an
error, never as an empty default. Rejection SHALL be decided from the raw supplied configuration, so a key
whose value the step's tolerant persistence decoder would silently reduce to an empty default is still
rejected.

This requirement applies to the `cast` step's `casts` key and the `rename` step's `renames` key, each of
which SHALL be an object mapping string field names to string values.

Absence of the key SHALL NOT be rejected: an omitted `casts` / `renames` retains its existing empty
default, so partial drafts and previously-stored rows remain valid. Rejection SHALL apply only to a key
that is present but cannot be represented.

The read path SHALL be unchanged: decoding an already-stored configuration SHALL remain tolerant, so rows
persisted before this requirement continue to decode exactly as before with no migration.

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
