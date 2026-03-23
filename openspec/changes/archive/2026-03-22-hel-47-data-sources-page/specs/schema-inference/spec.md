## ADDED Requirements

### Requirement: POST /api/sources/infer — preview REST API schema without persisting
The API SHALL expose `POST /api/sources/infer` that accepts a `RestApiConfigPayload` JSON body, fetches the remote endpoint, infers the schema via `SchemaInferenceEngine.fromJson`, and returns an `InferredSchemaResponse` with inferred fields. No `DataSource` or `DataType` is written to the database. If the remote fetch fails, the API returns `502 Bad Gateway` with an error message.

#### Scenario: Successful REST infer returns fields
- **WHEN** `POST /api/sources/infer` is called with a valid REST config pointing to a live endpoint
- **THEN** the response is 200 with `{"fields": [...]}` where each field has `name`, `displayName`, `dataType`, `nullable`

#### Scenario: Connector failure returns 502
- **WHEN** the REST API connector cannot reach the target URL
- **THEN** the response is 502 with `{"error": "Fetch failed: ..."}`

#### Scenario: Invalid config returns 400
- **WHEN** `POST /api/sources/infer` is called with a malformed config (e.g. missing `url`)
- **THEN** the response is 400 with an error message

### Requirement: POST /api/data-sources/infer — preview CSV schema without persisting
The API SHALL expose `POST /api/data-sources/infer` that accepts a multipart form upload with a `file` field (CSV content), infers the schema via `SchemaInferenceEngine.fromCsv`, and returns an `InferredSchemaResponse`. No `DataSource` or `DataType` is written to the database. If the file is missing or not UTF-8, the API returns `400 Bad Request`.

#### Scenario: Valid CSV returns inferred fields
- **WHEN** `POST /api/data-sources/infer` is called with a valid UTF-8 CSV file
- **THEN** the response is 200 with `{"fields": [...]}` reflecting the CSV column types

#### Scenario: Missing file returns 400
- **WHEN** `POST /api/data-sources/infer` is called with no `file` field in the multipart form
- **THEN** the response is 400 with an error message

### Requirement: InferredSchemaResponse wire format
`POST /api/sources/infer` and `POST /api/data-sources/infer` SHALL both return the same response envelope: `{ "fields": [{ "name": string, "displayName": string, "dataType": string, "nullable": boolean }] }`.
