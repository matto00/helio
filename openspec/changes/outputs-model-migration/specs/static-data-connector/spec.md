## MODIFIED Requirements

_Companion DataTypes are retired (HEL-903 decision 4/11); a source's schema now lives directly on `data_sources.inferred_schema`, written by `upsertInferredSchema` in place of the old `upsertSourceDataType`/second-upsert path. Scenario titles are preserved verbatim from the live spec even where they still say "DataType" (they describe the same test case) — only the body text below each is updated to the new mechanism._

### Requirement: POST /api/data-sources accepts static source payload
The backend SHALL accept `POST /api/data-sources` with `Content-Type: application/json` when the discriminator `type` is `"static"`. The body SHALL be `{ "name": string, "type": "static", "columns": [{ "name": string, "type": string }], "rows": [[...]] }`. The handler SHALL store the columns and rows in the `data_sources.config` JSONB column and register an inferred schema record using the declared column types.

#### Scenario: Valid static source is created
- **WHEN** `POST /api/data-sources` is called with a valid static payload containing 2 columns and 3 rows
- **THEN** the response is 201 with a `DataSource` object whose `type` is `"static"`

#### Scenario: Static DataType is registered on creation
- **WHEN** a static source is created with columns `[{ name: "id", type: "integer" }, { name: "label", type: "string" }]`
- **THEN** an inferred schema record is created linked to the source with `fields` matching the declared column names and types

#### Scenario: Row count exceeding 500 is rejected
- **WHEN** `POST /api/data-sources` is called with a static payload containing 501 rows
- **THEN** the response is 400 with an error message indicating the row limit

#### Scenario: Missing name is rejected
- **WHEN** `POST /api/data-sources` is called with a static payload missing the `name` field
- **THEN** the response is 400 with an error message

### Requirement: POST /api/data-sources/:id/refresh replaces static rows
`POST /api/data-sources/:id/refresh` SHALL accept a JSON body with the same `{ columns, rows }` shape for static sources, replace the stored `config`, and update the source's inferred schema fields to reflect the new columns.

#### Scenario: Refresh replaces rows and updates DataType
- **WHEN** `POST /api/data-sources/:id/refresh` is called for a static source with a new columns/rows payload
- **THEN** `GET /api/data-sources/:id/preview` returns the new rows and the source's inferred schema reflects the new column types

#### Scenario: Refresh with over-limit rows is rejected
- **WHEN** `POST /api/data-sources/:id/refresh` is called with 501 rows
- **THEN** the response is 400 with an error message

#### Scenario: Refresh on a non-static source returns 400
- **WHEN** `POST /api/data-sources/:id/refresh` is called for a CSV source using the static JSON body format
- **THEN** the response is 400 indicating the source is not a static source
