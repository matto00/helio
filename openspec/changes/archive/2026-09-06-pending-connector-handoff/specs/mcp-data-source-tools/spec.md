# mcp-data-source-tools Specification

## ADDED Requirements

### Requirement: The agent surface initiates a credentialed Connector instead of refusing

The MCP `create_connector` tool SHALL, for a target host requiring authentication, create a pending
Connector and return that Connector's identifier together with a completion URL a human can open
out-of-band. It SHALL NOT refuse the request merely because the host requires a credential.

#### Scenario: A credentialed host yields a pending Connector and a completion URL
- **WHEN** an agent calls `create_connector` naming an auth type other than `none`
- **THEN** a pending Connector is created
- **AND** the result carries its `connectorId` and a completion URL
- **AND** the result states that a human must complete it before it can be used

#### Scenario: The unauthenticated path is unchanged
- **WHEN** an agent calls `create_connector` with auth type `none`
- **THEN** a Connector usable immediately is created, as before

#### Scenario: The agent observes completion by the source-creation call succeeding
- **WHEN** an agent attempts to create a REST source against a still-pending Connector
- **THEN** the call fails with a message identifying the Connector as awaiting completion
- **AND** the same call succeeds once the credential has been bound

### Requirement: The agent surface still accepts no credential value

The MCP tool surface SHALL continue to reject any credential value under any key. Introducing the pending
handoff SHALL NOT add a parameter that accepts a secret, and the existing strict-schema and denylist
protections SHALL remain in force on every connector-related tool.

#### Scenario: A credential-shaped key is rejected
- **WHEN** an agent calls a connector tool with a key naming a credential, token, password or secret
- **THEN** the call is rejected before any backend request is made
- **AND** no Connector is created or modified

#### Scenario: Unknown keys are rejected by strict schemas
- **WHEN** an agent calls a connector tool with any key the schema does not declare
- **THEN** the call is rejected

#### Scenario: The completion URL is not a credential channel
- **WHEN** an agent receives a completion URL
- **THEN** no tool accepts a credential value for that URL
- **AND** the credential reaches the backend only through the human-facing completion page
