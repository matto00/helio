# connection-test-endpoint Specification

## Purpose
Lets a client validate a connector's config/credentials via `POST /api/sources/test` (backed by the
`Connector.testConnection` SPI) and a shared frontend "Test connection" affordance, without running
the full, expensive create-plus-fetch flow.
## Requirements
### Requirement: Connection-test endpoint dispatches to the SPI's `testConnection`
`POST /api/sources/test` SHALL accept the same discriminated `type` + `config` JSON payload shape as
`POST /api/sources`/`POST /api/sources/infer`, dispatch to `SqlConnector.testConnection` for
`type = "sql"` and `RestApiConnector.testConnection` for `type = "rest_api"`, and respond
`200 OK` with `{ "ok": true }` when the connector reports success or `{ "ok": false, "error": "<message>"
}` when it reports failure. The endpoint SHALL NOT call `fetch`, `execute`, or otherwise run the
connector's query/request beyond what `Connector.testConnection` itself performs.

#### Scenario: SQL connection test succeeds
- **WHEN** a client posts `{ "type": "sql", "config": { ...valid connection details... } }` to
  `/api/sources/test`
- **THEN** the response is `200 OK` with body `{ "ok": true }` and no query from `config.query` was
  executed against the database

#### Scenario: SQL connection test fails
- **WHEN** a client posts `{ "type": "sql", "config": { ...unreachable host or bad credentials... } }`
  to `/api/sources/test`
- **THEN** the response is `200 OK` with body `{ "ok": false, "error": "SQL connection failed" }` — the
  curated category message, not the raw JDBC/driver exception text

#### Scenario: REST connection test succeeds
- **WHEN** a client posts `{ "type": "rest_api", "config": { "url": "https://api.example.com/health",
  ... } }` to `/api/sources/test` and the target responds with any 2xx status
- **THEN** the response is `200 OK` with body `{ "ok": true }` regardless of whether the response body
  is valid JSON

#### Scenario: REST connection test fails on non-2xx status
- **WHEN** a client posts a REST config whose target responds with a non-2xx status
- **THEN** the response is `200 OK` with body `{ "ok": false, "error": "<curated message>" }`

### Requirement: Malformed connection-test requests are rejected before dispatch
A connection-test request that fails structural validation SHALL be rejected with `400 Bad Request`
and never reach `Connector.testConnection` — matching the existing `/api/sources` and
`/api/sources/infer` pre-check behavior for the same failure modes.

#### Scenario: SQL query contains DDL/DML
- **WHEN** a client posts `{ "type": "sql", "config": { ..., "query": "DROP TABLE users" } }` to
  `/api/sources/test`
- **THEN** the response is `400 Bad Request` and `SqlConnector.testConnection` is never invoked

#### Scenario: REST auth payload is structurally invalid
- **WHEN** a client posts a REST config whose `auth` object fails to convert to a domain auth type
  (e.g. `type: "bearer"` with no `token`)
- **THEN** the response is `400 Bad Request` and `RestApiConnector.testConnection` is never invoked

### Requirement: Connection-test responses never carry connector credentials
The connection-test response body SHALL contain no field carrying the request's connector config,
credentials, or any value sourced from `config` other than the curated `error` message string.

#### Scenario: Response contains no config echo
- **WHEN** a client posts a connection-test request for either `sql` or `rest_api` (success or
  failure)
- **THEN** the response JSON has no `config`, `password`, `token`, `auth`, or any other field carrying
  a value derived from the request's `config` object beyond the `error` string itself

### Requirement: Shared frontend connection-test affordance
The frontend SHALL provide one connection-test UI component, used by every source form that has a
`Connector[Config]`-backed connection to test (SQL, REST API today), rather than a per-form
implementation. The component SHALL render a distinct visual state for each of: idle, pending
(request in flight), success, and error.

#### Scenario: Pending state disables re-trigger
- **WHEN** a user clicks "Test connection" and the request is in flight
- **THEN** the button is disabled and shows a pending label (e.g. "Testing…")

#### Scenario: Success state is visually distinct from idle
- **WHEN** the connection-test request resolves with `ok: true`
- **THEN** the component renders a success indicator that is not merely the absence of an error (a
  positive affirmation the connection succeeded)

#### Scenario: Error state renders via the canonical error component
- **WHEN** the connection-test request resolves with `ok: false` (or the HTTP request itself fails)
- **THEN** the component renders the curated error message using the shared `InlineError` component,
  not a bespoke error paragraph

#### Scenario: Absent `error` field on success does not break rendering
- **WHEN** the backend response omits the `error` JSON key entirely (spray-json's `Option = None`
  wire behavior) on an `ok: true` response
- **THEN** the frontend service layer normalizes the missing field to `null` and the component renders
  its success state with no error text — never `undefined`, `"undefined"`, or a rendering error

#### Scenario: Adding the affordance does not remove an existing schema-discovery control
- **WHEN** a source form already has a schema-inference/preview trigger whose result gates a
  downstream action (e.g. `SqlTab`'s inferred-fields preview gating "Create source")
- **THEN** the connection-test affordance is added alongside that trigger as a distinct control,
  and the existing trigger's behavior, label distinction, and gating are preserved unchanged

