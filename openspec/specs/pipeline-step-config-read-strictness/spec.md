# pipeline-step-config-read-strictness Specification

## Purpose
Make a stored or supplied step configuration whose key is present but of the wrong JSON type fail loudly at decode
time, while keeping absent and empty keys tolerant, so a mistyped configuration can never decode into a degraded
value that runs green and produces wrong results.

## Requirements

### Requirement: A present configuration key of the wrong JSON type SHALL fail to decode
When a step configuration key is present but its JSON type cannot represent the field's declared type, decoding
that configuration SHALL fail rather than substitute a default or drop the offending value.

This SHALL apply to every step kind and every configuration key, specifically covering: a scalar key whose value
is not the expected JSON scalar type; an array-valued key whose value is not a JSON array; an array-valued key
whose element is not of the element's expected type; and an object-valued key whose value is not a JSON object.

Decoding SHALL NOT drop an individual mismatched array element while accepting its siblings. A single mismatched
element SHALL fail the whole configuration, so a partially-decoded collection can never be produced.

Failure SHALL be reported by the same mechanism the decode surface already uses for malformed JSON, so existing
callers that distinguish decode success from decode failure require no new failure channel.

#### Scenario: A non-array value for an array-valued key fails to decode
- **GIVEN** a `pivot` configuration whose `index` key holds the string `"region"` rather than an array
- **WHEN** that configuration is decoded
- **THEN** decoding fails
- **AND** no configuration value with an empty `index` is produced

#### Scenario: A mismatched array element fails the whole configuration
- **GIVEN** a `window` configuration whose `orderBy` array holds the bare string `"revenue"` rather than an
  order-key object
- **WHEN** that configuration is decoded
- **THEN** decoding fails
- **AND** no configuration value with a partially-populated `orderBy` is produced

#### Scenario: A previously-tolerated stored wrong-type configuration now fails to decode
- **GIVEN** a stored `cast` step configuration whose `casts` key holds an array rather than an object, of the
  kind that previously decoded to an empty cast map and was returned successfully when listing steps
- **WHEN** that step is read
- **THEN** decoding fails rather than yielding an empty cast map
- **AND** this narrowing of the previous read-path guarantee is deliberate, because no stored configuration of
  that shape exists in any measured environment while absent and empty keys occur routinely and stay tolerated

#### Scenario: A non-string value for a string key fails to decode
- **GIVEN** an `unpivot` configuration whose `valueVars` key holds the string `"q1"` rather than an array
- **WHEN** that configuration is decoded
- **THEN** decoding fails

### Requirement: An absent or empty configuration key SHALL remain tolerant on the read path
An absent key SHALL continue to decode to its existing default, and a present key holding an empty value of the
correct type SHALL continue to decode to that empty value. Neither SHALL fail.

This requirement exists because every read of a stored step — including listing a pipeline's steps for the editor —
decodes its stored configuration, and a decode failure there is surfaced as a server error. Steps that a user has
added but not yet configured are a legitimate, currently-occurring state in production. Making absence fail would
turn a silently-degraded run into a failure to open the editor at all, which is a worse outcome than the defect
this capability addresses.

For the `join`/`union`/`lookup` `secondaryInput` specifically: an **absent** `secondaryInput` SHALL decode to the tolerant default `{"kind": "source", "dataSourceId": ""}` — an unconfigured second input, exactly the incomplete-draft state this requirement protects — and a `source`-kind input holding an empty `dataSourceId` SHALL decode to that empty value. Neither SHALL fail. This tolerance SHALL NOT extend to a **present but invalid** shape: a legacy flat `rightDataSourceId`/`otherDataSourceId`/`referenceDataSourceId` key, an unrecognised `kind`, or a `kind` paired with the wrong field is a present-key-of-the-wrong-shape and SHALL fail to decode, per this capability's other requirement.

#### Scenario: A configuration omitting a required key still decodes
- **GIVEN** a `join` configuration that omits `joinKey` entirely
- **WHEN** that configuration is decoded
- **THEN** decoding succeeds
- **AND** `joinKey` holds its existing empty default

#### Scenario: A stored draft step still lists
- **GIVEN** a persisted `compute` step whose stored configuration has empty `column` and `expression` values
- **WHEN** the pipeline's steps are listed
- **THEN** the request succeeds and that step is returned

#### Scenario: A configuration omitting secondaryInput decodes to an unconfigured source input
- **GIVEN** a `union` configuration that omits `secondaryInput` entirely
- **WHEN** that configuration is decoded
- **THEN** decoding succeeds and `secondaryInput` is `{"kind": "source", "dataSourceId": ""}`
- **AND** listing that pipeline's steps succeeds

#### Scenario: A legacy flat field is NOT covered by this tolerance
- **GIVEN** a `union` configuration carrying `otherDataSourceId`
- **WHEN** that configuration is decoded
- **THEN** decoding fails with a named error — the key is present and its shape is invalid, which this requirement does not protect
