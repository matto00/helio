## MODIFIED Requirements

_Retargeted from DataTypes/Metrics to the outputs-model (Output, node_snapshot, pipeline-step-tree) per HEL-903 decisions 1/2/4/11. Scenario titles are preserved verbatim from the live spec even where they still name "DataType"/"Metric" (they describe the same test case); only the body text is retargeted to the new mechanism._

### Requirement: POST /api/sources/infer — preview REST API schema without persisting
The API SHALL expose `POST /api/sources/infer` that accepts a `RestApiConfigPayload` JSON body, fetches the remote endpoint, infers the schema via `SchemaInferenceEngine.fromJson`, and returns an `InferredSchemaResponse` with inferred fields. No `DataSource` or `Output/node` is written to the database. If the remote fetch fails, the API returns `502 Bad Gateway` with an error message.

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
The API SHALL expose `POST /api/data-sources/infer` that accepts a multipart form upload with a `file` field (CSV content), infers the schema via `SchemaInferenceEngine.fromCsv`, and returns an `InferredSchemaResponse`. No `DataSource` or `Output/node` is written to the database. If the file is missing or not UTF-8, the API returns `400 Bad Request`.

#### Scenario: Valid CSV returns inferred fields
- **WHEN** `POST /api/data-sources/infer` is called with a valid UTF-8 CSV file
- **THEN** the response is 200 with `{"fields": [...]}` reflecting the CSV column types

#### Scenario: Missing file returns 400
- **WHEN** `POST /api/data-sources/infer` is called with no `file` field in the multipart form
- **THEN** the response is 400 with an error message

### Requirement: Static connector uses declared column types without inference
For static data sources, the system SHALL construct `DataField` entries directly from the user-declared `columns` array (`{ name, type }`) rather than running `SchemaInferenceEngine`. The declared `type` value SHALL be mapped to the corresponding `SchemaFieldType` string. An unrecognised type string SHALL default to `"string"`.

#### Scenario: Declared integer type is preserved
- **WHEN** a static source is created with a column declared as `{ "name": "count", "type": "integer" }`
- **THEN** the registered `Output/node` contains a field `count` with `dataType = "integer"`

#### Scenario: Declared boolean type is preserved
- **WHEN** a static source is created with a column declared as `{ "name": "active", "type": "boolean" }`
- **THEN** the registered `Output/node` contains a field `active` with `dataType = "boolean"`

#### Scenario: Unrecognised type defaults to string
- **WHEN** a static source column is declared with an unrecognised type string
- **THEN** the registered field has `dataType = "string"`
