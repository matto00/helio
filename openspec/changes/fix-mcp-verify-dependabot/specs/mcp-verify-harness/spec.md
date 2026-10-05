## Purpose

The helio-mcp end-to-end smoke harness proves a real MCP client can drive the built server against a live backend,
using the current tool input shapes, and leaves no residue behind in the database it runs against.

## ADDED Requirements

### Requirement: Harness payloads match the current tool input schemas

Every write-tool call the harness makes SHALL use a payload accepted by that tool's current input schema, and a
mechanical check SHALL fail when any such payload is rejected by the registered tool's input schema.

#### Scenario: Current-shape run passes

- **WHEN** the harness runs against a healthy backend with a valid bootstrap credential
- **THEN** every step, including pipeline creation with a `roots` array, succeeds and the run exits zero

#### Scenario: A drifted payload is caught without a backend

- **WHEN** a harness payload no longer satisfies its tool's input schema (e.g. `create_pipeline` sent `source`
  instead of `roots`)
- **THEN** the automated drift check fails and names the schema violation

#### Scenario: A new write call without a checked payload is caught

- **WHEN** the harness calls a write tool whose payload is not covered by the drift check
- **THEN** the drift check fails

### Requirement: Harness cleans up everything it creates, by exact id

The harness SHALL record the id of every resource it creates, including any access token it mints, and SHALL delete
or revoke each by that exact id before exiting, whether the run passed or failed, confirming each removal.

#### Scenario: Clean run leaves no residue

- **WHEN** the harness completes
- **THEN** every pipeline and data source it created returns not-found, and the access token it minted is revoked
  and no longer authenticates

#### Scenario: Teardown failure fails the run

- **WHEN** any recorded resource cannot be removed
- **THEN** the harness reports the exact id and exits non-zero
