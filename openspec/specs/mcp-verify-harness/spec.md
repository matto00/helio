# mcp-verify-harness Specification

## Purpose
The helio-mcp end-to-end smoke harness proves a real MCP client can drive the built server against a live backend,
using the current tool input shapes, and leaves no residue behind in the database it runs against.

## Requirements

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

### Requirement: Harness proves a 30-value history read in one call

The verify harness SHALL add a metric Output with a `config.compare` to its own fixture pipeline using a payload built
by a pure builder that the drift guard also exercises. It SHALL then complete 30 real (non-dry) runs of that pipeline,
waiting out any 429 `Retry-After` before retrying, within a bounded total time. It SHALL read the Output's history
with one `get_output_history` call at `limit: 30` and fail non-zero unless that one call returns 30 points and 30
numeric sparkline values. Every fixture SHALL be removed by exact id as before, and history rows go with their Output.

#### Scenario: History payloads pass the drift guard

- **WHEN** the drift guard drives the add-metric-Output and `get_output_history` payloads through the real registered
  tools with a stub API
- **THEN** both reach their HelioApi method, so neither payload fails input-schema validation

#### Scenario: Live run shows 30 values

- **WHEN** `npm run verify` runs against a live backend
- **THEN** its output records one `get_output_history` call returning 30 values
- **AND** fewer than 30 is a non-zero exit naming the count observed

### Requirement: Isolated verify run is immune to other backends' retention purges

The helio-mcp package SHALL provide an isolated verify run that executes the existing harness against a backend
connected to a dedicated database that no other backend connects to, created fresh for that run and named uniquely.
That backend SHALL run with an Output-history purge interval and lock-retry window long enough that no pass can fall
inside the run after its startup pass, and the harness SHALL start only after that startup pass has completed. The run SHALL record the database name, every process id it starts, and the bootstrap user
and token it creates, and SHALL stop each started process by its recorded id and drop the database by its recorded
name before exiting, whether the harness passed, failed or was interrupted, reporting any removal it could not confirm and exiting
non-zero in that case.

#### Scenario: Another backend's purge cannot thin the isolated fixture

- **WHEN** an isolated verify run executes while a different backend, on a different database, runs retention passes
  every minute
- **THEN** the one `get_output_history` call returns 30 points and 30 numeric sparkline values and the run exits zero

#### Scenario: The shared-database setup is thinned by a second backend

- **WHEN** the harness runs against a backend whose database is also used by a second backend running retention
  passes every minute
- **THEN** the history read returns fewer than 30 points and the harness exits non-zero naming the count observed

#### Scenario: Isolated run leaves no database or process behind

- **WHEN** an isolated verify run exits, passed or failed
- **THEN** the dedicated database no longer exists and no process it started is still running
