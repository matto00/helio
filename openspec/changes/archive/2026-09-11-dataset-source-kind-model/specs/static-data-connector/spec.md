## MODIFIED Requirements

### Requirement: POST /api/data-sources accepts static source payload
The backend SHALL accept `POST /api/data-sources` with `Content-Type: application/json` when the
discriminator `type` is `"dataset"` or the alias `"static"`. The body SHALL be `{ "name": string,
"type": "dataset"|"static", "columns": [{ "name": string, "type": string }], "rows": [[...]] }`. The
handler SHALL store the source with `source_type = 'dataset'`, persist the declared columns as
`dataset_schema`, and insert the rows into `dataset_rows` rather than `data_sources.config`. The
response `type` field for a `dataset`-kind source SHALL always be `"dataset"`, regardless of which
of the two accepted values the request used.

#### Scenario: Valid static source is created
- **WHEN** `POST /api/data-sources` is called with a valid static payload containing 2 columns and 3
  rows (`type: "static"` or `type: "dataset"`)
- **THEN** the response is 201 with a `DataSource` object whose stored `source_type` is `"dataset"`
  and whose 3 rows are persisted in `dataset_rows`

#### Scenario: Valid dataset source is created via the static alias
- **WHEN** `POST /api/data-sources` is called with `type: "static"` and an otherwise identical
  payload
- **THEN** the response is 201 with a `DataSource` object whose `type` is `"dataset"` (not `"static"`)
  and whose stored `source_type` is `"dataset"`

#### Scenario: Static DataType is registered on creation
- **WHEN** a static source is created with columns `[{ name: "id", type: "integer" }, { name: "label", type: "string" }]`
- **THEN** `dataset_schema` reflects the declared column names and types

#### Scenario: Row count exceeding 500 is rejected
- **WHEN** `POST /api/data-sources` is called with a static payload containing 501 rows
- **THEN** the response is 400 with an error message indicating the row limit

#### Scenario: Missing name is rejected
- **WHEN** `POST /api/data-sources` is called with a static payload missing the `name` field
- **THEN** the response is 400 with an error message

### Requirement: POST /api/data-sources/:id/refresh replaces static rows
`POST /api/data-sources/:id/refresh` SHALL accept a JSON body with the same `{ columns, rows }` shape
for `dataset`-kind sources, replace the source's rows in `dataset_rows`, and update `dataset_schema` to
reflect the new columns.

#### Scenario: Refresh replaces rows and updates DataType
- **WHEN** `POST /api/data-sources/:id/refresh` is called for a `dataset`-kind source with a new
  columns/rows payload
- **THEN** `GET /api/data-sources/:id/preview` returns the new rows from `dataset_rows` and
  `dataset_schema` reflects the new column types

#### Scenario: Refresh with over-limit rows is rejected
- **WHEN** `POST /api/data-sources/:id/refresh` is called with 501 rows
- **THEN** the response is 400 with an error message

#### Scenario: Refresh on a non-static source returns 400
- **WHEN** `POST /api/data-sources/:id/refresh` is called for a CSV source using the static/dataset
  JSON body format
- **THEN** the response is 400 indicating the source is not a dataset source

### Requirement: GET /api/data-sources/:id/preview returns stored rows for static sources
`GET /api/data-sources/:id/preview` SHALL return stored rows from `dataset_rows` for a `dataset`-kind
source. The response format SHALL match the existing `CsvPreviewResponse`: `{ headers: string[], rows: string[][] }`.

#### Scenario: Preview returns stored rows
- **WHEN** `GET /api/data-sources/:id/preview` is called for a dataset source with 2 columns and 3
  rows
- **THEN** the response is 200 with `headers` equal to the column names and `rows` containing each
  row's cell values as strings

#### Scenario: Preview on unknown source returns 404
- **WHEN** `GET /api/data-sources/:id/preview` is called with an unknown id
- **THEN** the response is 404
