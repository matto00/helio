# connectors/pending-connector-handoff Specification

## Purpose
Defines the pending Connector: a credential-less row an agent can create for a credentialed host, the
chokepoints that must refuse it until a credential is bound, and what it may disclose while pending.. Update Purpose after archive.

## Requirements

### Requirement: A Connector may exist in a pending, credential-less state

The system SHALL support a Connector that exists and is owner-scoped but has no credential bound. Such a
Connector is *pending*. The pending state SHALL be represented by the absence of a bound credential rather
than by an independent status field that could disagree with credential presence, so that a Connector cannot
be simultaneously recorded as complete and hold no credential.

#### Scenario: A pending Connector persists its non-secret identity
- **WHEN** a pending Connector is created
- **THEN** its name, kind, base URL and intended auth shape are persisted
- **AND** no credential row is bound to it
- **AND** it is scoped to the initiating owner under the same ownership model as any other Connector

#### Scenario: Pending-ness is derived, not independently stored
- **WHEN** the system determines whether a Connector is pending
- **THEN** the determination is made from the absence of its bound credential
- **AND** no separate stored status can report the Connector as complete while no credential is bound

### Requirement: A pending Connector cannot be used to author a data source

The system SHALL refuse to create a data source that references a pending Connector, with a 400-class error
that names the Connector as awaiting credential completion. This check SHALL be applied independently of the
existing Connector-kind check, so that neither check's removal silently disables the other.

#### Scenario: REST source creation against a pending Connector is refused
- **WHEN** a caller creates a REST data source whose `connectorId` names a pending Connector
- **THEN** the request is refused with a 400-class error stating the Connector is awaiting completion
- **AND** no data source row is created

#### Scenario: The pending check is independent of the kind check
- **WHEN** a pending Connector's kind matches the requested source kind
- **THEN** the request is still refused for pendingness

#### Scenario: A completed Connector is accepted
- **WHEN** the same Connector has since had a credential bound
- **THEN** an otherwise-identical source-creation request succeeds

### Requirement: A pending Connector cannot be used for an outbound fetch

The system SHALL refuse to perform an outbound fetch on behalf of a pending Connector. The refusal SHALL
occur before any request URI is composed and before any credential decryption is attempted, so that a
pending Connector can never contribute to a network call.

#### Scenario: Fetch-time resolution rejects a pending Connector
- **WHEN** a driver resolves a Connector that has no bound credential
- **THEN** resolution fails with an error identifying the Connector as incomplete
- **AND** no outbound request is issued

#### Scenario: No decryption is attempted for a pending Connector
- **WHEN** fetch-time resolution rejects a pending Connector
- **THEN** the credential decryption path is not invoked, observably, for that request

### Requirement: A pending Connector does not disclose configuration in progress

A pending Connector's readable representation SHALL be limited to its own non-secret identity and its
pending status. It SHALL NOT expose any credential value, any partially-entered credential material, or any
field describing what a human is in the middle of supplying.

#### Scenario: Reading a pending Connector reveals no credential material
- **WHEN** a pending Connector is read through any client-facing path, including the agent surface
- **THEN** the response carries its identity and pending status
- **AND** the response carries no credential value and no partially-entered credential material
