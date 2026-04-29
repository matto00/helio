# static-data-connector Specification

## Purpose
Manual data entry connector that stores tabular column/row data directly in the DataSource config JSONB. Supports create, refresh (replace rows), and preview without any external connection.
## Requirements
### Requirement: POST /api/data-sources accepts static source payload
The backend SHALL accept `POST /api/data-sources` with `Content-Type: application/json` when `source_type` is `"static"`. The body SHALL be `{ "name": string, "source_type": "static", "columns": [{ "name": string, "type": string }], "rows": [[...]] }`. The handler SHALL store the columns and rows in the `data_sources.config` JSONB column and register a `DataType` using the declared column types.

#### Scenario: Valid static source is created
- **WHEN** `POST /api/data-sources` is called with a valid static payload containing 2 columns and 3 rows
- **THEN** the response is 201 with a `DataSource` object whose `sourceType` is `"static"`

#### Scenario: Static DataType is registered on creation
- **WHEN** a static source is created with columns `[{ name: "id", type: "integer" }, { name: "label", type: "string" }]`
- **THEN** a `DataType` is created linked to the source with `fields` matching the declared column names and types

#### Scenario: Row count exceeding 500 is rejected
- **WHEN** `POST /api/data-sources` is called with a static payload containing 501 rows
- **THEN** the response is 400 with an error message indicating the row limit

#### Scenario: Missing name is rejected
- **WHEN** `POST /api/data-sources` is called with a static payload missing the `name` field
- **THEN** the response is 400 with an error message

### Requirement: POST /api/data-sources/:id/refresh replaces static rows
`POST /api/data-sources/:id/refresh` SHALL accept a JSON body with the same `{ columns, rows }` shape for static sources, replace the stored `config`, and update the linked `DataType` fields to reflect the new columns.

#### Scenario: Refresh replaces rows and updates DataType
- **WHEN** `POST /api/data-sources/:id/refresh` is called for a static source with a new columns/rows payload
- **THEN** `GET /api/data-sources/:id/preview` returns the new rows and the linked `DataType` reflects the new column types

#### Scenario: Refresh with over-limit rows is rejected
- **WHEN** `POST /api/data-sources/:id/refresh` is called with 501 rows
- **THEN** the response is 400 with an error message

#### Scenario: Refresh on a non-static source returns 400
- **WHEN** `POST /api/data-sources/:id/refresh` is called for a CSV source using the static JSON body format
- **THEN** the response is 400 indicating the source is not a static source

### Requirement: GET /api/data-sources/:id/preview returns stored rows for static sources
`GET /api/data-sources/:id/preview` SHALL return stored rows from the static source `config`. The response format SHALL match the existing `CsvPreviewResponse`: `{ headers: string[], rows: string[][] }`.

#### Scenario: Preview returns stored rows
- **WHEN** `GET /api/data-sources/:id/preview` is called for a static source with 2 columns and 3 rows
- **THEN** the response is 200 with `headers` equal to the column names and `rows` containing each row's cell values as strings

#### Scenario: Preview on unknown source returns 404
- **WHEN** `GET /api/data-sources/:id/preview` is called with an unknown id
- **THEN** the response is 404

