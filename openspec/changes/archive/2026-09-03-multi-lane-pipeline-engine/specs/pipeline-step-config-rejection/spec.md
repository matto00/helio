## MODIFIED Requirements

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
