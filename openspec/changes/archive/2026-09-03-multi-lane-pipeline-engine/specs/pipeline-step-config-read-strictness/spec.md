## MODIFIED Requirements

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
