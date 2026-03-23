## ADDED Requirements

### Requirement: Create a REST/HTTP data source
The backend SHALL expose `POST /api/sources` accepting a JSON body with `name`, `sourceType: "rest_api"`, and a `config` object containing `url`, optional `method` (default `GET`), optional `auth`, and optional `headers`. On success it SHALL insert the DataSource, attempt an initial fetch+inference, and if inference succeeds, insert a DataType linked to the source. The response SHALL include `fetchError` if the initial fetch failed.

#### Scenario: Successful creation with schema registration
- **WHEN** `POST /api/sources` is called with a valid config and the URL returns a 2xx JSON response
- **THEN** the response is 201 with the created DataSource (no credentials) and a linked DataType in the registry

#### Scenario: Creation succeeds even when fetch fails
- **WHEN** `POST /api/sources` is called but the remote URL returns a 4xx/5xx or is unreachable
- **THEN** the response is 201 with the DataSource and a non-null `fetchError` field; no DataType is registered

#### Scenario: Missing required fields returns 400
- **WHEN** `POST /api/sources` is called without a `url` in config
- **THEN** the response is 400 with a descriptive error

### Requirement: Refresh a REST/HTTP data source
The backend SHALL expose `POST /api/sources/:id/refresh` which re-fetches the configured URL, re-runs schema inference, and overwrites the linked DataType's fields (incrementing its version). If no DataType exists yet (e.g. initial fetch failed), a new one SHALL be created.

#### Scenario: Successful refresh updates DataType fields
- **WHEN** `POST /api/sources/:id/refresh` is called and the URL returns a 2xx JSON response
- **THEN** the response is 200 with the updated DataType; version is incremented by 1

#### Scenario: Refresh on non-existent source returns 404
- **WHEN** `POST /api/sources/:id/refresh` is called with an unknown id
- **THEN** the response is 404

#### Scenario: Refresh fetch failure returns 502
- **WHEN** `POST /api/sources/:id/refresh` is called but the remote URL fails
- **THEN** the response is 502 with a descriptive error; existing DataType is unchanged

### Requirement: Preview a REST/HTTP data source
The backend SHALL expose `GET /api/sources/:id/preview` which fetches the configured URL, parses the JSON response, and returns the first 10 rows as a JSON array. No DataSource or DataType records are created or modified.

#### Scenario: Preview returns up to 10 rows
- **WHEN** `GET /api/sources/:id/preview` is called and the URL returns a JSON array with more than 10 elements
- **THEN** the response is 200 with a `rows` array containing exactly 10 elements

#### Scenario: Single-object response is wrapped in array
- **WHEN** `GET /api/sources/:id/preview` is called and the URL returns a JSON object (not array)
- **THEN** the response is 200 with a `rows` array containing that single object

#### Scenario: Preview on non-existent source returns 404
- **WHEN** `GET /api/sources/:id/preview` is called with an unknown id
- **THEN** the response is 404

### Requirement: Auth injection
The `RestApiConnector` SHALL inject authentication into outgoing requests based on the `auth` field in the config. Supported types: `none` (no auth), `bearer` (adds `Authorization: Bearer <token>` header), `api_key` (adds a custom header or query parameter by `name` and `value`, placement controlled by `in: "header"|"query"`).

#### Scenario: Bearer token injected as Authorization header
- **WHEN** the config includes `auth: { type: "bearer", token: "abc" }`
- **THEN** the outgoing HTTP request includes `Authorization: Bearer abc`

#### Scenario: API key injected as header
- **WHEN** the config includes `auth: { type: "api_key", name: "X-Api-Key", value: "secret", in: "header" }`
- **THEN** the outgoing HTTP request includes `X-Api-Key: secret` header

#### Scenario: API key injected as query param
- **WHEN** the config includes `auth: { type: "api_key", name: "key", value: "secret", in: "query" }`
- **THEN** the outgoing HTTP request URL includes `?key=secret`

### Requirement: Credentials are never returned in API responses
The `DataSource` response object SHALL never include the `config` field (which may contain tokens or keys). Only `id`, `name`, `sourceType`, `createdAt`, and `updatedAt` are returned.

#### Scenario: Create response omits config
- **WHEN** `POST /api/sources` succeeds
- **THEN** the response body does not contain any `config`, `token`, `key`, or `auth` fields
