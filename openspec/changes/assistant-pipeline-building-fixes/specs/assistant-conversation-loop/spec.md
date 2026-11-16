## ADDED Requirements

### Requirement: Strict authoring tool schemas
The assistant's propose tool schemas SHALL enumerate the authorable step types from the step registry, give per-op
config schemas for the common ops with `additionalProperties: false`, and document the compute expression grammar with
examples; a test SHALL fail when the enum or a per-op schema's required keys drift from the registry.

#### Scenario: Registry parity
- **WHEN** a step kind is authorable in the registry
- **THEN** it appears in the propose tool's step-type enum

### Requirement: Propose-time errors name the valid options
Pipeline proposal validation SHALL reject an unknown step type listing the valid types, a step missing required config
(e.g. an empty lookup config) naming the missing keys, and an Output id used as a root with an error stating that
Outputs are not data sources and naming the Output's pipeline.

#### Scenario: Output used as a root
- **WHEN** a proposal root's sourceId is the id of an Output the caller can read
- **THEN** validation fails with an error naming it as an Output and naming its pipeline id

#### Scenario: Empty lookup config
- **WHEN** a proposal has a lookup step with `config: {}`
- **THEN** validation fails naming the missing lookup keys

### Requirement: One proposal per model response
When one model response contains more than one `propose_*` tool call, the tool loop SHALL execute only the first in
response block order and return an error result for each later one telling the model that a turn yields one proposal
carrying every edit; a `propose_*` call in a later response of the same turn SHALL execute normally.

#### Scenario: Four parallel proposals
- **WHEN** a response contains four propose_pipeline calls
- **THEN** one is executed and three return the one-proposal-per-response error

#### Scenario: Corrected proposal in the next hop
- **WHEN** a propose call fails in one response and the next response contains one corrected propose call
- **THEN** the corrected call is executed
