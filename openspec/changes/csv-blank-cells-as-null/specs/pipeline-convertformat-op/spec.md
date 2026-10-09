## MODIFIED Requirements

### Requirement: Unconvertible input fails the step with a named reason
When a value cannot be converted, the step SHALL fail the run with an error message containing a stable reason code
(`field-missing`, `field-not-string`, `csv-malformed`, `json-malformed`, `json-not-array-of-objects`,
`json-nested-value`, `json-non-string-value`, `json-inconsistent-keys`) and SHALL NOT emit rows for it. A configured
field that is present with a null value SHALL be converted exactly as the empty string would be.

#### Scenario: Malformed CSV
- **WHEN** a csv->json step receives content with an unterminated quoted field
- **THEN** the run fails with a message containing `csv-malformed`

#### Scenario: Non-array JSON
- **WHEN** a json->csv step receives `{"a":"1"}`
- **THEN** the run fails with a message containing `json-not-array-of-objects`

#### Scenario: Missing content field
- **WHEN** the configured field is absent on a row
- **THEN** the run fails with a message containing `field-missing`

#### Scenario: Null content field converts as empty
- **WHEN** the configured field is null on a row and the step is csv->json
- **THEN** the output field is `[]`, the same as for an empty string
