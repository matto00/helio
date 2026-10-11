## MODIFIED Requirements

### Requirement: Compensating an inline REST root also removes its implicit Connector
Wherever a call deletes an inline `rest_api` source it created from a bare `url` (single-call pipeline create, add root, patch-set mid-set rollback, and pipeline-proposal apply's own failure cleanup), it SHALL also delete the implicit Connector that creation made, together with its credential row. A Connector still referenced by any other source SHALL NOT be deleted; that refusal SHALL be logged and SHALL NOT replace the original error.

#### Scenario: Single-call create fails after a bare-url REST inline root was created
- **WHEN** `POST /api/pipelines` is called with an inline bare-`url` `rest_api` root and fails after the root's source was created
- **THEN** the counts of `data_sources` and `connectors` rows owned by the caller are unchanged from before the request

#### Scenario: An explicitly-referenced Connector is never removed
- **WHEN** an inline `rest_api` root names an existing user-created (or adopted) `connectorId` and the call is compensated
- **THEN** the inline source is deleted and the named Connector still exists

#### Scenario: An explicitly-referenced unadopted auto-created Connector follows the source-delete rule
- **WHEN** an inline `rest_api` root names an existing auto-created `Auto: `-named `connectorId` that no other source references, and the call is compensated
- **THEN** the inline source is deleted and the Connector is removed exactly as a user source delete would remove it
